import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { resetRateLimits } from "@/lib/rateLimit";
import type { Db } from "@/server/db/client";
import { friendships, people, phoneLinkCodes, users } from "@/server/db/schema";
import { seed } from "@/server/tasks/seed";
import { createTestDb } from "../helpers/db";

/** The session cookie is replaced by this holder; everything else is the real route code. */
const session = vi.hoisted(() => ({
  current: {} as { userId?: string; netid?: string; via?: string },
}));
vi.mock("@/server/auth/session", () => ({
  SESSION_COOKIE: "nepo_session",
  getSession: async () => ({
    get userId() {
      return session.current.userId;
    },
    set userId(v: string | undefined) {
      session.current.userId = v;
    },
    get netid() {
      return session.current.netid;
    },
    set netid(v: string | undefined) {
      session.current.netid = v;
    },
    get via() {
      return session.current.via;
    },
    set via(v: string | undefined) {
      session.current.via = v;
    },
    save: async () => {},
    destroy: () => {
      session.current = {};
    },
  }),
}));

import * as botClub from "@/app/api/bot/club/route";
import * as botConnectorPhone from "@/app/api/bot/intros/[id]/connector-phone/route";
import * as botIntro from "@/app/api/bot/intros/[id]/route";
import * as botRespond from "@/app/api/bot/intros/[id]/respond/route";
import * as botDraft from "@/app/api/bot/draft-intro/route";
import * as botFindPaths from "@/app/api/bot/find-paths/route";
import * as botFriendsAdd from "@/app/api/bot/friends/add/route";
import * as botIntroSent from "@/app/api/bot/intros/[id]/sent/route";
import * as botIntros from "@/app/api/bot/intros/route";
import * as botLinkPhone from "@/app/api/bot/link-phone/route";
import * as botResolveClub from "@/app/api/bot/resolve-club/route";
import * as botWhoami from "@/app/api/bot/whoami/route";
import * as adminJobs from "@/app/api/admin/jobs/route";
import * as devLogin from "@/app/api/auth/dev-login/route";
import * as directorySearch from "@/app/api/directory/search/route";
import * as friendAccept from "@/app/api/friends/[id]/accept/route";
import * as friendsRoute from "@/app/api/friends/route";
import * as devTask from "@/app/api/internal/dev/task/route";
import * as tick from "@/app/api/internal/jobs/tick/route";
import * as introRespond from "@/app/api/intros/[id]/respond/route";
import * as meRoute from "@/app/api/me/route";
import * as phoneCode from "@/app/api/me/phone-code/route";
import * as pathsRoute from "@/app/api/paths/route";
import * as graph from "@/app/api/public/graph/[share_token]/route";
import * as share from "@/app/api/paths/[searchId]/share/route";
import { botToolDefinitions, botTools } from "@/server/bot/tools";

let db: Db;
let close: () => Promise<void>;

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BOT = { authorization: "Bearer test-bot-secret" };

async function call(handler: Handler, opts: { method?: string; url?: string; body?: unknown; headers?: Record<string, string>; params?: Record<string, string> } = {}) {
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  const req = new Request(opts.url ?? "http://localhost:3000/api/test", {
    method,
    headers: { ...(opts.body !== undefined ? { "content-type": "application/json" } : {}), ...opts.headers },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: (await res.json().catch(() => null)) as any, headers: res.headers };
}
const bot = (handler: Handler, body: unknown, params?: Record<string, string>) => call(handler, { body, headers: BOT, params });

async function signInAs(netid: string | null) {
  if (!netid) {
    session.current = {};
    return;
  }
  const [user] = await db.select().from(users).where(eq(users.netid, netid));
  session.current = { userId: user.id, netid };
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seed(db);
});
afterAll(() => close());
beforeEach(() => {
  resetRateLimits();
  session.current = {};
});

describe("conventions (section 9.1)", () => {
  test("App API without a session → 401 unauthenticated in the standard error shape", async () => {
    const res = await call(meRoute.GET as Handler);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "unauthenticated", message: expect.any(String) } });
    expect((await call(directorySearch.GET as Handler, { url: "http://localhost:3000/api/directory/search?q=jordan" })).status).toBe(401);
  });

  test("Bot API: missing, wrong and right bearer secret", async () => {
    expect((await call(botWhoami.POST as Handler, { body: { phone: "+12035550101" } })).status).toBe(401);
    expect((await call(botWhoami.POST as Handler, { body: { phone: "+12035550101" }, headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    // A valid session cookie is not a bot credential.
    await signInAs("demo_maya");
    expect((await call(botWhoami.POST as Handler, { body: { phone: "+12035550101" } })).status).toBe(401);
    expect((await bot(botWhoami.POST as Handler, { phone: "+12035550101" })).status).toBe(200);
  });

  test("a body that fails validation → 400 invalid_request with the zod issues", async () => {
    const res = await bot(botFindPaths.POST as Handler, { phone: "+12035550101", club_id: "not-a-uuid" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_request");
    expect(res.body.error.issues[0].path).toEqual(["club_id"]);
    const notJson = await (botWhoami.POST as Handler)(
      new Request("http://localhost:3000/x", { method: "POST", headers: BOT, body: "{nope" }),
      { params: Promise.resolve({}) },
    );
    expect(notJson.status).toBe(400);
  });

  test("admin routes need a NetID in ADMIN_NETIDS; internal routes need the cron secret", async () => {
    await signInAs("demo_maya");
    expect((await call(adminJobs.GET as Handler)).status).toBe(403);
    process.env.ADMIN_NETIDS = "demo_maya";
    expect((await call(adminJobs.GET as Handler)).status).toBe(200);
    process.env.ADMIN_NETIDS = "admin1";

    expect((await call(tick.POST as Handler, { method: "POST" })).status).toBe(401);
    expect((await call(tick.POST as Handler, { method: "POST", headers: BOT })).status).toBe(401);
    const ok = await call(tick.POST as Handler, { method: "POST", headers: { authorization: "Bearer test-cron-secret" } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ran: expect.any(Number) });
  });

  test("the dev task endpoint and dev login are refused in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const task = await call(devTask.POST as Handler, { body: { task: "seed" }, headers: { authorization: "Bearer test-cron-secret" } });
      expect(task.status).toBe(403);
      const login = await call(devLogin.POST as Handler, { body: { netid: "demo_maya" } });
      expect(login.status).toBe(403);
      expect(login.body.error.code).toBe("dev_login_disabled");
      expect(session.current.userId).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("the bot conversation (section 9.3)", () => {
  test("unknown phone → 404 user_not_linked", async () => {
    const res = await bot(botWhoami.POST as Handler, { phone: "+1 203 555 0199" });
    expect([res.status, res.body.error.code]).toEqual([404, "user_not_linked"]);
  });

  test("link-phone: bad code, expired code, success, single use, and a phone belongs to one user", async () => {
    await signInAs("demo_priya");
    const { body: created } = await call(phoneCode.POST as Handler, { method: "POST" });
    expect(created).toMatchObject({ code: expect.stringMatching(/^\d{6}$/), bot_phone: "+1 203 555 0100" });
    expect(new Date(created.expires_at).getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    session.current = {};

    const wrong = created.code === "000000" ? "000001" : "000000";
    expect((await bot(botLinkPhone.POST as Handler, { phone: "+12035550150", code: wrong })).body.error.code).toBe("invalid_code");

    // Jordan's number texts Priya's code: the number moves to Priya.
    const linked = await bot(botLinkPhone.POST as Handler, { phone: "(203) 555-0102", code: created.code });
    expect(linked.body).toMatchObject({ linked: true, user: { netid: "demo_priya" } });
    const [jordan] = await db.select().from(users).where(eq(users.netid, "demo_jordan"));
    expect([jordan.phoneE164, jordan.phoneVerifiedAt]).toEqual([null, null]);
    expect((await bot(botWhoami.POST as Handler, { phone: "+12035550102" })).body.user.netid).toBe("demo_priya");

    expect((await bot(botLinkPhone.POST as Handler, { phone: "+12035550151", code: created.code })).body.error.code).toBe("invalid_code");

    await signInAs("demo_jordan");
    const { body: second } = await call(phoneCode.POST as Handler, { method: "POST" });
    await db.update(phoneLinkCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(phoneLinkCodes.code, second.code));
    session.current = {};
    expect((await bot(botLinkPhone.POST as Handler, { phone: "+12035550152", code: second.code })).body.error.code).toBe("code_expired");
  });

  test("whoami → resolve-club → find-paths → draft-intro → intros → sent → respond → list", async () => {
    const who = await bot(botWhoami.POST as Handler, { phone: "+12035550101" });
    expect(who.body).toMatchObject({ user: { netid: "demo_maya", name: "Maya Chen" }, friends_count: 2, onboarding_done: true });

    const unknown = await bot(botResolveClub.POST as Handler, { text: "Yale Magazine" });
    expect(unknown.body.club).toBeNull();
    const club = await bot(botResolveClub.POST as Handler, { text: "I mean ysig" });
    expect(club.body.club).toBeNull(); // only the club phrase resolves; the bot passes just that
    const ysig = (await bot(botResolveClub.POST as Handler, { text: "YSIG" })).body;
    expect(ysig).toMatchObject({ club: { slug: "ysig", short_name: "YSIG", category: "finance" }, confidence: 1 });

    const paths = (await bot(botFindPaths.POST as Handler, { phone: "+12035550101", club_id: ysig.club.id })).body;
    expect(paths.results.map((r: { connector: { netid: string } }) => r.connector.netid)).toEqual(["demo_jordan", "demo_priya"]);
    expect(paths.results[0]).toMatchObject({
      rank: 1,
      score: 0.93,
      hops: 1,
      connector_tie: "friend",
      link: { type: "member", role: "member", title: "Analyst", status: "verified", evidence_url: expect.stringMatching(/^https:/) },
      target: null,
    });
    expect(paths.results[1]).toMatchObject({
      hops: 2,
      link: { type: "knows_member", via: "friend" },
      target: { person: { netid: "demo_sam", is_user: false }, role: "board", title: "President", status: "verified" },
    });
    expect(paths.empty_reason).toBeNull();
    expect(typeof paths.pending_research).toBe("boolean");

    const draft = await bot(botDraft.POST as Handler, { phone: "+12035550101", search_id: paths.search_id, connector_netid: "demo_jordan" });
    expect(draft.body.message).toMatch(/Jordan/);
    expect(draft.body.message).toMatch(/YSIG/);

    const created = await bot(botIntros.POST as Handler, {
      phone: "+12035550101",
      search_id: paths.search_id,
      connector_netid: "demo_jordan",
      message: draft.body.message,
    });
    expect(created.body).toMatchObject({ status: "drafted", response_url: expect.stringMatching(/^http:\/\/localhost:3000\/i\/[\w-]+$/) });

    const sent = await bot(botIntroSent.POST as Handler, { phone: "+12035550101" }, { id: created.body.intro_id });
    expect(sent.body).toEqual({ status: "sent" });
    // Another user's phone cannot mark it.
    const other = await bot(botIntroSent.POST as Handler, { phone: "+12035550103" }, { id: created.body.intro_id });
    expect(other.status).toBe(404);

    await signInAs("demo_jordan");
    const accepted = await call(introRespond.POST as Handler, { body: { decision: "accept" }, params: { id: created.body.intro_id } });
    expect(accepted.body.intro.status).toBe("accepted");
    session.current = {};

    const list = await call(botIntros.GET as Handler, { url: "http://localhost:3000/api/bot/intros?phone=%2B12035550101", headers: BOT });
    expect(list.body.intros[0]).toMatchObject({ intro_id: created.body.intro_id, status: "accepted", connector: { first_name: "Jordan" } });
  });

  test("find-paths empty reasons reach the bot", async () => {
    const ysig = (await bot(botResolveClub.POST as Handler, { text: "YSIG" })).body.club;
    // Jordan is already in YSIG.
    await db.update(users).set({ phoneE164: "+12035550103" }).where(eq(users.netid, "demo_priya"));
    await db.update(users).set({ phoneE164: "+12035550102", phoneVerifiedAt: new Date() }).where(eq(users.netid, "demo_jordan"));
    const res = await bot(botFindPaths.POST as Handler, { phone: "+12035550102", club_id: ysig.id });
    expect(res.body).toMatchObject({ results: [], empty_reason: "already_member", pending_research: false });
  });

  test("friends/add: matches first, creates only with confirm and a single strong match", async () => {
    const look = await bot(botFriendsAdd.POST as Handler, { phone: "+12035550101", query: "Sam Wu" });
    expect(look.body).toMatchObject({ created: false, strong_match: { netid: "demo_sam" } });
    const made = await bot(botFriendsAdd.POST as Handler, { phone: "+12035550101", query: "Sam Wu", confirm: true });
    expect(made.body).toMatchObject({ created: true, friendship: { status: "pending", invite_url: "http://localhost:3000/login?ref=demo_maya" } });
  });

  test("bot-only routes: club info, reading an intro, the connector's phone for linked users only, answering by text", async () => {
    const MAYA = "+12035550101";
    const JORDAN = "+12035550102";
    await db.update(users).set({ phoneE164: JORDAN, phoneVerifiedAt: new Date() }).where(eq(users.netid, "demo_jordan"));
    await db.update(users).set({ phoneE164: "+12035550103", phoneVerifiedAt: new Date() }).where(eq(users.netid, "demo_priya"));

    const ysig = (await bot(botResolveClub.POST as Handler, { text: "YSIG" })).body.club;
    const club = await bot(botClub.POST as Handler, { club_id: ysig.id });
    expect(club.body.club).toMatchObject({ id: ysig.id, slug: "ysig" });
    expect((await call(botClub.POST as Handler, { body: { club_id: ysig.id } })).status).toBe(401);

    const paths = (await bot(botFindPaths.POST as Handler, { phone: MAYA, club_id: ysig.id })).body;
    const created = (
      await bot(botIntros.POST as Handler, { phone: MAYA, search_id: paths.search_id, connector_netid: "demo_jordan", message: "Hey Jordan" })
    ).body;
    const id = created.intro_id;

    const read = await call(botIntro.GET as Handler, { url: `http://localhost:3000/api/bot/intros/${id}?phone=%2B12035550101`, headers: BOT, params: { id } });
    expect(read.body.intro).toMatchObject({ intro_id: id, status: "drafted", message: "Hey Jordan", connector: { netid: "demo_jordan" } });
    expect(JSON.stringify(read.body)).not.toContain(JORDAN);
    const notTheirs = await call(botIntro.GET as Handler, { url: `http://localhost:3000/api/bot/intros/${id}?phone=%2B12035550103`, headers: BOT, params: { id } });
    expect(notTheirs.status).toBe(404);

    // The connector's phone: only to the requester's bot session, only while the connector's phone is verified.
    expect((await bot(botConnectorPhone.POST as Handler, { phone: MAYA }, { id })).body).toEqual({ phone: JORDAN });
    expect((await bot(botConnectorPhone.POST as Handler, { phone: "+12035550103" }, { id })).status).toBe(404);
    await db.update(users).set({ phoneVerifiedAt: null }).where(eq(users.netid, "demo_jordan"));
    expect((await bot(botConnectorPhone.POST as Handler, { phone: MAYA }, { id })).body).toEqual({ phone: null });
    await db.update(users).set({ phoneVerifiedAt: new Date() }).where(eq(users.netid, "demo_jordan"));

    await bot(botIntroSent.POST as Handler, { phone: MAYA }, { id });
    // The requester can't answer their own intro.
    expect((await bot(botRespond.POST as Handler, { phone: MAYA, decision: "accept" }, { id })).status).toBe(403);
    const answered = await bot(botRespond.POST as Handler, { phone: JORDAN, decision: "accept" }, { id });
    expect(answered.body).toEqual({
      status: "accepted",
      requester_phone: MAYA,
      requester_name: "Maya Chen",
      connector_first_name: "Jordan",
      club_name: ysig.name,
    });
    const again = await bot(botRespond.POST as Handler, { phone: JORDAN, decision: "decline" }, { id });
    expect([again.status, again.body.error.code]).toEqual([409, "invalid_state"]);
    // Once answered, the phone is no longer handed out.
    expect((await bot(botConnectorPhone.POST as Handler, { phone: MAYA }, { id })).body).toEqual({ phone: null });
  });

  test("docs/bot-tools.json is generated from the same schemas the routes validate with", async () => {
    const defs = botToolDefinitions();
    expect(defs.map((d) => d.name)).toEqual(botTools.map((t) => t.name));
    for (const def of defs) {
      expect(def.type).toBe("function");
      expect(def.parameters.type).toBe("object");
      expect(def.description.length).toBeGreaterThan(60); // says when to call it, not just what it does
    }
    const fs = await import("node:fs");
    const onDisk = JSON.parse(fs.readFileSync("docs/bot-tools.json", "utf8"));
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(defs)));
  });
});

describe("App API flows", () => {
  test("dev login signs in a NetID from the (mocked) Yale directory and fills the profile", async () => {
    const res = await call(devLogin.POST as Handler, { body: { netid: "BO107", next: "//evil.example" } });
    expect(res.body).toEqual({ ok: true, redirect: "/onboarding" });
    const me = await call(meRoute.GET as Handler);
    expect(me.body).toMatchObject({
      user: { netid: "bo107", name: "Bea Okafor", college: "Pierson", year: 2028, is_user: true },
      onboarding_done: false,
      needs_name: false,
      phone: { linked: false, masked: null },
    });
    const [person] = await db.select().from(people).where(eq(people.netid, "bo107"));
    expect(person.directorySource).toBe("yalies");
  });

  test("someone missing from the directory can still sign in and is asked for their name", async () => {
    await call(devLogin.POST as Handler, { body: { netid: "zz999" } });
    expect((await call(meRoute.GET as Handler)).body.needs_name).toBe(true);
    await call(meRoute.PATCH as Handler, { method: "PATCH", body: { first_name: "Zed", last_name: "Zimmer" } });
    expect((await call(meRoute.GET as Handler)).body.user.name).toBe("Zed Zimmer");
  });

  test("directory search finds people locally and through Yalies, with friendship state", async () => {
    await signInAs("demo_maya");
    const res = await call(directorySearch.GET as Handler, { url: "http://localhost:3000/api/directory/search?q=jordan" });
    expect(res.body.results[0]).toEqual({ person: expect.objectContaining({ netid: "demo_jordan" }), friendship: "accepted" });
    const remote = await call(directorySearch.GET as Handler, { url: "http://localhost:3000/api/directory/search?q=fatima" });
    expect(remote.body.results[0].person).toMatchObject({ name: "Fatima Aziz", is_user: false });
    expect(remote.body.results[0].friendship).toBe("none");
  });

  test("directory search is rate limited to 30 per minute per user", async () => {
    await signInAs("demo_maya");
    let last = 200;
    for (let i = 0; i < 31; i++) {
      last = (await call(directorySearch.GET as Handler, { url: "http://localhost:3000/api/directory/search?q=jo" })).status;
    }
    expect(last).toBe(429);
  });

  test("friend request: add, the other side accepts; a reverse add accepts too; removed can be re-added", async () => {
    await call(devLogin.POST as Handler, { body: { netid: "ar100" } });
    const add = await call(friendsRoute.POST as Handler, { body: { netid: "bo107" } });
    expect(add.body).toMatchObject({ status: "pending", invite_url: null, person: { netid: "bo107", is_user: true } });
    expect((await call(friendsRoute.POST as Handler, { body: { netid: "ar100" } })).body.error.code).toBe("cannot_friend_self");
    // The requester cannot accept their own request.
    expect((await call(friendAccept.POST as Handler, { method: "POST", params: { id: add.body.friendship_id } })).status).toBe(404);

    await signInAs("bo107");
    const incoming = (await call(friendsRoute.GET as Handler)).body.incoming;
    expect(incoming.map((f: { netid: string }) => f.netid)).toEqual(["ar100"]);
    const accepted = await call(friendAccept.POST as Handler, { method: "POST", params: { id: add.body.friendship_id } });
    expect(accepted.body.status).toBe("accepted");
    expect((await call(friendsRoute.POST as Handler, { body: { netid: "ar100" } })).body.error.code).toBe("already_friends");

    // One row per pair, whatever happens.
    await db.update(friendships).set({ status: "removed" }).where(eq(friendships.id, add.body.friendship_id));
    const again = await call(friendsRoute.POST as Handler, { body: { netid: "ar100" } });
    expect(again.body).toMatchObject({ friendship_id: add.body.friendship_id, status: "pending" });
    await signInAs("ar100");
    const reverse = await call(friendsRoute.POST as Handler, { body: { netid: "bo107" } });
    expect(reverse.body.status).toBe("accepted");
  });

  test("adding a non-user returns an invite link for the user to send and queues research", async () => {
    await signInAs("ar100");
    const res = await call(friendsRoute.POST as Handler, { body: { netid: "cm114" } });
    expect(res.body).toMatchObject({ status: "pending", invite_url: "http://localhost:3000/login?ref=ar100", person: { is_user: false } });
    const { jobs } = await import("@/server/db/schema");
    const [job] = await db.select().from(jobs).where(eq(jobs.dedupeKey, "research_person:cm114"));
    expect(job.type).toBe("research_person");
  });

  test("path search by text, share token, and the public graph with CORS for the website origin only", async () => {
    await signInAs("demo_maya");
    const unknown = await call(pathsRoute.POST as Handler, { body: { club_text: "zzzz qqqq" } });
    expect([unknown.status, unknown.body.error.code]).toEqual([404, "club_not_found"]);
    const search = await call(pathsRoute.POST as Handler, { body: { club_text: "the dramat" } });
    expect(search.body.club.slug).toBe("the-dramat");

    const shared = await call(share.POST as Handler, { method: "POST", params: { searchId: search.body.search_id } });
    expect(shared.body.share_token).toMatch(/^[\w-]{20,}$/);

    session.current = {}; // the graph endpoint needs no session, only the token
    process.env.WEBSITE_ORIGIN = "https://nepo.example";
    try {
      const allowed = await call(graph.GET as Handler, { params: { share_token: shared.body.share_token }, headers: { origin: "https://nepo.example" } });
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get("access-control-allow-origin")).toBe("https://nepo.example");
      expect(allowed.body.nodes[0]).toEqual({ id: "club", label: "the Dramat", kind: "club" });
      const elsewhere = await call(graph.GET as Handler, { params: { share_token: shared.body.share_token }, headers: { origin: "https://evil.example" } });
      expect(elsewhere.headers.get("access-control-allow-origin")).toBeNull();
      const bad = await call(graph.GET as Handler, { params: { share_token: "nope" } });
      expect(bad.status).toBe(404);
    } finally {
      delete process.env.WEBSITE_ORIGIN;
    }
  });
});
