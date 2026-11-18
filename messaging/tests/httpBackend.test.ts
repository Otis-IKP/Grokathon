import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackendError } from "../src/backend/Backend";
import { HttpBackend } from "../src/backend/HttpBackend";
import { IntroAlreadyAnsweredError } from "../src/types";

type Seen = { method: string; url: string; auth: string | undefined; body: unknown };

const MAYA_CARD = { netid: "demo_maya", name: "Maya Chen", first_name: "Maya", college: "Pierson", year: 2028, image_url: null, is_user: true };
const JORDAN_CARD = { ...MAYA_CARD, netid: "demo_jordan", name: "Jordan Lee", first_name: "Jordan" };
const SAM_CARD = { ...MAYA_CARD, netid: "demo_sam", name: "Sam Wu", first_name: "Sam", is_user: false };
const CLUB = { id: "11111111-1111-4111-8111-111111111111", slug: "ysig", name: "Yale Student Investment Group", short_name: "YSIG", category: "finance" };
const INTRO_ID = "22222222-2222-4222-8222-222222222222";

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => resolve(raw ? JSON.parse(raw) : undefined));
  });
}

describe("HttpBackend against the app's Bot API", () => {
  let server: Server;
  let backend: HttpBackend;
  const seen: Seen[] = [];

  beforeEach(async () => {
    seen.length = 0;
    server = createServer(async (req, res) => {
      const body = (await readBody(req)) as Record<string, unknown> | undefined;
      seen.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization, body });
      const send = (status: number, payload: unknown) => {
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(payload));
      };
      const url = req.url ?? "";
      if (url === "/api/bot/whoami") {
        if (body?.phone === "+12035550101") return send(200, { user: MAYA_CARD, friends_count: 2, clubs: [], onboarding_done: true });
        return send(404, { error: { code: "user_not_linked", message: "not linked" } });
      }
      if (url === "/api/bot/link-phone") return send(400, { error: { code: "code_expired", message: "expired" } });
      if (url === "/api/bot/resolve-club") return send(200, { club: CLUB, candidates: [CLUB], confidence: 1 });
      if (url === "/api/bot/club") return send(200, { club: CLUB, description: "Student-run fund." });
      if (url === "/api/bot/find-paths") {
        return send(200, {
          search_id: "33333333-3333-4333-8333-333333333333",
          club: CLUB,
          results: [
            { rank: 1, score: 0.93, hops: 1, connector: JORDAN_CARD, connector_tie: "friend", link: { type: "member", role: "member", title: "Analyst", status: "verified", evidence_url: null }, target: null, why: "Jordan is a YSIG analyst." },
            { rank: 2, score: 0.6, hops: 2, connector: JORDAN_CARD, connector_tie: "friend", link: { type: "knows_member", via: "friend" }, target: { person: SAM_CARD, role: "board", title: "President", status: "verified" }, why: "Jordan knows Sam." },
          ],
          pending_research: true,
          empty_reason: null,
        });
      }
      if (url === "/api/bot/intros") return send(200, { intro_id: INTRO_ID, status: "drafted", response_url: "https://app.test/i/tok" });
      if (url.startsWith(`/api/bot/intros/${INTRO_ID}?phone=`)) {
        return send(200, {
          intro: { intro_id: INTRO_ID, status: "drafted", message: "Hey Jordan", club: CLUB, connector: JORDAN_CARD, created_at: new Date().toISOString(), response_url: "https://app.test/i/tok" },
        });
      }
      if (url === `/api/bot/intros/${INTRO_ID}/connector-phone`) return send(200, { phone: "+12035550102" });
      if (url === `/api/bot/intros/${INTRO_ID}/sent`) return send(200, { status: "sent" });
      if (url === `/api/bot/intros/${INTRO_ID}/respond`) {
        if (body?.decision === "decline") return send(409, { error: { code: "invalid_state", message: "answered" } });
        return send(200, { status: "accepted", requester_phone: "+12035550101", requester_name: "Maya Chen", connector_first_name: "Jordan", club_name: CLUB.name });
      }
      send(502, { error: { code: "upstream_error", message: "down" } });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    backend = new HttpBackend(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`, "bot-secret");
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it("sends the bearer secret and maps whoami, treating user_not_linked as null", async () => {
    await expect(backend.getUserByPhone("+12035550101")).resolves.toMatchObject({ id: "demo_maya", name: "Maya Chen", college: "Pierson", classYear: 2028 });
    await expect(backend.getUserByPhone("+12035550199")).resolves.toBeNull();
    expect(seen.every((request) => request.auth === "Bearer bot-secret")).toBe(true);
  });

  it("maps resolve-club, club info and find-paths to the bot's shapes", async () => {
    expect(await backend.resolveClub("YSIG")).toEqual([{ club: expect.objectContaining({ id: CLUB.id, aliases: ["YSIG"] }), confidence: "exact" }]);
    expect((await backend.getClub(CLUB.id))?.blurb).toBe("Student-run fund.");
    const user = { id: "demo_maya", name: "Maya Chen", phone: "+12035550101", suggestible: true };
    const search = await backend.findPaths(user, "+12035550101", CLUB.id);
    expect(seen.at(-1)?.body).toEqual({ phone: "+12035550101", club_id: CLUB.id, limit: 5 });
    expect(search.searchId).toBe("33333333-3333-4333-8333-333333333333");
    expect(search.pendingResearch).toBe(true);
    expect(search.paths[0]).toEqual({
      hops: 1,
      connector: { id: "demo_jordan", name: "Jordan Lee" },
      target: { id: "demo_jordan", name: "Jordan Lee", role: "member" },
      via: "friend_in_club",
      score: 0.93,
      reasons: ["Jordan is a YSIG analyst."],
    });
    expect(search.paths[1]).toMatchObject({ hops: 2, target: { id: "demo_sam", role: "board" }, via: "friend_of_member" });
  });

  it("creates, reads, addresses and marks an intro using the requester's phone", async () => {
    const intro = await backend.createIntro({
      requesterId: "demo_maya",
      requesterPhone: "+12035550101",
      searchId: "33333333-3333-4333-8333-333333333333",
      connectorId: "demo_jordan",
      clubId: CLUB.id,
      message: "Hey Jordan",
    });
    expect(intro).toMatchObject({ id: INTRO_ID, status: "drafted", responseUrl: "https://app.test/i/tok" });
    // The /d link has no phone: the cached intro supplies it.
    expect((await backend.getIntro(INTRO_ID))?.connectorName).toBe("Jordan Lee");
    expect(await backend.getConnectorPhone(intro)).toBe("+12035550102");
    await backend.markIntroSent(intro);
    expect(seen.at(-1)).toMatchObject({ url: `/api/bot/intros/${INTRO_ID}/sent`, body: { phone: "+12035550101" } });
  });

  it("returns null for an intro this process never created", async () => {
    expect(await backend.getIntro("unknown")).toBeNull();
  });

  it("answers an intro by text and maps an already-answered intro to IntroAlreadyAnsweredError", async () => {
    await expect(backend.answerIntro(INTRO_ID, "+12035550102", "accept")).resolves.toEqual({
      requesterPhone: "+12035550101",
      requesterName: "Maya Chen",
      connectorName: "Jordan",
      clubName: CLUB.name,
    });
    await expect(backend.answerIntro(INTRO_ID, "+12035550102", "decline")).rejects.toBeInstanceOf(IntroAlreadyAnsweredError);
  });

  it("reports an expired linking code and throws BackendError on other failures", async () => {
    expect(await backend.linkPhone("+12035550199", "123456")).toEqual({ ok: false, reason: "code_expired" });
    await expect(
      backend.markIntroSent({ id: "other", requesterId: "x", requesterPhone: "+1", connectorId: "y", clubId: "z", message: "m", status: "drafted", createdAt: 0 }),
    ).rejects.toBeInstanceOf(BackendError);
  });
});
