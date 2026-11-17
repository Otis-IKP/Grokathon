# Grokathon — Yale NEPO (Warm Intros)

Repo: https://github.com/Otis-IKP/Grokathon  
Event: **y/cs x SpaceXSI Grokathon Yale 2026** · Tue Nov 17 · **5:00–9:00 PM** · Tsai CITY  
Submissions until **8:00 PM**, awards ~8:45 PM.  
Luma: https://luma.com/dis51jq2

## Team

| Person | Role |
|--------|------|
| **Tobi** | Grok bot + iMessage integration (`bot/`) |
| **Otis** | App + backend API |
| **Arden** | Website |

## Product (one line)

Student texts Grok: "I want to be on YSIG." NEPO finds the warmest friend-path into the club and drafts/sends the intro ask.

## Docs

- `docs/yale-nepo-hackathon-plan.md` — full plan
- `docs/yale-warm-intros-plan.md` — short brief
- `docs/otis-imessage-prompt.md` — Otis prompt for iMessage connector (was empty when exported; re-check Drive)
- `shared/api_contract.md` — tool endpoints Tobi ↔ Otis
- Drive folder: https://drive.google.com/drive/folders/1KoXnodnMgJ77r27w7-A_eiJQwqsbWnNg

## Tobi: start here

```bash
cd "/Users/tobibamisaye/Uni stuff/Hackathons/grokathon/bot"
cp .env.example .env   # if not already
# add XAI_API_KEY (Grok only — required for prize eligibility)
source .venv/bin/activate
uv run python scripts/repl.py
```

1. Paste full system prompt → `bot/src/nepo_bot/prompts/system.md`
2. Keep `USE_STUB_BACKEND=true` until Otis API is up
3. Wire iMessage provider when ready (`MESSAGING_PROVIDER`)

**Rule for tonight:** use **only Grok** via `api.x.ai` (no Claude/OpenAI models).
