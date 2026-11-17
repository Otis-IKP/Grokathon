# Yale NEPO — the app

Warm intros into Yale clubs. A student says which club they want; NEPO finds the friend best placed to
introduce them, drafts the ask, and tracks the intro.

This repository is the web app and backend (Otis's part): identity, the friend graph, the club graph,
path finding, intros, the Bot API that Tobi's Grok iMessage agent calls, and the mobile-first UI.
The full build spec is in [Grokathon-Otis-App.md](Grokathon-Otis-App.md).

## Run it locally

Needs Node 22+ and pnpm. No database install and no API keys are required: by default the app uses an
embedded Postgres (PGlite) stored in `.data/`, and Yalies and xAI are mocked.

```bash
pnpm install
cp .env.example .env.local     # defaults work as they are
pnpm db:migrate                # create the schema
pnpm db:seed                   # 20 clubs and the demo people
pnpm dev                       # http://localhost:3000
```

On the sign-in page, use the development sign-in box with `demo_maya` (also `demo_jordan`, `demo_priya`).
Search for YSIG: Jordan is the first path, Priya through Sam the second. Any other NetID from
`tests/fixtures/yalies/people.json` (for example `bo107`) signs in as a brand-new student and goes
through onboarding.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | App on :3000 |
| `pnpm db:migrate` | Apply migrations in `drizzle/` |
| `pnpm db:seed` | Load demo data. `pnpm db:seed --purge` removes every demo person |
| `pnpm worker` | Job worker loop for agent jobs (LinkedIn, validation, roster crawls, research) |
| `pnpm sync:directory` | Bulk-import Yale College from Yalies into `people` |
| `pnpm crawl:clubs` | Queue a roster crawl for every club (`--force` ignores the 14-day TTL) |
| `pnpm gen:bot-tools` | Regenerate `docs/bot-tools.json` and the Bot API section of `docs/api.md` |
| `pnpm test` | Unit and integration tests (Vitest, in-memory Postgres, no network) |
| `pnpm test:e2e` | Playwright run of the demo script (`pnpm exec playwright install chromium` once) |
| `./scripts/bot-smoke.sh` | The whole bot conversation over HTTP against a running dev server |
| `pnpm typecheck`, `pnpm lint`, `pnpm build` | Checks and production build |
| `pnpm db:generate` | Generate a migration after changing `src/server/db/schema.ts` |

## Mock mode and real mode

`MOCK_EXTERNAL=1` (the default in `.env.example`, and always in tests) means the app never calls Yalies
or xAI. The directory is served from `tests/fixtures/yalies/people.json` and each agent returns a
fixture from `tests/fixtures/xai/{agent}/`. Mocked agents find nothing by default, so a self-reported
club stays "Self-reported"; `demo_maya` has fixtures that make the LinkedIn step produce a verified club.

For real data set `MOCK_EXTERNAL=0` and fill in:

- `YALIES_API_KEY` — from the Yalies API page after signing in with a NetID. Then run `pnpm sync:directory`
  once so roster names can be matched to people.
- `XAI_API_KEY` and `XAI_MODEL` — check the model id on the xAI models page.
- `APP_URL` — Yale CAS redirects back to `{APP_URL}/api/auth/cas/callback`. If CAS refuses the service URL
  in some environment, keep using `DEV_LOGIN_ENABLED=1` locally; it is always off when `NODE_ENV=production`.

Yalies has been checked against the live API (2026-11-17): the field names match `src/server/yalies/types.ts`,
`page` is 0-based, `page_size: 100` is accepted, and the client drops the phone, address, birthday and
friend/like data the API returns. xAI has not been called with a real key yet; see "Not yet verified" below.

## Database

`DATABASE_URL` takes two forms:

- `pglite://./.data/pg` — embedded Postgres in a local folder. Only one process can open it, so while
  `pnpm dev` is running, the scripts (`db:migrate`, `db:seed`, `worker`, `sync:directory`, `crawl:clubs`)
  detect that and run through the dev server instead. Nothing to remember; it just works either way.
- `postgres://…` — real Postgres (Neon, Supabase, Docker). Needs the `pgcrypto`, `citext` and `pg_trgm`
  extensions, which the first migration creates. Use this for any deployment.

## Deploying (Vercel + Neon)

1. Create a Neon database and set `DATABASE_URL` to its `postgres://` URL.
2. Set `APP_URL`, `SESSION_SECRET` (32+ random characters), `BOT_API_SECRET`, `CRON_SECRET`,
   `BOT_PHONE_DISPLAY`, `ADMIN_NETIDS`, `YALIES_API_KEY`, `XAI_API_KEY`, `XAI_MODEL`, and `MOCK_EXTERNAL=0`.
   Leave `DEV_LOGIN_ENABLED` unset. Optional: `WEBSITE_ORIGIN` (Arden's site, for CORS on the graph
   endpoint) and `BOT_WEBHOOK_URL` (Tobi's endpoint for "your connector replied").
3. Run `pnpm db:migrate` and `pnpm db:seed` against that database from your machine.
4. `vercel.json` schedules `/api/internal/jobs/tick` every minute (Vercel sends `CRON_SECRET` as the
   bearer token). Per-minute crons need a paid Vercel plan; on the free plan jobs still run right after
   the request that queued them, and you can hit the tick endpoint from any external cron.

## For Tobi (bot) and Arden (website)

- **Tobi:** paste `docs/bot-tools.json` into the Grok agent. `docs/api.md` maps each tool to its endpoint.
  Every call sends `Authorization: Bearer {BOT_API_SECRET}`. `./scripts/bot-smoke.sh` shows the whole
  conversation as curl calls. You also need the deployed base URL and the secret from Otis.
- **Arden:** link "Sign in" to `{APP_URL}/login`. For the path graph, the requester calls
  `POST /api/paths/{searchId}/share` (the "Share this path" button does it) and your page reads
  `GET {APP_URL}/api/public/graph/{share_token}` → `{ nodes, edges }`. Tokens last 24 hours. Tell Otis your
  site's origin so it can be set as `WEBSITE_ORIGIN`.

## How the code is laid out

- `src/server/**` — all business logic, as plain functions that take a db handle. Memberships are only
  written through `memberships/service.ts` and intros through `intros/service.ts`.
- `src/app/api/**` — thin route handlers. Each one is built with a wrapper from `src/server/api/route.ts`
  (`appRoute`, `botRoute`, `adminRoute`, `cronRoute`, `publicRoute`) that does authentication and error
  shaping; a test fails if a route is not.
- `src/server/xai/runAgent.ts` — the one place that calls Grok. `src/server/agents/` holds the six agents
  and their prompts; `src/server/jobs/` the queue and handlers.
- `src/server/paths/` — `findPaths.ts`, `score.ts` (all weights in one constant), `explain.ts`.
- `src/app/(app)/**` — the signed-in screens; `src/components/**` — UI.
- `tests/unit/privacy.test.ts` and `privacy.routes.test.ts` — one or more tests per privacy rule in section 12.

## Where this differs from the spec

- **Local database.** The spec assumes Docker Postgres. This machine had neither Docker nor Postgres, so
  local development uses embedded PGlite; the code path for real Postgres is the same Drizzle code.
- **Yalies paging is 0-based.** The Yalies wiki says `page` is the start index of the page, default 0;
  the spec said 1. The client and bulk sync start at page 0.
- **Two schema additions:** `path_searches.share_expires_at` (the 24-hour share expiry) and
  `users.linkedin_job_id` (so `/api/linkedin/status` can read what the latest job found).
- **Extra endpoints:** `GET /api/friends/suggestions`, `GET /api/admin/overview`,
  `POST /api/admin/clubs/crawl-all`, `POST /api/auth/dev-login`, and the development-only
  `POST /api/internal/dev/task`.
- **`PersonCard` plus one field in friend lists:** entries in `GET /api/friends` also carry
  `friendship_id`, which the UI needs to accept, decline or remove.
- **Sign-out** goes on to Yale's CAS logout only for CAS sessions; a dev-login session returns to `/login`.
- **Not built (P2 in the spec):** the "Connect LinkedIn" OpenID badge.

## Not yet verified

These need real credentials or a real phone, which were not available while building:

- **Yale CAS** sign-in against `secure.its.yale.edu` (ticket parsing and the service URL are unit-tested).
- **xAI** live calls: the request shape follows the Responses API docs; citations are read from the
  top-level `citations` array and from `url_citation` annotations. Confirm on the first real run that
  evidence URLs survive the integrity check (look at an agent run in `/admin`).
- **`sms:` links** ("Text it", "Copy and open Messages") on a real iPhone.
- **LinkedIn PDF upload** with a real "Save to PDF" export (the pipeline after text extraction is tested).

Before this runs beyond a hackathon demo, check the Yalies API terms and Yale's policies on directory data.
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
