"""Inbound webhook parsers for common iMessage / SMS providers."""

from __future__ import annotations

from typing import Any

from fastapi import Request


async def parse_inbound(provider: str, request: Request) -> dict[str, Any]:
    """Normalize inbound webhook → {from_phone, text, raw}."""
    provider = provider.lower()
    payload = await request.json()

    if provider == "local":
        return {
            "from_phone": payload.get("from") or payload.get("from_phone"),
            "text": payload.get("text") or payload.get("body") or "",
            "raw": payload,
        }

    if provider == "sendblue":
        return {
            "from_phone": payload.get("from_number") or payload.get("number"),
            "text": payload.get("content") or payload.get("text") or "",
            "raw": payload,
        }

    if provider == "linq":
        data = payload.get("data") or payload
        msg = data.get("message") or data
        return {
            "from_phone": data.get("from") or msg.get("from"),
            "text": msg.get("text") or msg.get("body") or "",
            "raw": payload,
        }

    if provider == "loopmessage":
        return {
            "from_phone": payload.get("contact") or payload.get("recipient"),
            "text": payload.get("text") or payload.get("message") or "",
            "raw": payload,
        }

    if provider == "twilio_sms":
        form = await request.form()
        return {
            "from_phone": str(form.get("From") or ""),
            "text": str(form.get("Body") or ""),
            "raw": dict(form),
        }

    # Generic fallback
    return {
        "from_phone": payload.get("from") or payload.get("from_phone"),
        "text": payload.get("text") or payload.get("body") or "",
        "raw": payload,
    }
