# Yale NEPO — The App (Otis's part)

Build spec for the NEPO web app and backend. This README is written for the engineer or coding agent who will build it from an empty repository. Read it top to bottom once before writing code; sections 5 to 11 are the reference you will come back to.

---

## 1. What NEPO is, and what this repository owns

Yale NEPO gets students into clubs through people they already know. A student texts a Grok-powered iMessage bot "I want to be on YSIG". NEPO finds the friend best placed to introduce them to someone in that club, drafts the ask, and tracks the intro.

Three people are building it:

| Owner | Part | Relationship to this repo |
|---|---|---|
| Tobi | Grok iMessage bot (conversation, tool calling, sending texts) | **Calls this repo's Bot API** (section 9) |
| Arden | Marketing website, landing page, demo network visual | **Links to this app's `/login`** and reads the graph endpoint (section 9.4) |
| Otis | **The app: this repository** | — |

This repository owns everything that holds state or makes a decision:

1. **Identity.** Sign-in with Yale CAS, profile from the Yalies directory, phone linking so the bot knows who is texting.
2. **Friend graph.** Search the Yale directory (Yalies API), add friends, accept or decline requests.
3. **Club graph.** Club directory, who is in which club, and how sure we are. Populated by self-report, LinkedIn (URL or PDF), and Grok research agents that read and validate public sources.
4. **Path finding.** Given a requester and a club, return ranked connectors with an explanation.
5. **Intros.** Draft, send-tracking, and the inbox where a connector accepts or declines.
6. **Bot API.** The HTTP endpoints Tobi's Grok agent calls as tools.
7. **The web UI** for all of the above, mobile-first.

Out of scope here: the iMessage transport, the bot's conversation logic and system prompt, the landing page, pitch materials.

### Decisions already made (do not reopen)

- Mobile-first **web app**, not native. Installable as a PWA.
- **TypeScript, Next.js (App Router), Postgres.** One repo serves the UI and the API.
- **Yalies API** is the source of truth for who is at Yale and is how users find people to add as friends.
- **LinkedIn: URL first, PDF fallback.** The official LinkedIn API cannot return clubs or positions (section 7.1), so a Grok agent tries to read the public profile from the URL, and if that fails the user uploads LinkedIn's "Save to PDF" export of their own profile.
- **Coverage: any Yale student.** Agents may research club membership for anyone in the Yalies directory, not only signed-up users. This raises the privacy bar; section 12 is mandatory, not optional polish.
- **Grok (xAI API)** powers every agent. This is a Grok hackathon project.

---

## 2. The demo this must support

Everything is prioritised against this script. If a feature does not serve it, it is P2.

1. Maya signs in with her NetID. Her name, college and class year are already filled in from Yalies.
2. She links her phone by texting a 6-digit code to the NEPO number.
3. She searches the directory for Jordan and Priya and adds them. Jordan accepts on his phone.
4. She pastes her LinkedIn URL. Within a minute her clubs appear, each with a "verified" or "self-reported" badge and a source link.
5. She texts the bot "I want to be on YSIG". The bot calls `find_paths` and replies with two warm paths: Jordan is a YSIG analyst (verified from the YSIG site); Priya is friends with Sam, who is on the YSIG board.
6. The bot drafts a message to Jordan. Maya says "send". The intro appears in Jordan's NEPO inbox; he taps Accept.
7. Arden's site shows the path as a graph.

The flow must work on **seeded demo data** (section 14) with external services mocked, and on real data when keys are present.

---

## 3. Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js, App Router, TypeScript strict, current stable release | UI and API in one deploy |
| Package manager | pnpm | |
| Database | Postgres (Neon or Supabase), extensions `pg_trgm`, `citext`, `pgcrypto` | Recursive queries, fuzzy name search |
| ORM | Drizzle ORM with `drizzle-kit` migrations | Thin, lets you drop to raw SQL for path finding |
| Validation | zod on every request body, every agent output, every external response | Agents and external APIs return surprises |
| Styling | Tailwind CSS + shadcn/ui | Fast, consistent mobile UI |
| Sessions | Encrypted httpOnly cookie (`iron-session` or `jose`) | No auth provider needed; CAS does authentication |
| LLM | xAI Responses API via the `openai` npm package with `baseURL: https://api.x.ai/v1` | Supports built-in `web_search` plus custom functions in one call |
| PDF text | `unpdf` (or `pdf-parse` if it gives trouble in the deploy target) | Runs in serverless |
| File storage | None by default: PDF bytes are parsed in memory and discarded | Privacy, and one less service |
| Jobs | `jobs` table in Postgres, claimed with `FOR UPDATE SKIP LOCKED` | Agent runs take 10 to 90 seconds; no extra infra |
| Tests | Vitest, plus Playwright for one end-to-end happy path | |
| Deploy | Vercel + Neon. Works locally with Docker Postgres | |

Do not pin versions from memory. Install current stable versions and follow their current docs.

---

## 4. Repository layout

```
.
├── README.md
├── .env.example
├── drizzle.config.ts
├── docs/
│   ├── bot-tools.json          # Tool definitions Tobi pastes into the Grok agent (generated from section 9)
│   └── api.md                  # Generated endpoint reference
├── drizzle/                    # SQL migrations
├── scripts/
│   ├── seed.ts                 # Demo data (section 14)
│   ├── sync-directory.ts       # Bulk Yalies → people
│   ├── crawl-clubs.ts          # Enqueue roster crawls for every club
│   └── worker.ts               # Long-running job worker for local use
├── src/
│   ├── app/
│   │   ├── (auth)/login/page.tsx
│   │   ├── (app)/                      # Authenticated shell with bottom tab bar
│   │   │   ├── page.tsx                # Home: "Which club?" search
│   │   │   ├── onboarding/page.tsx
│   │   │   ├── friends/page.tsx
│   │   │   ├── clubs/page.tsx
│   │   │   ├── clubs/[slug]/page.tsx
│   │   │   ├── paths/[searchId]/page.tsx
│   │   │   ├── intros/page.tsx
│   │   │   ├── intros/[id]/page.tsx
│   │   │   ├── me/page.tsx
│   │   │   └── admin/page.tsx
│   │   ├── i/[token]/page.tsx          # Connector landing from a texted link
│   │   └── api/
│   │       ├── auth/cas/login/route.ts
│   │       ├── auth/cas/callback/route.ts
│   │       ├── auth/logout/route.ts
│   │       ├── me/...                  # App API (session auth), section 9.2
│   │       ├── directory/...
│   │       ├── friends/...
│   │       ├── clubs/...
│   │       ├── memberships/...
│   │       ├── linkedin/...
│   │       ├── paths/...
│   │       ├── intros/...
│   │       ├── bot/...                 # Bot API (bearer secret), section 9.3
│   │       └── internal/jobs/tick/route.ts
│   ├── server/
│   │   ├── db/{schema.ts,client.ts}
│   │   ├── auth/{cas.ts,session.ts,guards.ts}
│   │   ├── yalies/{client.ts,sync.ts,types.ts}
│   │   ├── xai/{client.ts,runAgent.ts}
│   │   ├── agents/
│   │   │   ├── profileReader.ts        # LinkedIn URL → affiliations
│   │   │   ├── profileExtractor.ts     # LinkedIn PDF text → affiliations
│   │   │   ├── membershipValidator.ts  # one claim → verdict + evidence
│   │   │   ├── rosterCrawler.ts        # one club → public member list
│   │   │   ├── personResearcher.ts     # one person → public affiliations
│   │   │   ├── introDrafter.ts
│   │   │   └── prompts/*.md
│   │   ├── clubs/{resolve.ts,aliases.ts}
│   │   ├── memberships/service.ts
│   │   ├── friends/service.ts
│   │   ├── paths/{findPaths.ts,score.ts,explain.ts}
│   │   ├── intros/service.ts
│   │   ├── jobs/{queue.ts,handlers.ts}
│   │   └── privacy/{visibility.ts,redact.ts}
│   ├── components/
│   └── lib/{errors.ts,phone.ts,names.ts,rateLimit.ts}
└── tests/
    ├── fixtures/{yalies/*.json,xai/*.json,linkedin/*.txt}
    ├── unit/
    └── e2e/
```

Keep all business logic in `src/server/**` as plain functions that take a db handle and typed input. Route handlers only parse, authorise, call a service, and shape the response. This lets the Bot API and the App API share one implementation and makes path finding testable without HTTP.

---

## 5. Environment

`.env.example` must contain every variable below with a comment.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `APP_URL` | yes | Public origin, no trailing slash. Used to build the CAS service URL and intro links. `http://localhost:3000` in dev |
| `SESSION_SECRET` | yes | 32+ random bytes for cookie encryption |
| `YALIES_API_KEY` | yes (real mode) | From the Yalies API docs page after signing in with a NetID |
| `YALIES_BASE_URL` | no | Default `https://api.yalies.io/v2` |
| `XAI_API_KEY` | yes (real mode) | xAI console |
| `XAI_MODEL` | no | Model id for agents. The xAI tool-calling docs use `grok-4.7` in their examples at the time of writing; check the models page and use the current one |
| `XAI_MODEL_FAST` | no | Cheaper model for extraction and drafting. Defaults to `XAI_MODEL` |
| `BOT_API_SECRET` | yes | Shared secret Tobi's service sends as a bearer token |
| `BOT_PHONE_DISPLAY` | yes | The NEPO number shown in the phone-linking screen, e.g. `+1 203 555 0100` |
| `ADMIN_NETIDS` | no | Comma-separated NetIDs with access to `/admin` |
| `CRON_SECRET` | yes (deploy) | Protects `/api/internal/jobs/tick` |
| `WEBSITE_ORIGIN` | no | Arden's site origin, for CORS on the graph endpoint |
| `BOT_WEBHOOK_URL` | no | Tobi's endpoint for intro-response notifications (section 9.3) |
| `MOCK_EXTERNAL` | no | `1` = never call Yalies or xAI; serve fixtures. Default in tests |
| `DEV_LOGIN_ENABLED` | no | `1` = show a "sign in as NetID" form that skips CAS. Must be refused when `NODE_ENV=production` |
| `ENRICH_MAX_JOBS_PER_HOUR` | no | Global cap on agent jobs. Default 120 |
| `ENRICH_PERSON_TTL_DAYS` | no | Re-research a person at most this often. Default 30 |
| `ENRICH_CLUB_TTL_DAYS` | no | Re-crawl a club roster at most this often. Default 14 |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | no | Only for the optional "Sign in with LinkedIn" badge (section 7.1) |

### Commands

```
pnpm install
pnpm db:migrate          # apply migrations
pnpm db:seed             # demo data
pnpm dev                 # app on :3000
pnpm worker              # job worker loop (dev)
pnpm sync:directory      # bulk import Yale College from Yalies
pnpm crawl:clubs         # enqueue a roster crawl per club
pnpm test                # vitest
pnpm test:e2e            # playwright
pnpm gen:bot-tools       # writes docs/bot-tools.json
```

---

## 6. Identity and Yale systems

### 6.1 Sign-in: Yale CAS

Yale's Central Authentication Service proves a person holds a NetID. This is the only sign-in method. It guarantees every user is a Yale affiliate, which the product and its privacy rules depend on.

Flow:

1. `GET /api/auth/cas/login?next=/path` redirects to
   `https://secure.its.yale.edu/cas/login?service={encodeURIComponent(SERVICE)}`
   where `SERVICE = {APP_URL}/api/auth/cas/callback?next={next}`.
2. CAS redirects back to `SERVICE` with `&ticket=ST-...`.
3. The callback validates server-side:
   `GET https://secure.its.yale.edu/cas/serviceValidate?service={encodeURIComponent(SERVICE)}&ticket={ticket}`.
   The response is XML. Success contains `<cas:authenticationSuccess><cas:user>NETID</cas:user>`. Failure contains `<cas:authenticationFailure code="...">`.
4. On success: lowercase the NetID, upsert the `people` row (6.2), upsert the `users` row, set the session cookie `{ userId, netid }`, redirect to `next` (default `/`, or `/onboarding` if onboarding is incomplete).

Details that cause bugs:

- The `service` string sent to `serviceValidate` must be **byte-identical** to the one sent to `login`, including the `next` parameter. Build it in one function and reuse it.
- Strip `ticket` from the URL before using it as the service.
- Only allow `next` values that are same-origin relative paths (start with `/`, not `//`).
- Parse the XML with a real parser or a strict regex on `<cas:user>`; never trust a NetID from the query string.
- Logout clears the cookie, then redirects to `https://secure.its.yale.edu/cas/logout`.
- If CAS refuses the service URL in some environment, do not work around it. Use `DEV_LOGIN_ENABLED` locally and report it.

### 6.2 Directory: Yalies API

Yalies is the student-run Yale directory. NEPO uses it for three things: filling in a new user's profile, powering "add a friend" search, and matching names found on club rosters to real NetIDs.

**Request**

```
POST {YALIES_BASE_URL}/people
Authorization: Bearer {YALIES_API_KEY}
Content-Type: application/json

{ "query": "jordan lee", "filters": { "school_code": ["YC"], "year": [2028, 2029] }, "page": 1, "page_size": 25 }
```

- `query` is free text. `filters` maps a field to a list of accepted values. Both are optional; send at least one.
- Look up one person with `{ "filters": { "netid": ["abc123"] } }`.
- The response is a JSON array of person objects. An empty array means no match.

**Fields NEPO reads** (treat every field as optional and nullable): `netid`, `upi`, `first_name`, `preferred_name`, `last_name`, `email`, `school_code`, `school`, `college`, `year`, `major`, `image`.

**Fields NEPO must not store** even though the API may return them: phone, birthday, home or room address, anything else not listed above. Drop them at the client boundary in `yalies/client.ts` with a zod schema that picks only the allowed fields.

Client rules:

- One module, `yalies/client.ts`, is the only place that calls Yalies. It handles the bearer header, a 10 s timeout, one retry on 5xx or network error, and `MOCK_EXTERNAL`.
- On first real call during development, log one raw response and confirm the field names above. If they differ, update the zod schema and this section. Do not guess.
- Cache everything into `people`. A person fetched once is served from Postgres afterwards and refreshed when `directory_synced_at` is older than 30 days.
- People who are missing from Yalies (some graduate students, people who opted out there) can still sign in through CAS. Create their `people` row with `directory_source = 'self'` and ask for their name in onboarding.

**Bulk sync** (`pnpm sync:directory`): page through `{ "filters": { "school_code": ["YC"] }, "page": n, "page_size": 100 }` until an empty page, upserting each person. Sleep 250 ms between pages. This is what makes roster matching possible and should be run once before the demo. If the API rejects `page_size: 100`, halve it until accepted.

### 6.3 Phone linking

Tobi's bot identifies a texter by phone number, so each user must link one. NEPO does this without an SMS provider:

1. The app shows: "Text **482913** to {BOT_PHONE_DISPLAY}". The code is 6 digits, single-use, valid for 10 minutes, stored in `phone_link_codes`.
2. The bot receives the text and calls `POST /api/bot/link-phone { phone, code }`.
3. The backend marks the phone verified on that user. The app screen polls `GET /api/me` every 2 s and advances when `phone_verified_at` is set.

This proves control of the number, because only that phone can send from it. Store phones in E.164 (`+12035550100`); normalise with `libphonenumber-js`, default region US. A phone can belong to one user; linking it to a second user unlinks it from the first.

### 6.4 Other Yale sources the agents may read

These are read by Grok's `web_search` tool, never by custom scrapers in this repo:

- Club websites and their "team", "board" or "members" pages.
- Yale Connect (`yaleconnect.yale.edu`), the official student organisation directory. Many pages need a login; the agent uses only what is public.
- Yale Daily News and other campus publications, for board announcements.
- Public LinkedIn pages as surfaced by search.

---

## 7. Club data: LinkedIn, agents and validation

### 7.1 What LinkedIn's API can and cannot do

Read this before designing anything around LinkedIn.

- The only self-serve LinkedIn product for reading member data is **Sign In with LinkedIn using OpenID Connect**. It returns the signed-in member's own name, photo and email. It does not return positions, organisations, education or the profile URL, and it cannot read any other member.
- Profile and position APIs are restricted to approved partners. A hackathon team will not get access.
- Automated scraping of LinkedIn behind a login breaks LinkedIn's terms. **This repo must never log in to LinkedIn, store LinkedIn cookies, or drive a headless browser against it.**

So "use the LinkedIn API" is implemented as three layers, in this order:

| Layer | Who it works for | How |
|---|---|---|
| A. Profile URL + Grok reader | Anyone with a public profile | The user pastes their URL. A Grok agent with `web_search` tries to read the public page and search snippets. LinkedIn often blocks this; the agent must say so rather than guess. |
| B. Profile PDF | Signed-up users only | On their own LinkedIn profile the user chooses More → Save to PDF and uploads the file. Text is extracted locally and passed to a Grok agent. Reliable, and consented by construction. |
| C. Public-source research | Any Yale student | Grok agents read club rosters and campus sources (7.4, 7.5). No LinkedIn login involved. |

Optional P2: a "Connect LinkedIn" button using OpenID Connect that shows a "LinkedIn account connected" badge when the LinkedIn name matches the Yale name. It adds trust, not data. Skip it unless everything else is done.

### 7.2 The pipeline

```
 LinkedIn URL ──► profileReader ──┐
                                  ├─► affiliations[] ─► resolveClub ─► memberships (status: claimed)
 LinkedIn PDF ──► profileExtractor┘                                         │
                                                                             ▼
 self-report in UI ─────────────────────────────────────────────► membershipValidator (one job per claim)
                                                                             │
 rosterCrawler (per club) ──► names ─► match to people ─► memberships ◄──────┘
 personResearcher (per person, on demand) ─► affiliations[] ─► same path as above
```

Every arrow that involves Grok is a **job** (section 10). Nothing in a request handler waits on an agent, except the intro drafter, which is fast.

### 7.3 Calling Grok: `xai/runAgent.ts`

All agents go through one function so that tool handling, validation, logging and mocking live in one place.

```ts
type AgentSpec<T> = {
  name: string;                    // 'membershipValidator'
  model?: string;                  // defaults to XAI_MODEL
  system: string;                  // from agents/prompts/*.md
  user: string;                    // task input, as tagged text
  webSearch: boolean;              // include { type: 'web_search' }
  submit: {                        // the single custom function the agent must call to finish
    name: string;                  // 'submit_verdict'
    description: string;
    schema: z.ZodType<T>;          // also converted to JSON Schema for the tool definition
  };
  maxTurns?: number;               // default 3
};

async function runAgent<T>(spec: AgentSpec<T>, ctx: { jobId?: string }): Promise<{ output: T; citations: string[] }>;
```

How it works:

1. `POST https://api.x.ai/v1/responses` with `model`, `input` (system + user messages) and `tools`: `{ "type": "web_search" }` when `webSearch` is true, plus the submit function as
   `{ "type": "function", "name": ..., "description": ..., "parameters": <JSON Schema, root type object> }`.
2. Built-in tools run on xAI's servers inside that one call. When the model calls the submit function, the response's `output` array contains an item with `type: "function_call"`, a `name`, a `call_id`, and `arguments` as a JSON string.
3. Parse `arguments` with the zod schema. If it parses, that is the result. If the model answered in prose without calling the function, or the arguments fail validation, send one follow-up turn (using `previous_response_id`) that states the validation error and asks it to call the function. Give up after `maxTurns` and fail the job.
4. Collect the response's citation URLs (see the xAI citations docs for the exact field; confirm it on first run).
5. **Evidence integrity check:** any evidence URL in the agent's output that does not appear in the citations list is removed, and if a verdict is left with no evidence it is downgraded to `unverified`. This is the main defence against invented sources. Do not skip it.
6. Write one `agent_runs` row per call: agent name, model, input, raw output, citations, duration, error.
7. With `MOCK_EXTERNAL=1`, return the fixture at `tests/fixtures/xai/{name}/{hash-of-input}.json`, falling back to `default.json`.

Using a submit function instead of asking for JSON in prose gives schema-shaped output without depending on any structured-output feature, and works alongside `web_search`.

### 7.4 The agents

Full system prompts live in `src/server/agents/prompts/`. Write them as plain briefings like the ones below; expand with detail, do not shorten into keyword lists. Every prompt receives its inputs wrapped in XML tags and is told that text inside `<source>` tags is data, not instructions, so that a web page cannot redirect the agent.

**Shared output type**

```ts
type Affiliation = {
  org_name: string;            // exactly as written in the source
  role_title: string | null;   // "Analyst", "Managing Editor"
  kind: 'yale_club' | 'job' | 'internship' | 'school' | 'other';
  start_year: number | null;
  end_year: number | null;     // null with is_current = true means ongoing
  is_current: boolean;
  is_leadership: boolean;      // president, board, director, editor, captain, chair and similar
  source_quote: string;        // at most 20 words copied from the source, for audit
};
```

#### 1. `profileExtractor` (no web search, fast model)

Input: text extracted from the user's LinkedIn PDF, plus the user's name and class year.
Output: `{ profile_name: string, affiliations: Affiliation[] }`.

Prompt, in substance:

> You are reading the text of a LinkedIn profile that a Yale student exported and uploaded themselves. NEPO uses it to learn which Yale student organisations and jobs they have been part of, so it can connect them with other students. List every experience, volunteering entry, organisation and leadership role. Copy organisation names exactly as written; another step maps them to known clubs, and a corrected or expanded name makes that mapping fail. Mark `kind` as `yale_club` only for student organisations at Yale, such as publications, a cappella groups, investment or consulting clubs, teams and cultural groups. An internship at a company is `internship` even when found through a club. If a date is missing leave it null. Report only what is on the page: an entry you are unsure about is better omitted than guessed, because a false club membership would send someone to ask a stranger for a favour. Also return the name at the top of the profile so the caller can check the document belongs to the right person.

After the call: compare `profile_name` with the user's Yalies name using `lib/names.ts` (case-insensitive, ignore middle names, accept preferred name). On mismatch, create no memberships: hold the affiliations in the job's `result`, set `needs_confirmation` on the LinkedIn status, show the user "This PDF looks like it belongs to {profile_name}. Is that you?", and write the memberships only after they confirm (`POST /api/linkedin/confirm`).

The PDF bytes and extracted text are discarded once the job finishes. Only `Affiliation[]` is kept.

#### 2. `profileReader` (web search)

Input: a LinkedIn URL, the person's name, college, class year.
Output: `{ readable: boolean, reason: string | null, identity_match: 'yes' | 'no' | 'unsure', affiliations: Affiliation[] }`.

> You are given the public LinkedIn URL of a Yale student. Try to read what the public page shows about their experience, organisations and volunteering, using web search and by opening the page. LinkedIn frequently shows a sign-in wall to automated readers. If you cannot see the experience section, set `readable` to false and say why; the app will then ask the student for a PDF instead, so an honest "could not read" costs nothing while a guess creates false data. Use only what the page or a search result snippet for this exact URL shows. Do not fill gaps from other people with the same name. Set `identity_match` by checking that the profile mentions Yale and is consistent with the name and class year you were given.

If `readable` is false or `identity_match` is not `yes`, store nothing and set the LinkedIn status to `needs_pdf` (or `mismatch`).

#### 3. `membershipValidator` (web search)

Input: one claim (person name, college, class year, club name and aliases, club website if known, claimed role, claimed years, where the claim came from).
Output:

```ts
type Verdict = {
  verdict: 'confirmed' | 'likely' | 'not_found' | 'contradicted';
  confidence: number;          // 0 to 1
  role_found: string | null;
  is_board: boolean | null;
  evidence: { url: string; quote: string; source_type: 'club_site' | 'yale_connect' | 'campus_news' | 'linkedin' | 'other' }[];
  reasoning: string;           // two or three sentences
};
```

> NEPO has a claim that a specific Yale student belongs to a specific student organisation. Your job is to check it against public sources and report what you found. Look first at the club's own website (team, board, members, about pages), then Yale Connect, then campus news such as the Yale Daily News, then public search results. A match needs the same person: the same full name and, where the page shows it, a class year or college consistent with the one given. Yale has students who share names, so a bare name match on an unrelated page is weak evidence. `confirmed` means a source controlled by the club or by Yale, or a campus news article, names this person in this club. `likely` means indirect evidence, for example a public LinkedIn snippet or a single third-party page. `not_found` means you searched and found nothing either way; that is a normal, useful answer, since most general members are never listed publicly. `contradicted` means a current official roster exists, is complete, and omits them for the period claimed. Give the page URL and a short quote for each piece of evidence. Report only pages you opened in this session.

Mapping verdict to membership status:

| Verdict | Claim came from the person (self-report, own PDF, own URL) | Claim came from research on a non-user |
|---|---|---|
| `confirmed` | `verified` | `verified` |
| `likely` | `likely` | `likely` |
| `not_found` | stays `claimed` (shown as "self-reported") | `unverified` (hidden, never used in paths) |
| `contradicted` | `disputed` (shown to the owner only, not used in paths) | `rejected` |

#### 4. `rosterCrawler` (web search)

Input: one club (name, aliases, website if known).
Output: `{ roster_url: string | null, as_of: string | null, members: { full_name: string; role_title: string | null; is_board: boolean; class_year: number | null; college: string | null; quote: string }[], website: string | null, notes: string }`.

> Find the public page where this Yale student organisation lists its current board or members, and transcribe the list. Prefer the club's own site; then Yale Connect; then the most recent campus news article announcing its board. Copy names exactly as shown. Include a class year or college only when the page states it next to the name. If the only list you can find is from an earlier academic year, return it and say which year in `as_of`. If the club publishes no list, return an empty `members` array; do not assemble one from LinkedIn search results, because a roster the club did not publish is not reliable enough for this purpose.

After the call, match each name to `people` (section 7.6). This is the cheapest way to cover non-users: one run can yield twenty memberships, each `verified` with `source = 'public_roster'`. If `as_of` is an earlier academic year, store them as `likely` instead, since boards turn over every year.

#### 5. `personResearcher` (web search)

Input: one person from the directory (name, college, year, major), plus the list of known club names for context.
Output: `{ linkedin_url: string | null, affiliations: Affiliation[], evidence: { org_name: string; url: string; quote: string }[] }`.

> Find which Yale student organisations this student publicly belongs to. Search for their name with "Yale" and their class year, and look at club rosters, campus news and public profile snippets. You are building a record used to suggest warm introductions between students, so precision matters more than coverage: return an affiliation only when a page ties this specific person, not just this name, to the organisation. If you find a LinkedIn profile that clearly belongs to them, return its URL but take affiliations only from text you can see. Returning nothing is a correct result for a student with no public footprint.

Each affiliation it returns becomes a `claimed`-level candidate and is then run through `membershipValidator` rules: with at least one club-controlled or campus-news source it is `verified`; with only LinkedIn or third-party evidence, `likely`; otherwise it is dropped.

When it runs: when a user adds a non-user as a friend; when a path search finds fewer than 3 results and the requester has friends who have never been researched; from `/admin`. It is never run for someone with `visibility = 'hidden'`, and never more often than `ENRICH_PERSON_TTL_DAYS`.

#### 6. `introDrafter` (no web search, fast model, runs inline)

Input: requester first name, connector first name, club name, what the connector's link is (member, board, or knows a named member), relationship hints (same college, same class year), tone (`casual` default, `polite`), optional note from the requester.
Output: `{ message: string }`.

> Write the text a Yale student would send a friend to ask for an introduction to someone in a club. It is going out as an iMessage from one student to a friend, so it should read like one: two or three sentences, first names, no greeting line or sign-off, no exclamation-heavy enthusiasm, nothing that sounds like a recruiter or a cover letter. Say which club, make the ask specific (an intro to the person named, or a quick chat about how the club recruits), and make it easy to say no. Use only the facts provided; do not invent shared history.

### 7.5 Resolving organisation names to clubs: `clubs/resolve.ts`

`resolveClub(text) → { club: Club | null, candidates: Club[], confidence }`

1. Normalise: lowercase, strip punctuation, drop a leading "the", collapse whitespace, drop a leading "yale" for comparison purposes while keeping the original.
2. Exact match on `club_aliases.alias_norm`. Return with confidence 1.
3. Trigram similarity (`pg_trgm`) against all aliases. Take the best if similarity ≥ 0.6 and the runner-up is at least 0.15 behind. Confidence = similarity.
4. Otherwise return up to 3 candidates with `club: null`. The Bot API passes candidates back so the bot can ask "Did you mean…?". The UI shows a picker.

For affiliations from agents that resolve to no club and have `kind = 'yale_club'`: create a new `clubs` row with `status = 'unreviewed'`, the given name as its first alias, and enqueue a `rosterCrawler` job. Unreviewed clubs are searchable but flagged in `/admin`. Affiliations of kind `job` or `internship` are stored in `experiences` (section 8) and used only as display context.

### 7.6 Matching roster names to people: `lib/names.ts`

Given `full_name`, optional `class_year`, optional `college`:

1. Normalise both sides: lowercase, remove diacritics, punctuation and suffixes, split into tokens.
2. Candidates: `people` where last name matches and (first name or preferred name matches, or one is a prefix of the other with length ≥ 3, to catch "Sam"/"Samuel").
3. One candidate → match. Several → filter by class year, then college, if the roster gave them. Still several, or none → write to `unmatched_roster_names` for `/admin` and create no membership.

Never pick among ambiguous candidates. A wrong match attaches a club to the wrong person.

---

## 8. Data model

Postgres DDL. Implement as a Drizzle schema with the same names. All `id` columns are `uuid default gen_random_uuid()`. All tables have `created_at timestamptz not null default now()`; add `updated_at` where rows change.

```sql
create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;

-- Everyone at Yale that NEPO knows about. One row per NetID. Users and non-users alike.
create table people (
  netid               text primary key,                 -- lowercase
  upi                 text,
  first_name          text not null,
  preferred_name      text,
  last_name           text not null,
  email               citext,
  school_code         text,
  school              text,
  college             text,
  year                int,                              -- graduation year
  major               text,
  image_url           text,
  directory_source    text not null default 'yalies',   -- yalies | self | demo
  directory_synced_at timestamptz,
  linkedin_url        text,
  linkedin_url_source text,                             -- self | agent
  visibility          text not null default 'listed',   -- listed | hidden   (section 12)
  researched_at       timestamptz,                      -- last personResearcher run
  is_demo             boolean not null default false,
  search_name         text generated always as
                        (lower(coalesce(preferred_name, first_name) || ' ' || last_name)) stored
);
create index people_search_trgm on people using gin (search_name gin_trgm_ops);
create index people_last_name on people (lower(last_name));

-- People who have signed in.
create table users (
  id                  uuid primary key default gen_random_uuid(),
  netid               text not null unique references people(netid),
  phone_e164          text unique,
  phone_verified_at   timestamptz,
  onboarding_done_at  timestamptz,
  allow_as_connector  boolean not null default true,    -- can be suggested to friends as a connector
  share_connections   boolean not null default true,    -- friends may be routed through my friendships (2-hop)
  linkedin_status     text not null default 'none',     -- none | reading | ok | needs_pdf | mismatch | failed
  last_seen_at        timestamptz
);

create table phone_link_codes (
  code        text primary key,                         -- 6 digits
  user_id     uuid not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz
);

-- A friendship is one row. requester added addressee.
-- 'pending' also covers the case where the addressee has not signed up yet.
create table friendships (
  id               uuid primary key default gen_random_uuid(),
  requester_netid  text not null references people(netid),
  addressee_netid  text not null references people(netid),
  status           text not null default 'pending',     -- pending | accepted | declined | removed
  responded_at     timestamptz,
  check (requester_netid <> addressee_netid)
);
-- At most one row per unordered pair.
create unique index friendships_pair on friendships
  (least(requester_netid, addressee_netid), greatest(requester_netid, addressee_netid));
create index friendships_addressee on friendships (addressee_netid, status);

create table clubs (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,                     -- 'ysig'
  name         text not null,                            -- 'Yale Student Investment Group'
  short_name   text,                                     -- 'YSIG'
  category     text,                                     -- finance | consulting | publication | arts | politics | tech | service | sports | cultural | other
  website      text,
  description  text,
  status       text not null default 'active',           -- active | unreviewed | hidden
  roster_url   text,
  roster_crawled_at timestamptz,
  is_demo      boolean not null default false
);

create table club_aliases (
  club_id     uuid not null references clubs(id) on delete cascade,
  alias       text not null,
  alias_norm  text not null unique                       -- normalised form used for matching
);
create index club_aliases_trgm on club_aliases using gin (alias_norm gin_trgm_ops);

create table memberships (
  id              uuid primary key default gen_random_uuid(),
  netid           text not null references people(netid),
  club_id         uuid not null references clubs(id),
  role            text not null default 'member',        -- member | board | alum
  title           text,                                  -- 'Analyst', 'President'
  start_year      int,
  end_year        int,
  is_current      boolean not null default true,
  status          text not null,                         -- claimed | verified | likely | unverified | disputed | rejected
  confidence      real not null default 0.5,
  source          text not null,                         -- self_report | linkedin_pdf | linkedin_url | public_roster | web_research | seed
  last_checked_at timestamptz,
  unique (netid, club_id)
);
create index memberships_club on memberships (club_id, status);

create table membership_evidence (
  id             uuid primary key default gen_random_uuid(),
  membership_id  uuid not null references memberships(id) on delete cascade,
  url            text not null,
  quote          text,                                   -- short excerpt, max 300 chars
  source_type    text not null,                          -- club_site | yale_connect | campus_news | linkedin | other
  retrieved_at   timestamptz not null default now()
);

-- Jobs and internships from a user's own LinkedIn. Display context only. Users only, never non-users.
create table experiences (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  org_name    text not null,
  role_title  text,
  kind        text not null,                             -- job | internship | other
  start_year  int,
  end_year    int
);

create table unmatched_roster_names (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references clubs(id) on delete cascade,
  full_name   text not null,
  role_title  text,
  source_url  text,
  resolved_netid text references people(netid)
);

create table path_searches (
  id               uuid primary key default gen_random_uuid(),
  requester_netid  text not null references people(netid),
  club_id          uuid not null references clubs(id),
  channel          text not null,                        -- app | bot
  results          jsonb not null,                       -- the PathResult[] returned
  share_token      text unique                           -- for Arden's graph view
);

create table intros (
  id               uuid primary key default gen_random_uuid(),
  requester_netid  text not null references people(netid),
  connector_netid  text not null references people(netid),
  target_netid     text references people(netid),        -- the club member, when the path is 2-hop
  club_id          uuid not null references clubs(id),
  path_search_id   uuid references path_searches(id),
  message          text not null,
  status           text not null default 'drafted',      -- drafted | sent | accepted | declined | completed | cancelled
  channel          text not null,                        -- app | bot
  response_token   text not null unique,                 -- for /i/{token}
  connector_note   text,
  sent_at          timestamptz,
  responded_at     timestamptz
);
create index intros_connector on intros (connector_netid, status);

create table intro_events (
  id         uuid primary key default gen_random_uuid(),
  intro_id   uuid not null references intros(id) on delete cascade,
  type       text not null,                              -- created | edited | sent | viewed | accepted | declined | completed | cancelled
  actor_netid text,
  data       jsonb
);

create table jobs (
  id           uuid primary key default gen_random_uuid(),
  type         text not null,                            -- linkedin_read | linkedin_pdf | validate_membership | crawl_roster | research_person
  payload      jsonb not null,
  dedupe_key   text unique,                              -- e.g. 'crawl_roster:{club_id}'; null when not deduplicated
  status       text not null default 'queued',           -- queued | running | done | failed
  attempts     int not null default 0,
  run_after    timestamptz not null default now(),
  locked_at    timestamptz,
  finished_at  timestamptz,
  error        text,
  result       jsonb
);
create index jobs_ready on jobs (status, run_after);

create table agent_runs (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid references jobs(id) on delete set null,
  agent       text not null,
  model       text not null,
  input       jsonb not null,
  output      jsonb,
  citations   jsonb,
  duration_ms int,
  error       text
);
```

Invariants to enforce in services, with tests:

- A membership with `status in ('unverified','disputed','rejected')` is never returned by path finding or shown to anyone but its owner or an admin.
- A person with `visibility = 'hidden'` never appears in directory search, club pages, path results or agent inputs.
- Re-validation never lowers a `verified` membership to `claimed`; it can only move it to `disputed` on a `contradicted` verdict.
- When sources disagree on `role`, prefer `public_roster`, then the validator's `role_found`, then the claim.

---

## 9. APIs

### 9.1 Conventions

- JSON in and out. Errors: `{ "error": { "code": "club_not_found", "message": "…" } }` with an HTTP status. Codes are stable snake_case strings; define them once in `lib/errors.ts`.
- Every body is parsed with zod; a parse failure returns `400 invalid_request` with the zod issues.
- App API: session cookie. `401 unauthenticated` without one.
- Bot API: `Authorization: Bearer {BOT_API_SECRET}`, compared in constant time. `401` otherwise.
- People are identified by `netid` everywhere. The bot identifies its user by `phone`; every bot call that acts for a user sends `phone`, and the backend resolves it. Unknown phone → `404 user_not_linked`, and the bot tells the texter to sign up.
- A `PersonCard` is the only shape in which a person leaves the API:

```ts
type PersonCard = {
  netid: string;
  name: string;            // preferred or first name + last name
  first_name: string;
  college: string | null;
  year: number | null;
  image_url: string | null;
  is_user: boolean;
};
```

No email, phone, major or LinkedIn URL of another person is ever returned.

### 9.2 App API (session auth)

| Method and path | Purpose |
|---|---|
| `GET /api/me` | Current user: PersonCard, phone state, onboarding state, settings, linkedin_status, counts (friends, pending requests, inbox) |
| `PATCH /api/me` | Update `preferred_name`, `allow_as_connector`, `share_connections`, `visibility` |
| `POST /api/me/phone-code` | Create a link code. Returns `{ code, expires_at, bot_phone }` |
| `DELETE /api/me/phone` | Unlink phone |
| `DELETE /api/me` | Delete account: removes the user row, friendships, experiences, self-sourced memberships and intros; sets `visibility = 'hidden'` so research does not rebuild the profile |
| `GET /api/directory/search?q=` | Find Yale people to add. Local trigram search on `people`; if fewer than 8 results and `q` has 3+ characters, also query Yalies, upsert, merge. Returns `{ person: PersonCard, friendship: 'none' \| 'pending_out' \| 'pending_in' \| 'accepted' }[]`. Max 20. Rate limit 30 per minute per user |
| `GET /api/friends` | `{ friends: PersonCard[], incoming: …[], outgoing: …[] }` |
| `POST /api/friends` | `{ netid }`. Creates a pending friendship. If the reverse pending row exists, accepts it instead. If the addressee is not a user, returns `invite_url` (`{APP_URL}/login?ref={my netid}`) for the user to send, and enqueues `research_person` for the addressee |
| `POST /api/friends/{id}/accept` / `decline` | Addressee only. Because there is one row per pair, re-adding someone after `removed` or `declined` updates that row back to `pending` with the new requester |
| `DELETE /api/friends/{id}` | Either side. Sets `removed` |
| `GET /api/clubs?q=&category=` | Club list with member counts (visible memberships only) |
| `GET /api/clubs/{slug}` | Club, board and members as PersonCards with role and status badge, plus `my_paths_preview`: number of 1-hop and 2-hop connectors for me |
| `GET /api/memberships` | My memberships with status, source and evidence |
| `POST /api/memberships` | `{ club_id \| club_name, role, title?, start_year?, end_year? }`. Creates `claimed`, `source = self_report`, enqueues `validate_membership`. An unknown `club_name` goes through `resolveClub`; no match creates an unreviewed club |
| `PATCH /api/memberships/{id}` / `DELETE` | Owner only. Deleting a research-sourced membership sets it to `rejected` so it is not re-added |
| `POST /api/linkedin/url` | `{ url }`. Validates it is a `linkedin.com/in/…` URL, stores it, sets `linkedin_status = 'reading'`, enqueues `linkedin_read` |
| `POST /api/linkedin/pdf` | multipart, one PDF, max 5 MB. Extracts text in the handler, enqueues `linkedin_pdf` with the text in the payload, discards the bytes. Clear the text from the job payload when the job finishes |
| `GET /api/linkedin/status` | `{ status, found: Affiliation[], needs_confirmation: boolean }` for the onboarding screen to poll |
| `POST /api/linkedin/confirm` | `{ confirm: boolean }`. After a name mismatch: `true` writes the held affiliations as claims and enqueues validation; `false` discards them |
| `POST /api/paths/{searchId}/share` | Requester only. Returns `{ share_token, expires_at }` for the graph endpoint (section 9.4) |
| `POST /api/paths` | `{ club_id \| club_text }` → `{ search_id, club, results: PathResult[], pending_research: boolean }` (section 11) |
| `GET /api/paths/{searchId}` | A previous search, re-ranked if new data arrived |
| `POST /api/intros/draft` | `{ search_id, connector_netid, tone?, note? }` → `{ message }` |
| `POST /api/intros` | `{ search_id, connector_netid, target_netid?, message }` → intro in `drafted` |
| `GET /api/intros?box=incoming\|outgoing` | Lists |
| `GET /api/intros/{id}` | Requester or connector only |
| `PATCH /api/intros/{id}` | Requester: edit `message` while drafted; `{ action: 'mark_sent' \| 'cancel' \| 'complete' }` |
| `POST /api/intros/{id}/respond` | Connector: `{ decision: 'accept' \| 'decline', note? }` |
| `GET /api/intros/by-token/{token}` | For `/i/{token}`. Requires sign-in, and the signed-in NetID must be the connector |
| Admin (`ADMIN_NETIDS` only): `GET /api/admin/jobs`, `POST /api/admin/jobs/{id}/retry`, `POST /api/admin/clubs/{id}/crawl`, `PATCH /api/admin/clubs/{id}`, `POST /api/admin/roster-names/{id}/resolve`, `GET /api/admin/agent-runs?job_id=` |

### 9.3 Bot API (bearer secret) — the contract with Tobi

These are the tools the Grok agent calls. `pnpm gen:bot-tools` writes them to `docs/bot-tools.json` as xAI function definitions (flat objects with `type: "function"`, `name`, `description`, `parameters`) so Tobi can paste them in. Descriptions in that file should tell Grok when to call each tool, not just what it does.

Base path `/api/bot`. All are `POST` with a JSON body unless noted.

**`/link-phone`** — `{ phone, code }` → `{ linked: true, user: PersonCard }`. Errors: `invalid_code`, `code_expired`. Call when an unknown number texts a 6-digit number.

**`/whoami`** — `{ phone }` → `{ user: PersonCard, friends_count, clubs: { name, role }[], onboarding_done }`. `404 user_not_linked` if unknown. Call at the start of a conversation.

**`/resolve-club`** — `{ text }` → `{ club: ClubCard | null, candidates: ClubCard[], confidence }` where `ClubCard = { id, slug, name, short_name, category }`. Call with the club phrase from the user's message. If `club` is null, ask the user to choose among `candidates`.

**`/find-paths`** — `{ phone, club_id, limit? }` (default 3, max 5) → 

```json
{
  "search_id": "0b6c…",
  "club": { "id": "…", "slug": "ysig", "name": "Yale Student Investment Group", "short_name": "YSIG" },
  "results": [
    {
      "rank": 1,
      "score": 0.93,
      "hops": 1,
      "connector": { "netid": "jl2345", "name": "Jordan Lee", "first_name": "Jordan", "college": "Berkeley", "year": 2027, "image_url": null, "is_user": true },
      "connector_tie": "friend",
      "link": { "type": "member", "role": "member", "title": "Analyst", "status": "verified", "evidence_url": "https://…" },
      "target": null,
      "why": "Jordan is your friend and a YSIG analyst (confirmed on the club's site)."
    },
    {
      "rank": 2,
      "score": 0.52,
      "hops": 2,
      "connector": { "netid": "pk889", "name": "Priya Kapoor", "first_name": "Priya", "college": "Silliman", "year": 2028, "image_url": null, "is_user": true },
      "connector_tie": "friend",
      "link": { "type": "knows_member", "via": "friend" },
      "target": { "person": { "netid": "sw77", "name": "Sam Wu", "first_name": "Sam", "college": "Trumbull", "year": 2026, "image_url": null, "is_user": false }, "role": "board", "title": "President", "status": "verified" },
      "why": "Priya is your friend and is friends with Sam Wu, YSIG's president."
    }
  ],
  "pending_research": true,
  "empty_reason": null
}
```

`pending_research: true` means research jobs were just queued and a repeat call in a minute may return more. When `results` is empty, `empty_reason` is one of `no_friends`, `no_known_members`, `no_connection`, `already_member`, so the bot can give the right nudge ("add friends first", "we don't have YSIG's roster yet", "none of your friends are connected to YSIG yet", "you're already in YSIG").

**`/draft-intro`** — `{ phone, search_id, connector_netid, tone?, note? }` → `{ message }`. Tobi may draft in his own agent instead; this exists so the app and the bot produce the same voice.

**`/intros`** — `{ phone, search_id, connector_netid, target_netid?, message }` → `{ intro_id, status: "drafted", response_url }`. `response_url` is `{APP_URL}/i/{token}`; the bot may append it to the outgoing text.

**`/intros/{id}/sent`** — `{ phone }` → `{ status: "sent" }`. Call after the message goes out, whether the bot sent it or the user confirmed sending it themselves.

**`GET /intros?phone=`** — the user's recent intros and their status, for "did Jordan reply?".

**`/friends/add`** (P1) — `{ phone, query }` → directory matches, or creates the request when there is exactly one strong match and `confirm: true` is passed.

**Webhook to the bot (P1).** When a connector responds, POST `{ event: "intro.responded", intro_id, decision, requester_phone, connector_first_name, club_name }` to `BOT_WEBHOOK_URL` if set, so the bot can text the requester. Fire and forget, 5 s timeout.

### 9.4 Graph endpoint for Arden

`GET /api/public/graph/{share_token}` → `{ nodes: { id, label, kind: 'requester' | 'connector' | 'target' | 'club', role? }[], edges: { from, to, kind: 'friend' | 'member' | 'board' }[] }` for one path search. CORS allows `WEBSITE_ORIGIN`. Labels are first name and last initial only. A share token is created by `POST /api/paths/{searchId}/share` (requester only) and expires after 24 hours.

---

## 10. Jobs

`jobs/queue.ts` exposes `enqueue(type, payload, { dedupeKey?, runAfter? })` and `claimNext()`.

- `claimNext` runs `update jobs set status='running', locked_at=now(), attempts=attempts+1 where id = (select id from jobs where status='queued' and run_after <= now() order by run_after for update skip locked limit 1) returning *`.
- A handler per type lives in `jobs/handlers.ts`. On success: `done`, with a small `result`. On error: if `attempts < 3`, back to `queued` with `run_after = now() + attempts * 60s`; else `failed` with the error text.
- Jobs stuck in `running` for more than 5 minutes are re-queued by the tick.
- Global budget: before claiming, count jobs started in the last hour; stop at `ENRICH_MAX_JOBS_PER_HOUR`.
- Dedupe keys: `crawl_roster:{club_id}`, `research_person:{netid}`, `validate_membership:{membership_id}`, `linkedin_read:{user_id}`. Enqueueing an existing queued or running key is a no-op; a finished key is replaced only when the TTL has passed.

Running jobs:

- **Local:** `pnpm worker` loops `claimNext` with a 1 s idle sleep, concurrency 3.
- **Deployed:** `POST /api/internal/jobs/tick` (bearer `CRON_SECRET`, `maxDuration` 300 s) drains up to 5 jobs. Trigger it from a cron every minute, and also call it without awaiting (Next.js `after()`) from any handler that enqueues, so users do not wait for the next cron.

| Type | Payload | Handler |
|---|---|---|
| `linkedin_read` | `{ user_id, url }` | `profileReader` → on success upsert claims, enqueue validation per club claim, set `linkedin_status = 'ok'`; else `needs_pdf` or `mismatch` |
| `linkedin_pdf` | `{ user_id, text }` | `profileExtractor` → same as above; scrub `text` from the payload afterwards |
| `validate_membership` | `{ membership_id }` | `membershipValidator` → update status, confidence, role; replace evidence rows |
| `crawl_roster` | `{ club_id }` | `rosterCrawler` → match names → upsert memberships as `verified` / `public_roster`; record `roster_url`, `roster_crawled_at`; unmatched names to review table |
| `research_person` | `{ netid }` | `personResearcher` → upsert memberships per the rules in 7.4; set `researched_at` |

Upsert rule for memberships when a row already exists: keep the higher-trust status (`verified` > `likely` > `claimed` > `unverified`), merge evidence, never resurrect `rejected`.

---

## 11. Path finding

`paths/findPaths.ts` — `findPaths(db, requesterNetid, clubId, limit) → { results: PathResult[], pendingResearch, emptyReason }`

### 11.1 The graph

- **Friend edge, confirmed:** an `accepted` friendship. Usable in both directions.
- **Friend edge, one-sided:** a `pending` friendship where the requester is the one who added the other person. It counts only for the person who created it and only as their first hop. Reason: adding someone is the requester's own statement that they know them, and they will be sending the message themselves, so it is safe to use for their own search. It must not let anyone route *through* a person who never agreed.
- **Membership edge:** a current membership with status `verified`, `likely` or `claimed`, for a person with `visibility = 'listed'`.

### 11.2 Candidate paths

Let R be the requester and C the club. M(C) is the set of visible current members of C.

- **1-hop:** every F where R–F is a friend edge (confirmed or R's own one-sided), and F ∈ M(C).
- **2-hop:** every pair (F, T) where R–F is a **confirmed** friendship, F is a user with `share_connections = true`, F–T is a **confirmed** friendship, T ∈ M(C), T ≠ R, and F ∉ M(C).
- **2-hop, weak tie (P1):** (F, T) where R–F is a friend edge, and F and T are both current verified members of some *other* club with 40 or fewer known members, T ∈ M(C). Labelled `via: "shared_club"` with the shared club's name.

Exclusions, applied to connectors F: `allow_as_connector = false` (when F is a user); F declined an intro from R for this club in the last 30 days; F hidden. If R is already a member of C, return no results with `empty_reason = 'already_member'`.

Write this as two or three SQL queries joined in TypeScript. With at most a few thousand people it does not need a graph database or a recursive CTE.

### 11.3 Scoring (`paths/score.ts`, pure function, fully unit-tested)

```
score = tie(R,F) × link × confidence × load + affinity      (clamped to [0, 1])
```

| Factor | Value |
|---|---|
| `tie(R,F)` | confirmed friend 1.0; one-sided 0.6 |
| `link`, 1-hop | F is board 1.0; member 0.9; alum 0.6 |
| `link`, 2-hop via friend | 0.6 × (T is board 1.0; member 0.8) |
| `link`, 2-hop via shared club | 0.35 × (T is board 1.0; member 0.8) |
| `confidence` of the membership used | verified 1.0; likely 0.8; claimed 0.7 |
| `load` | 0.8 if F has 3 or more intros awaiting response, else 1.0 |
| `affinity` | +0.03 same college as R, +0.03 same class year as R |

Then: keep the best-scoring path per connector, sort by score descending, break ties by fewer hops, then by connector name, and return the top `limit`. Put the weights in one exported constant so they can be tuned from one place.

### 11.4 Explanations (`paths/explain.ts`)

`why` is built from templates, not an LLM, so it is instant and never wrong about the facts:

- 1-hop: `"{F} is your friend and a {club_short} {title|role}{evidence}."`
- 2-hop friend: `"{F} is your friend and is friends with {T}, {club_short}'s {title|role}."`
- 2-hop shared club: `"{F} is your friend and is in {shared_club} with {T}, who is on {club_short}'s board."`
- Evidence suffix: verified `" (confirmed on the club's site)"` or `" (confirmed by {source})"`; likely `" (likely, from public sources)"`; claimed `" (self-reported)"`.
- One-sided tie: start with `"You added {F}, who is …"`.

### 11.5 Side effects of a search

- Save a `path_searches` row and return its id.
- If the club's roster has never been crawled or is older than `ENRICH_CLUB_TTL_DAYS`, enqueue `crawl_roster`.
- If there are fewer than 3 results, enqueue `research_person` for up to 10 of R's friends whose `researched_at` is null or stale.
- Set `pending_research` to whether anything was enqueued.

### 11.6 Tests that must exist

Build small fixture graphs and assert: 1-hop beats 2-hop; board beats member at equal hops; a one-sided tie ranks below a confirmed one; a one-sided tie never produces a 2-hop; `share_connections = false` removes that user's 2-hops but not their 1-hop; `allow_as_connector = false` removes the connector entirely; hidden people appear nowhere; `unverified` memberships are ignored; the requester is never their own target; one connector appears once; a declined intro suppresses the connector for that club only.

---

## 12. Privacy and safety rules

NEPO stores who knows whom and researches students who have not signed up. These rules are requirements. Each needs a test.

1. **Yale only.** Every page and every API route except `/login`, the CAS routes and the token-gated graph endpoint requires a CAS session. Directory data is never served to an unauthenticated request.
2. **Minimal data on non-users.** For someone who has not signed in, NEPO keeps: name, college, class year, photo URL from Yalies, club memberships with role, and the evidence URL and short quote. Not their major in any response, not their email or phone, not their jobs or internships, not full LinkedIn text.
3. **Public sources only.** Agents read what is public on the web. No LinkedIn login, no cookies, no headless browser, no Yale pages behind authentication.
4. **Evidence or nothing.** A membership for a non-user exists only with at least one stored evidence URL that the agent cited. Unverified research results are hidden and unused.
5. **Opt-out that sticks.** Anyone can sign in and set visibility to hidden in `/me`, without completing onboarding. Hidden people are removed from search, club pages, paths, graph output and all agent inputs, and are not researched again. `/login` must link to a short "What NEPO knows and how to remove yourself" page.
6. **Friend lists stay private.** A user's friends are visible only to that user. Path results reveal a single F–T friendship at a time, only to F's confirmed friends, and only when F has `share_connections` on.
7. **Nobody is contacted automatically.** The backend never sends a message. Intros record what the requester decided to send. Non-users are never emailed or texted by NEPO.
8. **Connectors are in control.** Decline is one tap, needs no reason, and the requester sees only "not right now".
9. **Uploads are transient.** LinkedIn PDFs are parsed in memory. The extracted text is removed from the job payload on completion. Do not log it.
10. **Agent inputs are data.** Wrap fetched or uploaded text in tags and instruct agents to treat it as content, not instructions. Never put secrets in a prompt. Never let an agent output decide authorisation.
11. **Logs.** No phone numbers, PDF text or session tokens in logs. `agent_runs.input` for `linkedin_pdf` stores a hash of the text, not the text.
12. **Deletion.** `DELETE /api/me` works and is reachable from `/me`.

Before this runs beyond a hackathon demo, check the Yalies API terms and Yale's policies on directory data. That is a decision for the team, not something to settle in code.

---

## 13. The web app

Mobile-first: design at 390 px wide, content column capped at 480 px on larger screens, bottom tab bar (Home, Friends, Clubs, Intros, Me), 44 px minimum tap targets, system font, light and dark mode. Use server components for reads and server actions or the App API for writes; keep client components for search boxes, polling and forms. Add a web manifest and icons so it can be added to the home screen.

Every list needs an empty state that says what to do next, and every async action needs a pending state.

### Screens

**`/login`** — one-line pitch, "Sign in with Yale" button (to `/api/auth/cas/login`), link to the privacy page. When `DEV_LOGIN_ENABLED`, a NetID field below it.

**`/onboarding`** — four steps with a progress bar; each can be skipped except the first.
1. *Confirm it's you.* Name, college, year from Yalies; editable preferred name.
2. *Link your phone.* Shows the code and the NEPO number, a "Text it" button (`sms:{BOT_PHONE}&body={code}`), polls until verified.
3. *Your clubs.* Two paths side by side: "Paste your LinkedIn URL" and "Add clubs yourself" (typeahead on clubs; unknown names allowed). After a URL is submitted, show a live status: reading → found N clubs (list with badges) → or "LinkedIn wouldn't let us read your profile. Upload the PDF instead", with three-line instructions (open your profile → More → Save to PDF → upload here) and a file picker.
4. *Add friends.* Directory search with an Add button per result; "People you may know" below it, built from members of the user's clubs and the same college and year.

**`/` Home** — a large "Which club do you want in on?" search (club typeahead). Below: recent searches, pending incoming intro requests, and a nudge card if the user has fewer than 5 friends.

**`/paths/[searchId]`** — club header; ranked connector cards showing photo, name, the `why` sentence, a status badge with a link to the evidence, and "Ask {first name}". When `pending_research` is true, a subtle "Still looking for more connections…" row that re-fetches every 5 s for up to a minute. Empty states keyed to `empty_reason`.

**Ask sheet** (bottom sheet from a connector card) — the drafted message in an editable textarea, tone toggle, Regenerate, then two actions: "Copy and open Messages" (copies the text, opens `sms:&body=…`, and marks the intro sent) and "Send through NEPO" (creates the intro so it lands in the connector's inbox; only enabled when the connector is a user). Verify the `sms:` body format on a real iPhone.

**`/friends`** — tabs: Friends, Requests (incoming with Accept and Decline; outgoing with status and, for non-users, a Copy invite link button), Find (directory search).

**`/clubs`** and **`/clubs/[slug]`** — searchable list by category; club page with description, website, board and members (PersonCards with role and badge), "Find my way in" button that runs a path search, and "I'm in this club".

**`/intros`** — tabs Incoming and Outgoing. Incoming card: who is asking, which club, the message, Accept and Decline. Accepting shows a short "What next" note: introduce them in a group text, or reply directly. **`/intros/[id]`** shows the message and a timeline from `intro_events`.

**`/i/[token]`** — where a connector lands from a texted link. Requires sign-in (which is how connectors become users), then shows the same accept or decline view. If the signed-in NetID is not the connector, show "This link is for someone else".

**`/me`** — profile; phone (linked number masked, relink); LinkedIn (status, re-run, upload PDF); my clubs with status, evidence links, edit and remove; settings toggles for `allow_as_connector`, `share_connections`, and "Hide me from NEPO"; delete account.

**`/admin`** — job queue with status counts, retry, and a link to each job's agent runs (prompt, output, citations); clubs awaiting review; unmatched roster names with a directory picker; buttons to crawl one club or all.

Badges: `verified` green "Verified" with a link icon; `likely` amber "Likely"; `claimed` grey "Self-reported"; `disputed` shown only to the owner as "Couldn't confirm".

---

## 14. Seed and demo data

`pnpm db:seed` is idempotent and creates:

- **Clubs** from `scripts/data/clubs.json`. Start with the list below and let `rosterCrawler` fill in websites. Each entry: name, short name, aliases, category.

  | Name | Aliases |
  |---|---|
  | Yale Student Investment Group | YSIG |
  | Yale Undergraduate Consulting Group | YUCG |
  | Yale Entrepreneurial Society | YES |
  | Yale Daily News | YDN, the News |
  | Yale Political Union | YPU, the Union |
  | Yale College Council | YCC |
  | Yale International Relations Association | YIRA |
  | Yale Computer Society | y/cs, YCS |
  | Yale Debate Association | YDA, Yale Debate |
  | Yale Mock Trial Association | Mock Trial |
  | The Yale Whiffenpoofs | Whiffenpoofs, Whiffs |
  | Yale Dramatic Association | the Dramat |
  | Yale Scientific Magazine | Yale Scientific, YSM |
  | The Yale Herald | the Herald |
  | The Yale Record | the Record |
  | Yale Undergraduate Aerospace Association | YUAA |
  | Yale Glee Club | Glee Club |
  | Yale Symphony Orchestra | YSO |
  | Dwight Hall at Yale | Dwight Hall |
  | TEDxYale | TEDx |

  Confirm each name against the club's own site while building, and add more as the crawler discovers them.

- **Demo people**, all with `is_demo = true`, `directory_source = 'demo'`, NetIDs prefixed `demo_`: Maya (requester), Jordan (friend, YSIG analyst, verified, with an example evidence URL), Priya (friend, not in YSIG), Sam (YSIG president, verified, friends with Priya), plus about 30 filler people across 6 clubs so that lists and scores look real.
- **Friendships:** Maya–Jordan accepted, Maya–Priya accepted, Priya–Sam accepted, a few pending ones.
- **Users** for Maya, Jordan and Priya with fake verified phones (`+1203555010x`).

With `DEV_LOGIN_ENABLED=1`, signing in as `demo_maya` and searching YSIG must return Jordan at rank 1 and Priya via Sam at rank 2. This is the first end-to-end test.

Demo rows must be removable with `pnpm db:seed --purge` and never mix with real people in production results: filter `is_demo` out unless the requester is a demo person.

---

## 15. Build order

Build in this order. Each milestone ends in something runnable; do not start the next until the check passes.

**M0. Skeleton.** Next.js app, Tailwind, shadcn, Drizzle, migrations for the full schema, `.env.example`, error helpers, session helpers, dev login, authenticated layout with the tab bar and placeholder pages, Vitest wired up.
*Check:* `pnpm db:migrate && pnpm dev`, sign in as a dev NetID, see the empty Home.

**M1. Seed, clubs and path finding.** Seed script, `resolveClub`, `findPaths`, scoring, explanations, `POST /api/paths`, Home search, path results page. All tests in 11.6.
*Check:* the demo search described in section 14 works in the UI.

**M2. Bot API.** Bearer guard, `/whoami`, `/resolve-club`, `/find-paths`, `/draft-intro` (mocked drafter), `/intros`, `/intros/{id}/sent`, `/link-phone`, phone-code UI, `docs/bot-tools.json`. **Hand `docs/bot-tools.json`, the deployed base URL and `BOT_API_SECRET` to Tobi at this point**; his work is blocked on it.
*Check:* a curl script in `scripts/bot-smoke.sh` runs the whole bot conversation against local seed data.

**M3. Real identity.** CAS login, Yalies client with mocks and fixtures, profile upsert on first login, directory search, friends API and screens, onboarding steps 1, 2 and 4.
*Check:* two real NetIDs can sign in, find each other, add and accept, and each sees the other in Friends.

**M4. Intros.** Draft, create, mark sent, inbox, respond, `/i/[token]`, events timeline, Ask sheet.
*Check:* Maya asks Jordan through NEPO; Jordan accepts on another browser; Maya's intro shows accepted.

**M5. Agents.** `runAgent` with mocking and the evidence integrity check, job queue, worker and tick, then agents in this order: `introDrafter`, `membershipValidator`, `rosterCrawler` plus name matching, `profileExtractor` plus PDF upload, `profileReader` plus URL flow, `personResearcher`. Onboarding step 3, `/me` clubs, admin page.
*Check:* with real keys, `pnpm crawl:clubs` on three real clubs produces verified memberships with working evidence links; uploading a real LinkedIn PDF yields claims that then validate.

**M6. Privacy pass and polish.** Every rule in section 12 has a test. Opt-out page, delete account, rate limits, empty states, PWA manifest, graph endpoint for Arden, Playwright happy path, deploy.

If time runs short, cut from the bottom: `personResearcher`, weak-tie paths, the webhook, LinkedIn OpenID badge, admin niceties. Do not cut section 12.

---

## 16. Working agreements for whoever builds this

- **External APIs change.** Section 6.2 and 7.3 describe Yalies and xAI as checked in November 2026. On first contact with each, read the live docs (`yalies.io/apidocs`, `docs.x.ai`) and make one real call before building on it. If the docs disagree with this README, follow the docs and update the README.
- **Mock first.** Every external call has a fixture path so the whole app runs with `MOCK_EXTERNAL=1` and no keys. Tests never hit the network.
- **One writer per table concept.** Memberships are only written through `memberships/service.ts`, intros through `intros/service.ts`, so the invariants in section 8 are enforced in one place.
- **No silent fallbacks.** If Yalies or xAI fails, surface a specific error or job failure. Do not substitute invented data, and do not mark a membership verified because validation could not run.
- **Keep the Bot API stable.** After M2, changing a request or response shape requires telling Tobi. Add fields rather than renaming them.
- **Ask Otis** for: the Yalies API key, the xAI key, the bot's phone number, Arden's site origin, and the deployed URL. Everything else can proceed on mocks.

## 17. Changes from the original plan doc

The Google Doc "Yale NEPO — Hackathon Plan" predates these decisions. Where they differ, this README wins:

| Plan doc | Now |
|---|---|
| Add friends by phone number, invite link and contacts import | Add friends by searching the Yale directory (Yalies). No contacts import; a web app cannot read the address book |
| Sign-up with Yale email and phone verification, on Arden's website | Sign-in with Yale CAS in this app; Arden's site links to `/login`. Phone is verified by texting a code to the bot |
| Clubs from self-report and published rosters only | Also LinkedIn (URL, then PDF) and Grok research on any Yale student, with evidence required and opt-out |
| Paths through contacts of friends | Paths through confirmed friendships, plus shared-club weak ties |
| `send_message(to, body)` as a backend tool | Sending stays in Tobi's bot. The backend records intros and their status |

## 18. Open questions for the team

1. Does the bot send the intro from the NEPO number, or does the requester always send it from their own phone? The backend supports both; the Ask sheet copy depends on it.
2. Will Tobi's agent draft messages itself or call `/draft-intro`? One voice is better than two.
3. Which three real clubs do we crawl for the live demo, and do we tell their boards beforehand?
4. Who are the admins (`ADMIN_NETIDS`)?
