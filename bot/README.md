# NEPO bot (Tobi) — Claude + iMessage

Yale Grokathon 2026. Older Python scaffold; `messaging/` is the bot to demo. It runs on Claude through the official `anthropic` SDK (`CLAUDE_MODEL`, default `claude-opus-5-5`). Stub backend included so you can try the Maya → YSIG flow without Otis's API.

## Quick start

```bash
cd bot
cp .env.example .env
# paste ANTHROPIC_API_KEY into .env
# set MESSAGING_WEBHOOK_SECRET to a random string (or DEV_MODE=true on your own machine)

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

Every webhook request, and every `POST /chat`, must carry `MESSAGING_WEBHOOK_SECRET`, either as the
`X-Webhook-Secret` header or as `?secret=` on the URL (for providers that cannot set a header). A wrong or
missing secret gets 401. The placeholder `dev-secret-change-me` is refused with 503 unless `DEV_MODE=true`.

Until then, use `MESSAGING_PROVIDER=local` + REPL / `/chat`.

## Layout

- `src/nepo_bot/agent/` — Claude tool loop (`claude.py`) and tool definitions (`tools.py`)
- `src/nepo_bot/messaging/` — inbound webhooks + outbound providers
- `src/nepo_bot/backend/` — stub graph + Otis API client
- `src/nepo_bot/prompts/system.md` — **drop your full prompt here**
