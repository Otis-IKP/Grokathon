"""FastAPI entrypoint: health + inbound webhooks + chat test endpoint."""

from __future__ import annotations

import hmac
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field

from nepo_bot.agent.claude import ClaudeAgent
from nepo_bot.backend.client import BackendClient
from nepo_bot.config import DEFAULT_WEBHOOK_SECRET, Settings, get_settings
from nepo_bot.messaging.providers import build_sender
from nepo_bot.messaging.webhooks import parse_inbound


class ChatRequest(BaseModel):
    text: str
    from_phone: str = Field(default="")
    user_id: str | None = None
    reset: bool = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    backend = BackendClient(settings)
    sender = build_sender(settings)
    agent: ClaudeAgent | None = None
    if settings.anthropic_api_key:
        agent = ClaudeAgent(settings, backend, sender)
    app.state.settings = settings
    app.state.backend = backend
    app.state.sender = sender
    app.state.agent = agent
    yield
    await backend.aclose()


app = FastAPI(title="NEPO Claude Bot", version="0.1.0", lifespan=lifespan)


def _require_agent(request: Request) -> ClaudeAgent:
    agent = getattr(request.app.state, "agent", None)
    if agent is None:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY not set. Add it to bot/.env and restart.",
        )
    return agent


def _require_webhook_secret(settings: Settings, provided: str | None) -> None:
    """Reject the request unless it carries MESSAGING_WEBHOOK_SECRET.

    The placeholder secret from .env.example is public, so it only works with DEV_MODE=true.
    """
    expected = settings.messaging_webhook_secret
    if not expected or (expected == DEFAULT_WEBHOOK_SECRET and not settings.dev_mode):
        raise HTTPException(
            status_code=503,
            detail="MESSAGING_WEBHOOK_SECRET is not set to a real secret. Set one, or DEV_MODE=true on your own machine.",
        )
    if not provided or not hmac.compare_digest(provided.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="bad webhook secret")


@app.get("/health")
async def health(request: Request) -> dict[str, Any]:
    settings = request.app.state.settings
    return {
        "ok": True,
        "provider": settings.messaging_provider,
        "model": settings.claude_model,
        "stub_backend": settings.use_stub_backend,
        "claude_ready": bool(settings.anthropic_api_key),
    }


@app.post("/chat")
async def chat(
    body: ChatRequest,
    request: Request,
    x_webhook_secret: str | None = Header(default=None),
) -> dict[str, Any]:
    """Local / website chat endpoint (same agent as iMessage).

    It can act as any phone and can send texts, so it needs the same secret as the webhooks.
    """
    settings = request.app.state.settings
    _require_webhook_secret(
        settings, x_webhook_secret or request.query_params.get("secret")
    )
    agent = _require_agent(request)
    phone = body.from_phone or settings.demo_user_phone
    if body.reset:
        agent.reset(phone)
    reply = await agent.handle_inbound(
        from_phone=phone, text=body.text, user_id=body.user_id
    )
    return {"reply": reply, "from_phone": phone}


@app.post("/webhooks/{provider}")
async def inbound_webhook(
    provider: str,
    request: Request,
    x_webhook_secret: str | None = Header(default=None),
) -> dict[str, Any]:
    settings = request.app.state.settings
    # Providers that can't set a header (Twilio) pass it as ?secret= on the webhook URL.
    _require_webhook_secret(
        settings, x_webhook_secret or request.query_params.get("secret")
    )

    agent = _require_agent(request)
    inbound = await parse_inbound(provider, request)
    from_phone = inbound.get("from_phone") or settings.demo_user_phone
    text = (inbound.get("text") or "").strip()
    if not text:
        return {"ok": True, "ignored": True, "reason": "empty body"}

    reply = await agent.handle_inbound(from_phone=from_phone, text=text)
    # Also push reply through outbound provider when not local chat-only
    if settings.messaging_provider != "local" or provider != "local":
        await request.app.state.sender(from_phone, reply)
    return {"ok": True, "reply": reply}
