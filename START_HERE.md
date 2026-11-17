# START HERE (Tobi)

Hackathon is **tonight** at Tsai CITY, 5–9 PM. Your lane is the **Grok iMessage bot**.

## Already done for you

- Accepted Otis GitHub invite → cloned `Otis-IKP/Grokathon` into this folder
- Pulled plan docs from Drive into `docs/`
- Built `bot/` with:
  - Grok-only agent + tool calling
  - Stub Maya/YSIG graph (demo works offline)
  - FastAPI `/chat` + `/webhooks/{provider}`
  - Local REPL
  - `.env.example` for xAI + Sendblue/Linq/LoopMessage/Twilio
- Shared API contract in `shared/api_contract.md`

## You do next (in this folder)

```bash
cd "/Users/tobibamisaye/Uni stuff/Hackathons/grokathon/bot"
# 1) put XAI_API_KEY in .env
# 2) paste your FULL prompt into:
#    src/nepo_bot/prompts/system.md
# 3) run:
uv run python scripts/repl.py
```

Then open a new Cursor chat **in `Hackathons/grokathon/bot`** and paste your full build prompt.

## Event constraints

- Projects must use **Grok models** for prize eligibility
- Every attendee gets X Premium (Grok / Grok Bot / Cursor)
- 4-hour speed hack; submit by 8 PM

## Open questions still in the plan

- Which iMessage provider tonight? (Sendblue / Linq / LoopMessage / Mac relay / SMS fallback)
- Send from bot number vs hand draft back to user?
- Keep name "NEPO"?
