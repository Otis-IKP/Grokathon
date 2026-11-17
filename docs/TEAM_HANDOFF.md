# NEPO bot handoff

The demo bot is `messaging/`. `bot/` is an older Python scaffold. Do not start it, and do not demo it.

Repo: https://github.com/Otis-IKP/Grokathon

The bot is one Node process on Tobi's Mac. Sendblue reaches it through a Cloudflare quick tunnel. There is no hosted server. The Mac has to stay plugged in with the lid open. Closing the lid stops the demo even if `caffeinate -dimsu` is running.

## What a student can do right now

They text the NEPO number with a club, for example "I want to be on YSIG" or "I want to be on sketch comedy". The bot calls Grok (`grok-4.7` at `https://api.x.ai/v1`), resolves the club, finds a warm path, and drafts an intro. The student replies "yes", taps a link that opens Messages with the draft filled in, or replies "send". The connector's phone gets the intro. That person replies YES or NO. The accepted or declined text goes back to the phone that asked.

Any phone can ask. Any club name resolves. In the mock graph, Jordan Hale is a member of every club and Sam Okonkwo is on the board, so the live "send" has a connector whose number is real.

## Who is who

Tobi, Otis, and Arden are addressed by those names when they text. Jesse is addressed as Jesse when he asks for a club. When Jesse replies YES or NO he is the connector in the story the bot tells the student, Jordan Hale. The map is `DEMO_STUDENT_NAMES` in `messaging/src/backend/MockBackend.ts`.

The phone numbers and API keys are in `messaging/.env` on the demo Mac. That file is gitignored. Do not commit it, and do not paste the keys into this public repo. The shared Drive copy, with the phone map, is [NEPO bot handoff](https://docs.google.com/document/d/17YLnLekIi-4NvDZzLEvBV5DRbs4_WcV71G8LaDs5AUw/edit).

`DEMO_JORDAN_PHONE` is the connector. `DEMO_MAYA_PHONE` is Tobi. `DEMO_ALSO_PHONES` lists extra phones that should be able to run the student flow. A phone in `DEMO_STUDENT_NAMES` is addressed by that name even if it is also in `DEMO_ALSO_PHONES`.

On Sendblue's free plan, a phone has to be added with `sendblue add-contact` and has to text the NEPO number once before the bot can text it back.

## If the demo dies

From `messaging/` on the demo Mac, with the existing `.env`:

```bash
curl http://127.0.0.1:3000/health
npm run dev
npx cloudflared tunnel --url http://localhost:3000
```

Health should return `{"ok":true,"backend":"mock","dryRun":false}`. If cloudflared prints a new `https://….trycloudflare.com` URL, point Sendblue and `PUBLIC_BASE_URL` at it:

```bash
sendblue webhooks add --type receive "https://NEW_URL/webhooks/sendblue?secret=THE_WEBHOOK_SECRET"
```

`THE_WEBHOOK_SECRET` is `WEBHOOK_SECRET` in `.env`. Put the origin in `PUBLIC_BASE_URL` with no trailing slash, then restart `npm run dev`. `tsx watch` reloads code, not `.env`. Leave the old cloudflared process running unless it has already died. `sendblue webhooks set-receive` is not a real command.

Between rehearsals:

```bash
curl -X POST "http://127.0.0.1:3000/admin/reset?secret=THE_WEBHOOK_SECRET"
```

Web fallback, same process: open the tunnel origin in a browser and type the asker's real phone.

## How the code is split

- `src/index.ts` loads `.env`, checks that `GROK_MODEL` is in the xAI model list, and listens.
- `src/app.ts` mounts health, `POST /admin/reset`, `GET /d/:introId`, web chat, and the Sendblue webhook.
- `src/agent/handleMessage.ts` is the turn loop. Unknown phones become students. A connector's YES or NO is handled before Grok when that phone has a sent intro.
- `src/agent/systemPrompt.ts` is the voice and the flow. Edit this to change how the bot talks.
- `src/agent/tools.ts` is `resolve_club`, `get_club_info`, `find_paths`, `save_intro_draft`, and `send_intro`. `send_intro` only runs on a later turn, after an explicit "send".
- `src/backend/MockBackend.ts` is the in-memory graph used tonight. `HttpBackend.ts` calls Otis's API when `BACKEND_MODE=http`.
- `src/transport/sendblue.ts` sends texts and receives the webhook. `DRY_RUN=true` logs them instead.
- `messaging/README.md` is the backend contract Otis's API should match.

`save_intro_draft` stores `requesterPhone` on the intro so a YES returns to the phone that asked, not to `DEMO_MAYA_PHONE`. That field is not sent to Grok, and the HTTP client does not post it to Otis's API. It is kept on the intro after the create call.

## What you can change

| You want to | Edit |
| --- | --- |
| The bot's wording | `src/agent/systemPrompt.ts` |
| A teammate's name | `DEMO_STUDENT_NAMES` in `src/backend/MockBackend.ts` |
| Which real phone is the connector | `DEMO_JORDAN_PHONE` in `.env`, then restart `npm run dev` |
| The fictional graph | `src/backend/seed.ts` |
| Use Otis's API | `BACKEND_MODE=http` and `BACKEND_URL` |

Tests: `npm test` and `npm run typecheck` inside `messaging/`. From the repo root, `npm test` does the same thing.

## Prompt for Cursor or Claude

Paste this into a new chat opened on the repo:

```
You are finishing Yale NEPO with the team. The live demo bot is messaging/, not bot/. Read messaging/README.md and docs/TEAM_HANDOFF.md before you edit.

Grok is the only model, through https://api.x.ai/v1. Do not add another provider. Do not commit messaging/.env or print API keys.

The bot already texts, drafts, and sends. Keep that path working. Any phone can ask, any club name should resolve, and the connector's YES or NO must go back to the phone that requested the intro (intro.requesterPhone), not to DEMO_MAYA_PHONE.

Otis owns the app and API. When his API is up, set BACKEND_MODE=http and BACKEND_URL. The contract is in messaging/README.md. Arden owns the website. The iMessage bot stays in messaging/.

Run npm test and npm run typecheck in messaging/ before you stop.
```

## What is not this folder

Otis's app holds sign-in, friends, clubs, and the inbox. Arden's site is the landing page and the "text NEPO" call to action. Otis's note for Arden is in the shared Drive folder: "Yale NEPO: how the app works (for Arden)". The bot will keep using the mock graph until `BACKEND_MODE=http`.
