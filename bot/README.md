# NEPO bot (Tobi) — Grok + iMessage

Yale Grokathon 2026. **Grok only** (xAI API). Stub backend included so you can demo the Maya → YSIG flow without Otis's API.

## Quick start

```bash
cd "/Users/tobibamisaye/Uni stuff/Hackathons/grokathon/bot"
cp .env.example .env
# paste XAI_API_KEY into .env

source .venv/bin/activate   # or: uv run …
uv run pytest
uv run python scripts/repl.py
# or API server:
uv run uvicorn nepo_bot.app:app --reload --port 8787
```

Paste your full system prompt into `src/nepo_bot/prompts/system.md`.

## Demo script (stub data)

1. `I want to be on YSIG`
2. Bot finds Jordan (friend, YSIG member) + Priya path to Sam (board)
3. `yes` / pick Jordan → draft
4. `send` → outbound via local print or iMessage provider

## iMessage

Set `MESSAGING_PROVIDER` to `sendblue`, `linq`, `loopmessage`, or `twilio_sms`, fill keys in `.env`, expose the server with ngrok, point the provider webhook at:

`POST {WEBHOOK_BASE_URL}/webhooks/{provider}`

Until then, use `MESSAGING_PROVIDER=local` + REPL / `/chat`.

## Layout

- `src/nepo_bot/agent/` — Grok tool loop
- `src/nepo_bot/messaging/` — inbound webhooks + outbound providers
- `src/nepo_bot/backend/` — stub graph + Otis API client
- `src/nepo_bot/prompts/system.md` — **drop your full prompt here**
