# NEPO messaging bot

A student texts the NEPO number, for example "I want to be on YSIG". The bot finds the warmest path through their friends, drafts an intro, and either hands back a one-tap iMessage draft or texts the connector after the student replies "send".

**This folder is the bot to demo.** `bot/` is an older Python scaffold. Do not start that one.

Otis's app can replace the in-memory graph by setting `BACKEND_MODE=http`. Grok is called only through `https://api.x.ai/v1`.

## Presenting tonight

There is no hosted server. The bot is one Node process on Tobi's Mac, and Sendblue reaches it through a quick Cloudflare tunnel. The tunnel URL dies when that process dies, and a new URL will not match the webhook or `PUBLIC_BASE_URL` until someone repeats the tunnel step below.

It keeps working only if this Mac stays plugged in with the lid open. `caffeinate -dimsu` is already running, but closing the lid still sleeps the machine and the demo stops. Taking the laptop home stops it too.

Check that it is still up:

```bash
curl http://127.0.0.1:3000/health
curl https://matters-destiny-basket-patch.trycloudflare.com/health
```

Both should return `{"ok":true,"backend":"mock","dryRun":false}`. If the second one fails, the tunnel is dead even if the first one works. Do the tunnel step again. Do not invent a new host. The conversation, the pending intro, and the draft link all live in this one process.

### Who texts what

The real numbers are in `messaging/.env` on this Mac. That file is gitignored.

| Role | Env var | What they do |
| --- | --- | --- |
| Maya, the student | `DEMO_MAYA_PHONE` | Texts the bot: "I want to be on YSIG", then "yes", then "send" |
| Extra Maya phones | `DEMO_ALSO_PHONES` | Same student flow, Maya's graph |
| Jordan, the connector | `DEMO_JORDAN_PHONE` | Gets the intro text and replies YES or NO |

The NEPO number they text is `SENDBLUE_FROM_NUMBER` in that same file. On the free Sendblue plan, every phone in the table has to be added with `sendblue add-contact +1...` and has to text that number "hi" once before the bot can text them back. A phone that has not done this will not get the intro.

### The demo, in order

1. From Maya's phone, text the NEPO number: `I want to be on YSIG`
2. Reply `yes` when it offers to draft the intro.
3. Tap the link in the next text. Messages should open with the draft already filled in. That link is `PUBLIC_BASE_URL/d/<introId>`, which redirects to an `sms:` link. It only works while the tunnel in `PUBLIC_BASE_URL` is the one currently running.
4. Reply `send`.
5. From Jordan's phone, reply `YES`.
6. Maya's phone should get the accepted text.

Between runs, clear the in-memory session. The secret is `WEBHOOK_SECRET` in `.env`:

```bash
curl -X POST "http://127.0.0.1:3000/admin/reset?secret=THE_WEBHOOK_SECRET"
```

Web fallback, same process, same tunnel: open `PUBLIC_BASE_URL/` and type Maya's real phone, not the fictional `+15550000001`.

### If the tunnel or the bot died

From `messaging/`, with the existing `.env` still on this Mac:

```bash
npm run dev
npx cloudflared tunnel --url http://localhost:3000
```

Copy the new `https://….trycloudflare.com` URL. Then:

```bash
sendblue webhooks add --type receive "https://NEW_URL/webhooks/sendblue?secret=THE_WEBHOOK_SECRET"
```

Put that origin in `PUBLIC_BASE_URL` with no trailing slash, and restart `npm run dev` so it reloads `.env`. `tsx watch` does not reload env by itself. Leave cloudflared running. Do not run `sendblue webhooks set-receive`. That command does not exist.

Keys are already in `.env`: `XAI_API_KEY`, `SENDBLUE_API_KEY_ID`, `SENDBLUE_API_SECRET`. Do not commit that file. `DRY_RUN` must stay `false` for real iMessage.

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
