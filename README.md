# Grokathon — Yale NEPO (Warm Intros)

Repo: https://github.com/Otis-IKP/Grokathon  
Event: **y/cs x SpaceXSI Grokathon Yale 2026** · Tue Nov 17 · **5:00–9:00 PM** · Tsai CITY  
Submissions until **8:00 PM**, awards ~8:45 PM.  
Luma: https://luma.com/dis51jq2

## Team

| Person | Role |
|--------|------|
| **Tobi** | Grok bot + iMessage (`messaging/`). `bot/` is an older scaffold. Do not demo it. |
| **Otis** | App + backend API |
| **Arden** | Website |

## Product (one line)

Student texts Grok: "I want to be on YSIG." NEPO finds the warmest friend-path into the club and drafts/sends the intro ask.

## Docs

- `docs/yale-nepo-hackathon-plan.md` — full plan
- `docs/yale-warm-intros-plan.md` — short brief
- `docs/otis-imessage-prompt.md` — Otis prompt for iMessage connector (was empty when exported; re-check Drive)
- `shared/api_contract.md` — tool endpoints Tobi ↔ Otis
- `docs/TEAM_HANDOFF.md` — what the bot does, and how to change it in Cursor or Claude
- [NEPO bot handoff](https://docs.google.com/document/d/17YLnLekIi-4NvDZzLEvBV5DRbs4_WcV71G8LaDs5AUw/edit) — same note in the shared Drive folder, with the phone map
- Drive folder: https://drive.google.com/drive/folders/1KoXnodnMgJ77r27w7-A_eiJQwqsbWnNg

## Demo bot

The live bot is `messaging/`. Read `messaging/README.md` before presenting. It is not hosted. It runs on Tobi's Mac behind a Cloudflare tunnel, and the README has the health check, the text script, and how to bring the tunnel back if it dies.

**Rule for tonight:** use **only Grok** via `api.x.ai` (no Claude/OpenAI models).
