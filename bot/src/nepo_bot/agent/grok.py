"""Grok-only agent loop with tool calling via xAI Chat Completions."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Awaitable, Callable

from openai import AsyncOpenAI

from nepo_bot.agent.tools import TOOLS
from nepo_bot.backend.client import BackendClient
from nepo_bot.config import Settings

SendFn = Callable[[str, str], Awaitable[dict[str, Any]]]

PROMPT_PATH = Path(__file__).resolve().parents[1] / "prompts" / "system.md"


def load_system_prompt() -> str:
    if PROMPT_PATH.exists():
        return PROMPT_PATH.read_text(encoding="utf-8").strip()
    return "You are NEPO, a Yale warm-intro assistant over iMessage. Use tools. Be concise."


class GrokAgent:
    def __init__(
        self,
        settings: Settings,
        backend: BackendClient,
        send_message: SendFn,
    ):
        if not settings.xai_api_key:
            raise RuntimeError(
                "XAI_API_KEY is missing. Copy bot/.env.example → bot/.env and paste your key."
            )
        self.settings = settings
        self.backend = backend
        self.send_message = send_message
        self.client = AsyncOpenAI(
            api_key=settings.xai_api_key,
            base_url=settings.xai_base_url,
        )
        self.system_prompt = load_system_prompt()
        # phone -> chat history (OpenAI message dicts)
        self.sessions: dict[str, list[dict[str, Any]]] = {}

    def _history(self, phone: str) -> list[dict[str, Any]]:
        if phone not in self.sessions:
            self.sessions[phone] = [
                {"role": "system", "content": self.system_prompt},
            ]
        return self.sessions[phone]

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

    async def handle_inbound(
        self,
        *,
        from_phone: str,
        text: str,
        user_id: str | None = None,
    ) -> str:
        """Run one user turn through Grok + tools. Returns assistant text reply."""
        lookup = await self.backend.lookup_user(phone=from_phone, user_id=user_id)
        resolved_user_id = (
            user_id
            or (lookup.get("user") or {}).get("id")
            or self.settings.demo_user_id
        )
        user_name = (lookup.get("user") or {}).get("name") or "there"

        history = self._history(from_phone)
        history.append(
            {
                "role": "user",
                "content": (
                    f"[from_phone={from_phone}; user_id={resolved_user_id}; "
                    f"name={user_name}]\n{text}"
                ),
            }
        )

        for _ in range(8):  # tool-loop guard
            completion = await self.client.chat.completions.create(
                model=self.settings.grok_model,
                messages=history,
                tools=TOOLS,
                tool_choice="auto",
                temperature=0.6,
            )
            msg = completion.choices[0].message
            assistant_msg: dict[str, Any] = {
                "role": "assistant",
                "content": msg.content or "",
            }
            if msg.tool_calls:
                assistant_msg["tool_calls"] = [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in msg.tool_calls
                ]
            history.append(assistant_msg)

            if not msg.tool_calls:
                reply = (msg.content or "").strip()
                return reply or "Sorry, I blanked for a second. Try that again?"

            for tc in msg.tool_calls:
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                result = await self._dispatch_tool(
                    tc.function.name, args, resolved_user_id
                )
                history.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": json.dumps(result),
                    }
                )

        return "I got stuck in a tool loop. Text me again with the club name."
