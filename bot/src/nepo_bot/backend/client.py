"""Backend client: stub demo graph or Otis live API."""

from __future__ import annotations

from typing import Any

import httpx

from nepo_bot.backend import stub
from nepo_bot.config import Settings


class BackendClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._http = httpx.AsyncClient(
            base_url=settings.backend_base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {settings.backend_api_key}"}
            if settings.backend_api_key
            else {},
            timeout=30.0,
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def resolve_club(self, text: str) -> dict[str, Any]:
        if self.settings.use_stub_backend:
            return stub.resolve_club(text)
        r = await self._http.post("/tools/resolve_club", json={"text": text})
        r.raise_for_status()
        return r.json()

    async def find_paths(
        self, user_id: str, club_id: str, limit: int = 3
    ) -> dict[str, Any]:
        if self.settings.use_stub_backend:
            return stub.find_paths(user_id, club_id, limit)
        r = await self._http.post(
            "/tools/find_paths",
            json={"user_id": user_id, "club_id": club_id, "limit": limit},
        )
        r.raise_for_status()
        return r.json()

    async def draft_intro(
        self,
        user_id: str,
        connector_id: str,
        club_id: str,
        tone: str = "casual",
        notes: str = "",
    ) -> dict[str, Any]:
        if self.settings.use_stub_backend:
            return stub.draft_intro(user_id, connector_id, club_id, tone, notes)
        r = await self._http.post(
            "/tools/draft_intro",
            json={
                "user_id": user_id,
                "connector_id": connector_id,
                "club_id": club_id,
                "tone": tone,
                "notes": notes,
            },
        )
        r.raise_for_status()
        return r.json()

    async def lookup_user(
        self, phone: str | None = None, user_id: str | None = None
    ) -> dict[str, Any]:
        if self.settings.use_stub_backend:
            return stub.lookup_user(phone=phone, user_id=user_id)
        params = {k: v for k, v in {"phone": phone, "user_id": user_id}.items() if v}
        r = await self._http.get("/users/lookup", params=params)
        r.raise_for_status()
        return r.json()

    def mark_intro_sent(self, intro_id: str) -> None:
        if self.settings.use_stub_backend:
            stub.mark_intro_sent(intro_id)
