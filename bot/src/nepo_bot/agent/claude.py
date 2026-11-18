"""Claude agent loop with tool use, via the Anthropic Messages API."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Awaitable, Callable

import anthropic

from nepo_bot.agent.tools import TOOLS
from nepo_bot.backend.client import BackendClient
from nepo_bot.config import Settings

SendFn = Callable[[str, str], Awaitable[dict[str, Any]]]

PROMPT_PATH = Path(__file__).resolve().parents[1] / "prompts" / "system.md"

MAX_TOKENS = 16000
MAX_MODEL_CALLS = 8

BLANKED = "Sorry, I blanked for a second. Try that again?"
DECLINED = "I can't help with that one. Want to find a warm intro to a club instead?"
BUSY = "NEPO is getting a lot of texts right now. Try again in a minute."
SNAG = "NEPO hit a snag on my end. Try again in a sec."
OFFLINE = "NEPO can't reach its brain right now. Try again in a sec."
TOOL_LOOP = "I got stuck in a tool loop. Text me again with the club name."

log = logging.getLogger(__name__)


def load_system_prompt() -> str:
    if PROMPT_PATH.exists():
        return PROMPT_PATH.read_text(encoding="utf-8").strip()
    return "You are NEPO, a Yale warm-intro assistant over iMessage. Use tools. Be concise."


class ClaudeAgent:
    def __init__(
        self,
        settings: Settings,
        backend: BackendClient,
        send_message: SendFn,
        client: Any | None = None,
    ):
        if client is None and not settings.anthropic_api_key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY is missing. Copy bot/.env.example → bot/.env and paste your key."
            )
        self.settings = settings
        self.backend = backend
        self.send_message = send_message
        # Async twin of anthropic.Anthropic(): this loop runs inside FastAPI's event loop.
        self.client = client or anthropic.AsyncAnthropic(
            api_key=settings.anthropic_api_key,
            timeout=60.0,
            max_retries=2,
        )
        self.system_prompt = load_system_prompt()
        # phone -> Messages API history. The system prompt is sent separately.
        self.sessions: dict[str, list[dict[str, Any]]] = {}

    def _history(self, phone: str) -> list[dict[str, Any]]:
        return self.sessions.setdefault(phone, [])

    def reset(self, phone: str) -> None:
        self.sessions.pop(phone, None)

    async def _dispatch_tool(
        self, name: str, args: dict[str, Any], user_id: str
    ) -> dict[str, Any]:
        if name == "resolve_club":
            return await self.backend.resolve_club(args["text"])
        if name == "find_paths":
            return await self.backend.find_paths(
                user_id=args.get("user_id") or user_id,
                club_id=args["club_id"],
                limit=int(args.get("limit") or 3),
            )
        if name == "draft_intro":
            return await self.backend.draft_intro(
                user_id=args.get("user_id") or user_id,
                connector_id=args["connector_id"],
                club_id=args["club_id"],
                tone=args.get("tone") or "casual",
                notes=args.get("notes") or "",
            )
        if name == "send_message":
            result = await self.send_message(args["to"], args["body"])
            if args.get("intro_id"):
                self.backend.mark_intro_sent(args["intro_id"])
            return {"ok": True, "provider_result": result}
        if name == "lookup_user":
            return await self.backend.lookup_user(
                phone=args.get("phone"), user_id=args.get("user_id")
            )
        return {"ok": False, "error": f"unknown tool {name}"}

    async def _run_tool(self, block: Any, user_id: str) -> dict[str, Any]:
        """Run one tool_use block and build its tool_result block."""
        failed = False
        try:
            args = block.input if isinstance(block.input, dict) else {}
            result = await self._dispatch_tool(block.name, args, user_id)
            failed = isinstance(result, dict) and result.get("ok") is False
        except Exception as exc:  # the model gets the failure and can recover
            log.warning("tool %s failed: %s", block.name, type(exc).__name__)
            result = {
                "ok": False,
                "error": f"{block.name} failed: {type(exc).__name__}",
            }
            failed = True
        tool_result: dict[str, Any] = {
            "type": "tool_result",
            "tool_use_id": block.id,
            "content": json.dumps(result, default=str),
        }
        if failed:
            tool_result["is_error"] = True
        return tool_result

    async def handle_inbound(
        self,
        *,
        from_phone: str,
        text: str,
        user_id: str | None = None,
    ) -> str:
        """Run one user turn through Claude + tools. Returns assistant text reply."""
        lookup = await self.backend.lookup_user(phone=from_phone, user_id=user_id)
        resolved_user_id = (
            user_id
            or (lookup.get("user") or {}).get("id")
            or self.settings.demo_user_id
        )
        user_name = (lookup.get("user") or {}).get("name") or "there"

        history = self._history(from_phone)
        turn_start = len(history)
        history.append(
            {
                "role": "user",
                "content": (
                    f"[from_phone={from_phone}; user_id={resolved_user_id}; "
                    f"name={user_name}]\n{text}"
                ),
            }
        )

        for _ in range(MAX_MODEL_CALLS):
            try:
                response = await self.client.messages.create(
                    model=self.settings.claude_model,
                    max_tokens=MAX_TOKENS,
                    system=self.system_prompt,
                    tools=TOOLS,
                    messages=history,
                )
            except anthropic.RateLimitError:
                del history[turn_start:]
                return BUSY
            except anthropic.APIStatusError as exc:
                log.error("Claude API returned %s", exc.status_code)
                del history[turn_start:]
                return SNAG
            except anthropic.APIConnectionError:
                del history[turn_start:]
                return OFFLINE

            # A refusal carries no usable content, and keeping the turn would get it refused again.
            if response.stop_reason == "refusal":
                del history[turn_start:]
                return DECLINED
            if response.stop_reason == "max_tokens":
                del history[turn_start:]
                return BLANKED

            history.append({"role": "assistant", "content": response.content})

            if response.stop_reason != "tool_use":
                reply = "\n\n".join(
                    block.text for block in response.content if block.type == "text"
                ).strip()
                return reply or BLANKED

            # Every result goes back in one user message, as the API expects for parallel tool calls.
            tool_results = [
                await self._run_tool(block, resolved_user_id)
                for block in response.content
                if block.type == "tool_use"
            ]
            history.append({"role": "user", "content": tool_results})

        return TOOL_LOOP
