# NEPO messaging bot

A student texts the NEPO number, for example "I want to be on YSIG". The bot finds the warmest path through their friends, drafts an intro, and either hands back a one-tap iMessage draft or texts the connector after the student replies "send".

**This folder is the bot to demo.** `bot/` is an older Python scaffold. Do not start that one.

Otis's app can replace the in-memory graph by setting `BACKEND_MODE=http`. The model is Claude (`CLAUDE_MODEL`, default `claude-opus-5-5`), called through the Anthropic API with your own `ANTHROPIC_API_KEY`.

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

Any phone can text the bot, and any club name works. A number that is not already in the seed gets Maya's friends, and a club the bot has not heard of still resolves, with Jordan Hale as the warm path. The accepted or declined text goes back to the phone that asked, even when that phone is sharing Maya's graph.

Tobi, Otis, and Arden are addressed by those names. Jesse is addressed as Jesse when he asks for a club. When he replies YES or NO he is the connector in the story, Jordan Hale. The name map is `DEMO_STUDENT_NAMES` in `src/backend/MockBackend.ts`. Add a teammate there if the bot is using the wrong name.

The real numbers are in `messaging/.env` on the demo Mac. That file is gitignored. Do not commit it, and do not paste the keys into the public repo.

| Role | Env var | What they do |
| --- | --- | --- |
| Whoever is asking | any phone, or `DEMO_ALSO_PHONES` | Texts the bot with a club, then "yes", then "send" |
| Jordan, the connector | `DEMO_JORDAN_PHONE` | Gets the intro text and replies YES or NO |

The NEPO number they text is `SENDBLUE_FROM_NUMBER` in that same file. On the free Sendblue plan, a phone has to be added with `sendblue add-contact +1...` and has to text that number once before the bot can text it back. A phone that has not done this can still text in, but the reply or the intro will not arrive.

### The demo, in order

1. From any phone, text the NEPO number with a club. "I want to be on YSIG" is the example. "I want to be on sketch comedy" works too.
2. Reply `yes` when it offers to draft the intro.
3. Tap the link in the next text. Messages should open with the draft already filled in. That link is `PUBLIC_BASE_URL/d/<introId>`, which redirects to an `sms:` link. It only works while the tunnel in `PUBLIC_BASE_URL` is the one currently running.
4. Reply `send`.
5. From Jordan's phone, reply `YES`.
6. The phone that asked should get the accepted text.

Between runs, clear the in-memory session. The secret is `WEBHOOK_SECRET` in `.env`:

```bash
curl -X POST "http://127.0.0.1:3000/admin/reset?secret=THE_WEBHOOK_SECRET"
```

Web fallback, same process, same tunnel: open `PUBLIC_BASE_URL/?secret=THE_WEBHOOK_SECRET` and type Maya's real phone, not the fictional `+15550000001`.

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

Keys go in `.env`: `ANTHROPIC_API_KEY`, `SENDBLUE_API_KEY_ID`, `SENDBLUE_API_SECRET`. An old `.env` with only `XAI_API_KEY` will not start; add `ANTHROPIC_API_KEY`. Do not commit that file. `DRY_RUN` must stay `false` for real iMessage.

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

Web fallback (no iMessage): open `http://localhost:3001/?secret=THE_WEBHOOK_SECRET` and use Maya's phone, `+15550000001`. The chat refuses requests without the secret, because it can act as any phone.

## What you need accounts for

- **Anthropic API key** (`ANTHROPIC_API_KEY` from [platform.claude.com](https://platform.claude.com)). Required for any live reply, including `simulate` and `POST /chat`. Tests do not call the API. Startup checks the key and `CLAUDE_MODEL` and logs a warning if either is wrong.
- **Sendblue**. Required only when `DRY_RUN=false` and you want real iMessage. Not required for tests, the REPL, or the web chat while dry-run is on.
- **A tunnel** (cloudflared or ngrok) only when Sendblue has to reach your laptop.

No database account. The mock graph is fictional demo data with `555` numbers.

## On Vercel

The repo-root `vercel.json` deploys this folder as the `messaging` service, public under `/bot` on the
same domain as the app. Vercel strips the `/bot` prefix before Express sees the request, so the routes in
`src/app.ts` are unchanged. `src/index.ts` default-exports the app for Vercel and still listens on `PORT`
when run with `npm run dev`.

- Sendblue webhook: `https://<domain>/bot/webhooks/sendblue?secret=THE_WEBHOOK_SECRET`
- `PUBLIC_BASE_URL=https://<domain>/bot` (no trailing slash), so draft links become `/bot/d/<introId>`
- Admin reset: `POST https://<domain>/bot/admin/reset?secret=THE_WEBHOOK_SECRET`
- Web chat: `https://<domain>/bot/?secret=THE_WEBHOOK_SECRET`
- Set the same variables as `.env` in the Vercel project (`ANTHROPIC_API_KEY`, `WEBHOOK_SECRET`, the Sendblue keys, ...).
- With `BACKEND_MODE=http`: `BACKEND_URL=https://<domain>`, `BACKEND_API_SECRET` = the app's `BOT_API_SECRET`, `SIGNUP_URL=https://<domain>/login`, and the app's `BOT_WEBHOOK_URL=https://<domain>/bot/webhooks/app`.

Sessions, pending intros, the YES/NO window and the mock graph's intros live in process memory. On Vercel that memory can be
lost or split between function instances, so a conversation may forget its pending intro, and a connector's YES may go to the
model instead (they can still answer at the app link in the request). The Sendblue webhook also answers 200 before processing
the message, and Vercel may stop the function once the response is sent. The Mac plus tunnel setup above has neither problem.
Persist sessions and process the webhook before responding (or with `waitUntil`) before relying on the hosted bot.

## Backend contract

With `BACKEND_MODE=http` the bot calls the NEPO app's Bot API at `BACKEND_URL`, sending
`Authorization: Bearer {BACKEND_API_SECRET}` (the app's `BOT_API_SECRET`) and identifying every texter by
phone. `src/backend/HttpBackend.ts` is the client; the app documents the routes in `docs/api.md` at the repo root.

| Bot needs | App route |
| --- | --- |
| Who is texting | `POST /api/bot/whoami` (unknown phone → sign-up text) |
| Link a phone with the app's 6-digit code | `POST /api/bot/link-phone` |
| Match a club / club details | `POST /api/bot/resolve-club`, `POST /api/bot/club` |
| Paths | `POST /api/bot/find-paths` (returns a `search_id` the intro is created from) |
| Save a draft / read it / mark it sent | `POST /api/bot/intros`, `GET /api/bot/intros/{id}?phone=`, `POST /api/bot/intros/{id}/sent` |
| Connector's phone, to text the intro | `POST /api/bot/intros/{id}/connector-phone`: only for a connector who linked their own phone; otherwise null and the student sends it themselves |
| Connector replied YES/NO by text | `POST /api/bot/intros/{id}/respond` |
| Connector answered in the app | the app posts to this bot's `POST /webhooks/app` (same bearer secret), and the bot texts the requester |

A connector's YES/NO counts only right after the bot texted them the request; the request text also
carries the app link (`/i/{token}`) so they can answer there instead. The tap-to-send draft link
(`/d/{introId}`) works only while the intro is a draft and for 24 hours.

## Demo checklist

1. `cp .env.example .env`. Add your Anthropic API key. Set `DRY_RUN=true` until step 2 is done.
2. `npm i -g @sendblue/cli && sendblue setup`, then `sendblue show-keys` and `sendblue lines`. Fill in `SENDBLUE_API_KEY_ID`, `SENDBLUE_API_SECRET`, and `SENDBLUE_FROM_NUMBER`. Set `DRY_RUN=false`.
3. Free sandbox limitation: every phone that will text or receive texts must first be added with `sendblue add-contact +1...`, and that person must text the NEPO number once ("hi") before the bot can message them. Do this for the Maya phone and the Jordan phone before the demo.
4. Set `WEBHOOK_SECRET` to a random string. Start a tunnel (`npx cloudflared tunnel --url http://localhost:3000` or ngrok). Then run `sendblue webhooks add --type receive "https://<tunnel>/webhooks/sendblue?secret=<WEBHOOK_SECRET>"`. Set `PUBLIC_BASE_URL` to the tunnel origin with no trailing slash and restart. If cloudflared restarts, the URL changes and this step has to be repeated. Keep the Mac awake with `caffeinate -dimsu`.
5. Set `DEMO_MAYA_PHONE` and `DEMO_JORDAN_PHONE` to real team phones, then `npm run dev`.
6. Rehearse: "I want to be on YSIG" → "yes" → "send" → Jordan replies "YES" → Maya gets the accepted text. Also test the web chat at `/`.

Seed story, all fictional: Maya Chen (`+15550000001`) asks about YSIG. Jordan Hale (`+15550000002`) is a 1-hop analyst. Priya is not in YSIG and knows board member Sam. In the live mock, Jordan is also a member of every club and Sam is on the board, so a demo ask about any club still has a real connector to text.

## Change it

Open this repo in Cursor or Claude and point it at `messaging/`. The model call is in `src/agent/handleMessage.ts`. Leave `bot/` alone.

| Change | Where |
| --- | --- |
| What the bot says, and whose name it uses | `src/agent/systemPrompt.ts` and `DEMO_STUDENT_NAMES` in `src/backend/MockBackend.ts` |
| Which phone is Maya, Jordan, or an extra student | `messaging/.env` on the demo Mac (`DEMO_MAYA_PHONE`, `DEMO_JORDAN_PHONE`, `DEMO_ALSO_PHONES`) |
| The fictional friends and clubs | `src/backend/seed.ts` |
| A club the bot has never heard of | `clubFromQuery` in `src/backend/MockBackend.ts` |
| When "send" is allowed | `send_intro` in `src/agent/tools.ts` |
| Where the YES/NO reply is delivered | `requesterPhone` on the intro, set in `save_intro_draft`, read in `answerAsConnector` |
| When a YES/NO counts as an intro answer | `src/agent/connectorAsks.ts`: only if the last text the bot sent that phone was the intro request |
| Otis's real API instead of the mock graph | `BACKEND_MODE=http`, `BACKEND_URL`, `BACKEND_API_SECRET`, `SIGNUP_URL`. The contract is the section above. |
| Model and thinking depth | `CLAUDE_MODEL`, `CLAUDE_EFFORT` in `.env` |

`docs/TEAM_HANDOFF.md` is the longer note for whoever is finishing the demo. The shared Drive copy, with the phone map, is [NEPO bot handoff](https://docs.google.com/document/d/17YLnLekIi-4NvDZzLEvBV5DRbs4_WcV71G8LaDs5AUw/edit). Phone numbers stay out of this public repo.
