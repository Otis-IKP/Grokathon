"""Local terminal chat with the Grok NEPO agent (no iMessage needed)."""

from __future__ import annotations

import sys

from nepo_bot.agent.grok import GrokAgent
from nepo_bot.backend.client import BackendClient
from nepo_bot.config import get_settings
from nepo_bot.messaging.providers import build_sender


async def main() -> None:
    settings = get_settings()
    if not settings.xai_api_key:
        print("Missing XAI_API_KEY. Copy .env.example → .env and paste your key.")
        sys.exit(1)

    backend = BackendClient(settings)
    sender = build_sender(settings)
    agent = GrokAgent(settings, backend, sender)
    phone = settings.demo_user_phone

    print("NEPO local REPL (Grok only). Type 'quit' or 'reset'.")
    print(
        f"Demo user phone={phone} id={settings.demo_user_id} model={settings.grok_model}"
    )
    print("Try: I want to be on YSIG\n")

    try:
        while True:
            try:
                text = input("you> ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                break
            if not text:
                continue
            if text.lower() in {"quit", "exit", "q"}:
                break
            if text.lower() == "reset":
                agent.reset(phone)
                print("(session cleared)\n")
                continue
            reply = await agent.handle_inbound(from_phone=phone, text=text)
            print(f"nepo> {reply}\n")
    finally:
        await backend.aclose()
