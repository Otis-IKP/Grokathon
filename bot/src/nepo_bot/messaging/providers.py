"""Outbound messaging adapters. Local prints; others hit iMessage/SMS APIs."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

import httpx

from nepo_bot.config import Settings

SendFn = Callable[[str, str], Awaitable[dict[str, Any]]]


def build_sender(settings: Settings) -> SendFn:
    provider = settings.messaging_provider.lower().strip()

    if provider == "local":

        async def local_send(to: str, body: str) -> dict[str, Any]:
            print(f"\n[LOCAL OUTBOUND → {to}]\n{body}\n")
            return {"ok": True, "provider": "local", "to": to, "body": body}

        return local_send

    if provider == "sendblue":

        async def sendblue_send(to: str, body: str) -> dict[str, Any]:
            async with httpx.AsyncClient(timeout=30.0) as client:
                r = await client.post(
                    "https://api.sendblue.co/api/send-message",
                    headers={
                        "sb-api-key-id": settings.sendblue_api_key,
                        "sb-api-secret-key": settings.sendblue_api_secret,
                        "Content-Type": "application/json",
                    },
                    json={
                        "number": to,
                        "content": body,
                        "from_number": settings.sendblue_from_number or None,
                    },
                )
                r.raise_for_status()
                return {"ok": True, "provider": "sendblue", "data": r.json()}

        return sendblue_send

    if provider == "linq":

        async def linq_send(to: str, body: str) -> dict[str, Any]:
            async with httpx.AsyncClient(timeout=30.0) as client:
                r = await client.post(
                    "https://api.linqapp.com/api/partner/v2/messages",
                    headers={
                        "Authorization": f"Bearer {settings.linq_api_token}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "to": [to],
                        "message": {"text": body},
                        "from": settings.linq_from_number or None,
                    },
                )
                r.raise_for_status()
                return {"ok": True, "provider": "linq", "data": r.json()}

        return linq_send

    if provider == "loopmessage":

        async def loop_send(to: str, body: str) -> dict[str, Any]:
            async with httpx.AsyncClient(timeout=30.0) as client:
                r = await client.post(
                    "https://server.loopmessage.com/api/v1/message/send/",
                    headers={
                        "Authorization": settings.loopmessage_auth_key,
                        "Loop-Secret-Key": settings.loopmessage_secret_key,
                        "Content-Type": "application/json",
                    },
                    json={
                        "recipient": to,
                        "text": body,
                        "sender_name": settings.loopmessage_sender_name or None,
                    },
                )
                r.raise_for_status()
                return {"ok": True, "provider": "loopmessage", "data": r.json()}

        return loop_send

    if provider == "twilio_sms":

        async def twilio_send(to: str, body: str) -> dict[str, Any]:
            url = (
                f"https://api.twilio.com/2010-04-01/Accounts/"
                f"{settings.twilio_account_sid}/Messages.json"
            )
            async with httpx.AsyncClient(timeout=30.0) as client:
                r = await client.post(
                    url,
                    auth=(settings.twilio_account_sid, settings.twilio_auth_token),
                    data={
                        "To": to,
                        "From": settings.twilio_from_number,
                        "Body": body,
                    },
                )
                r.raise_for_status()
                return {"ok": True, "provider": "twilio_sms", "data": r.json()}

        return twilio_send

    raise ValueError(
        f"Unknown MESSAGING_PROVIDER={provider!r}. "
        "Use local|sendblue|linq|loopmessage|twilio_sms"
    )
