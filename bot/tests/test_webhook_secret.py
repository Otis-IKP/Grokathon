"""The webhook secret check: wrong or missing is rejected; the placeholder needs DEV_MODE."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from nepo_bot.app import app
from nepo_bot.config import DEFAULT_WEBHOOK_SECRET, get_settings


@pytest.fixture
def client_for(monkeypatch):
    def build(**env: str) -> TestClient:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
        monkeypatch.setenv("MESSAGING_PROVIDER", "local")
        monkeypatch.setenv("USE_STUB_BACKEND", "true")
        monkeypatch.delenv("DEV_MODE", raising=False)
        for key, value in env.items():
            monkeypatch.setenv(key, value)
        get_settings.cache_clear()
        return TestClient(app)

    yield build
    get_settings.cache_clear()


# An empty text is ignored before the model is called, so these never reach Claude.
EMPTY = {"from": "+12035550100", "text": ""}


def test_rejects_missing_and_wrong_secret(client_for):
    with client_for(MESSAGING_WEBHOOK_SECRET="s3cret-value") as client:
        assert client.post("/webhooks/sendblue", json=EMPTY).status_code == 401
        wrong = client.post(
            "/webhooks/sendblue", json=EMPTY, headers={"X-Webhook-Secret": "nope"}
        )
        assert wrong.status_code == 401
        assert client.post("/webhooks/local", json=EMPTY).status_code == 401
        assert client.post("/chat", json={"text": "hi"}).status_code == 401


def test_accepts_the_right_secret_in_header_or_query(client_for):
    with client_for(MESSAGING_WEBHOOK_SECRET="s3cret-value") as client:
        by_header = client.post(
            "/webhooks/sendblue",
            json=EMPTY,
            headers={"X-Webhook-Secret": "s3cret-value"},
        )
        assert by_header.status_code == 200
        assert by_header.json()["ignored"] is True
        assert (
            client.post(
                "/webhooks/sendblue?secret=s3cret-value", json=EMPTY
            ).status_code
            == 200
        )


def test_refuses_the_placeholder_secret_outside_dev_mode(client_for):
    headers = {"X-Webhook-Secret": DEFAULT_WEBHOOK_SECRET}
    with client_for(MESSAGING_WEBHOOK_SECRET=DEFAULT_WEBHOOK_SECRET) as client:
        assert (
            client.post("/webhooks/sendblue", json=EMPTY, headers=headers).status_code
            == 503
        )
    with client_for(
        MESSAGING_WEBHOOK_SECRET=DEFAULT_WEBHOOK_SECRET, DEV_MODE="true"
    ) as client:
        assert (
            client.post("/webhooks/sendblue", json=EMPTY, headers=headers).status_code
            == 200
        )
        assert client.post("/webhooks/sendblue", json=EMPTY).status_code == 401
