# NEPO messaging bot

A student texts the NEPO number, for example "I want to be on YSIG". The bot finds the warmest path through their friends, drafts an intro, and either hands back a one-tap iMessage draft or texts the connector after the student replies "send".

This folder is the Grok + iMessage bot. Otis's app can replace the in-memory graph by setting `BACKEND_MODE=http`. Grok is called only through `https://api.x.ai/v1`.

## Setup

```bash
cd messaging
cp .env.example .env
npm install
npm run typecheck
npm test
```

Put `DRY_RUN=true` in `.env` until Sendblue keys are filled in. The server then logs outbound texts instead of sending them.

```bash
npm run dev
npm run simulate -- +15550000001
```

Web fallback (no iMessage): open `http://localhost:3000/` and use Maya's phone, `+15550000001`.

## What you need accounts for

- **xAI key** (`XAI_API_KEY` from [console.x.ai](https://console.x.ai)). Required for any live Grok reply, including `simulate` and `POST /chat`. Tests do not call xAI.
- **Sendblue**. Required only when `DRY_RUN=false` and you want real iMessage. Not required for tests, the REPL, or the web chat while dry-run is on.
- **A tunnel** (cloudflared or ngrok) only when Sendblue has to reach your laptop.

No database account. The mock graph is fictional demo data with `555` numbers.

## Backend contract

Base URL is `BACKEND_URL`. Each call times out after 4 seconds. A 404 on a single-resource GET is "not found". Any other non-2xx is an error.

- `GET /users/by-phone/:e164` → User or 404
- `GET /users/:id` → User or 404
- `GET /users/:id/phone` → `{ "phone": "+1..." }` (internal, only for sending an intro)
- `GET /clubs/resolve?q=` → `[{ "club", "confidence" }]` where confidence is `exact`, `alias`, or `fuzzy`
- `GET /clubs/:id` → Club or 404
- `GET /paths?userId=&clubId=` → `PathResult[]` (no phone numbers)
- `POST /intros` body `{ requesterId, connectorId, clubId, message }` → Intro
- `PATCH /intros/:id` body `{ "status" }` → Intro
- `GET /intros/:id` → Intro or 404
- `GET /intros?connectorId=&status=sent` → `Intro[]`

That last list route is how a connector's YES/NO text is matched after a restart. Path results must not include phone numbers. Only `GET /users/:id/phone` returns one, and only the bot uses it.

User shape: `{ id, name, phone, classYear?, college?, suggestible }`.

## Demo checklist

1. `cp .env.example .env`. Add the xAI key from console.x.ai. Set `DRY_RUN=true` until step 2 is done.
2. `npm i -g @sendblue/cli && sendblue setup`, then `sendblue show-keys` and `sendblue lines`. Fill in `SENDBLUE_API_KEY_ID`, `SENDBLUE_API_SECRET`, and `SENDBLUE_FROM_NUMBER`. Set `DRY_RUN=false`.
3. Free sandbox limitation: every phone that will text or receive texts must first be added with `sendblue add-contact +1...`, and that person must text the NEPO number once ("hi") before the bot can message them. Do this for the Maya phone and the Jordan phone before the demo.
4. Set `WEBHOOK_SECRET` to a random string. Start a tunnel (`npx cloudflared tunnel --url http://localhost:3000` or ngrok). Then run `sendblue webhooks add --type receive "https://<tunnel>/webhooks/sendblue?secret=<WEBHOOK_SECRET>"`. Set `PUBLIC_BASE_URL` to the tunnel origin with no trailing slash and restart. If cloudflared restarts, the URL changes and this step has to be repeated. Keep the Mac awake with `caffeinate -dimsu`.
5. Set `DEMO_MAYA_PHONE` and `DEMO_JORDAN_PHONE` to real team phones, then `npm run dev`.
6. Rehearse: "I want to be on YSIG" → "yes" → "send" → Jordan replies "YES" → Maya gets the accepted text. Also test the web chat at `/`.

Seed story, all fictional: Maya Chen (`+15550000001`) asks about YSIG. Jordan Hale (`+15550000002`) is a 1-hop analyst. Priya is not in YSIG and knows board member Sam. YPU is one 2-hop path. Whiffenpoofs has none.
