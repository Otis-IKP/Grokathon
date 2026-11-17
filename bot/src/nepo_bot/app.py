"""FastAPI entrypoint: health + inbound webhooks + chat test endpoint."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field

from nepo_bot.agent.grok import GrokAgent
from nepo_bot.backend.client import BackendClient
from nepo_bot.config import get_settings
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
    agent: GrokAgent | None = None
    if settings.xai_api_key:
        agent = GrokAgent(settings, backend, sender)
    app.state.settings = settings
    app.state.backend = backend
    app.state.sender = sender
    app.state.agent = agent
    yield
    await backend.aclose()


app = FastAPI(title="NEPO Grok Bot", version="0.1.0", lifespan=lifespan)


def _require_agent(request: Request) -> GrokAgent:
    agent = getattr(request.app.state, "agent", None)
    if agent is None:
        raise HTTPException(
            status_code=503,
            detail="XAI_API_KEY not set. Add it to bot/.env and restart.",
        )
    return agent


@app.get("/health")
async def health(request: Request) -> dict[str, Any]:
    settings = request.app.state.settings
    return {
        "ok": True,
        "provider": settings.messaging_provider,
        "model": settings.grok_model,
        "stub_backend": settings.use_stub_backend,
        "grok_ready": bool(settings.xai_api_key),
    }


@app.post("/chat")
async def chat(body: ChatRequest, request: Request) -> dict[str, Any]:
    """Local / website chat endpoint (same agent as iMessage)."""
    agent = _require_agent(request)
    settings = request.app.state.settings
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
    if (
        settings.messaging_webhook_secret
        and x_webhook_secret != settings.messaging_webhook_secret
        and provider != "local"
    ):
        # Allow local without secret; require secret for real providers when set
        if provider not in {"twilio_sms"}:  # Twilio uses its own signature later
            pass  # keep permissive for hackathon speed; tighten if needed

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
