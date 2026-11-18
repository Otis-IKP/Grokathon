"""The Claude tool loop, driven by a fake client. No network."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx2

from nepo_bot.agent.claude import BUSY, DECLINED, ClaudeAgent
from nepo_bot.agent.tools import TOOLS
from nepo_bot.backend.client import BackendClient
from nepo_bot.config import Settings


def text(body: str) -> SimpleNamespace:
    return SimpleNamespace(type="text", text=body)


def tool_use(block_id: str, name: str, args: dict[str, Any]) -> SimpleNamespace:
    return SimpleNamespace(type="tool_use", id=block_id, name=name, input=args)


def message(content: list[Any], stop_reason: str) -> SimpleNamespace:
    return SimpleNamespace(content=content, stop_reason=stop_reason)


class FakeClient:
    """Stands in for anthropic.AsyncAnthropic: replies come from a script."""

    def __init__(self, script: list[Any]):
        self.script = list(script)
        self.requests: list[dict[str, Any]] = []
        self.messages = SimpleNamespace(create=self._create)

    async def _create(self, **kwargs: Any) -> Any:
        # Snapshot: the agent keeps appending to the same history list.
        self.requests.append({**kwargs, "messages": list(kwargs["messages"])})
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


def make_agent(
    script: list[Any],
) -> tuple[ClaudeAgent, FakeClient, list[tuple[str, str]]]:
    settings = Settings(_env_file=None, anthropic_api_key="", use_stub_backend=True)
    sent: list[tuple[str, str]] = []

    async def send(to: str, body: str) -> dict[str, Any]:
        sent.append((to, body))
        return {"ok": True}

    client = FakeClient(script)
    return (
        ClaudeAgent(settings, BackendClient(settings), send, client=client),
        client,
        sent,
    )


def run(agent: ClaudeAgent, body: str) -> str:
    return asyncio.run(agent.handle_inbound(from_phone="+12035550100", text=body))


def test_tools_use_the_anthropic_shape():
    for tool in TOOLS:
        assert set(tool) == {"name", "description", "input_schema"}
        assert tool["input_schema"]["type"] == "object"


def test_request_shape_and_tool_results_in_one_user_message():
    agent, client, _ = make_agent(
        [
            message(
                [
                    tool_use("toolu_1", "resolve_club", {"text": "YSIG"}),
                    tool_use(
                        "toolu_2",
                        "find_paths",
                        {"user_id": "user_maya", "club_id": "ysig"},
                    ),
                ],
                "tool_use",
            ),
            message([text("Jordan is your strongest link.")], "end_turn"),
        ]
    )
    assert run(agent, "I want to be on YSIG") == "Jordan is your strongest link."

    first, second = client.requests
    assert first["model"] == "claude-opus-5-5"
    assert first["max_tokens"] == 16000
    assert first["system"] == agent.system_prompt
    assert first["tools"] is TOOLS
    for removed in ("temperature", "top_p", "top_k", "tool_choice", "thinking"):
        assert removed not in first
    assert [m["role"] for m in first["messages"]] == ["user"]

    assert [m["role"] for m in second["messages"]] == ["user", "assistant", "user"]
    results = second["messages"][2]["content"]
    assert [r["type"] for r in results] == ["tool_result", "tool_result"]
    assert [r["tool_use_id"] for r in results] == ["toolu_1", "toolu_2"]
    assert all("is_error" not in r for r in results)
    assert "user_jordan" in results[1]["content"]


def test_failed_tool_is_reported_with_is_error():
    agent, client, _ = make_agent(
        [
            message([tool_use("toolu_1", "find_paths", {})], "tool_use"),
            message([tool_use("toolu_2", "no_such_tool", {})], "tool_use"),
            message([text("Which club?")], "end_turn"),
        ]
    )
    assert run(agent, "hi") == "Which club?"
    missing_arg = client.requests[1]["messages"][-1]["content"][0]
    assert missing_arg["is_error"] is True
    assert missing_arg["tool_use_id"] == "toolu_1"
    unknown = client.requests[2]["messages"][-1]["content"][0]
    assert unknown["is_error"] is True


def test_refusal_gets_a_redirect_and_is_dropped_from_history():
    agent, client, _ = make_agent(
        [message([], "refusal"), message([text("Which club?")], "end_turn")]
    )
    assert run(agent, "something declined") == DECLINED
    assert run(agent, "ysig") == "Which club?"
    assert len(client.requests[1]["messages"]) == 1
    assert "ysig" in client.requests[1]["messages"][0]["content"]


def test_rate_limit_is_caught_and_the_turn_is_not_kept():
    response = httpx2.Response(
        429, request=httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    )
    error = anthropic.RateLimitError("rate limited", response=response, body=None)
    agent, client, _ = make_agent([error, message([text("Which club?")], "end_turn")])
    assert run(agent, "hi") == BUSY
    assert run(agent, "hi again") == "Which club?"
    assert len(client.requests[1]["messages"]) == 1
