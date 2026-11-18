import fs from "node:fs";
import path from "node:path";
import { eq, or } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { Db } from "@/server/db/client";
import {
  experiences,
  friendships,
  intros,
  jobs,
  memberships,
  pathSearches,
  people,
  users,
  type Club,
} from "@/server/db/schema";
import { listClubMembers, listClubs } from "@/server/clubs/service";
import { addFriend, friendSuggestions, listFriends } from "@/server/friends/service";
import { createIntro, draftIntro, getIntro, getIntroByToken, introAction, listIntros, respondToIntro } from "@/server/intros/service";
import { deleteAccount, getMe, updateMe } from "@/server/me/service";
import { upsertMembership } from "@/server/memberships/service";
import { createShare, graphForToken, searchPaths } from "@/server/paths/service";
import { searchDirectory, toPersonCard } from "@/server/people/service";
import { createTestDb } from "../helpers/db";
import { currentUser, makeClub, makeFriends, makeMember, makePerson, makeUser } from "../helpers/factory";

let db: Db;
let close: () => Promise<void>;
let club: Club;
const viewer = (netid: string) => ({ netid, isDemo: false });

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  club = await makeClub(db, "Privacy Test Club", "PTC");
  // maya → jordan (member), maya → priya → sam (board).
  await makeUser(db, "maya", { person: { firstName: "Maya", lastName: "Chen", major: "Economics", email: "maya@yale.edu" } });
  await makeUser(db, "jordan", {
    person: { firstName: "Jordan", lastName: "Lee", major: "History", email: "jordan@yale.edu" },
    user: { phoneE164: "+12035550102", phoneVerifiedAt: new Date() },
  });
  await makeUser(db, "priya", { person: { firstName: "Priya", lastName: "Kapoor" } });
  await makePerson(db, "sam", { firstName: "Sam", lastName: "Wu", major: "Math", email: "sam@yale.edu", linkedinUrl: "https://www.linkedin.com/in/sam" });
  await makeFriends(db, "maya", "jordan");
  await makeFriends(db, "maya", "priya");
  await makeFriends(db, "priya", "sam");
  await makeMember(db, "jordan", club.id, { title: "Analyst" });
  await makeMember(db, "sam", club.id, { role: "board", title: "President" });
});
afterAll(() => close());

describe("rule 2: minimal data on other people", () => {
  test("a PersonCard has exactly the seven public fields: no email, phone, major or LinkedIn URL", async () => {
    const [sam] = await db.select().from(people).where(eq(people.netid, "sam"));
    expect(Object.keys(toPersonCard(sam, false)).sort()).toEqual(
      ["college", "first_name", "image_url", "is_user", "name", "netid", "year"].sort(),
    );
  });

  test("no API-shaped output about other people contains their email, phone, major or LinkedIn URL", async () => {
    const search = await searchPaths(db, { requesterNetid: "maya", clubId: club.id, channel: "app" });
    const outputs = JSON.stringify([
      search,
      await searchDirectory(db, viewer("maya"), "jordan"),
      await listClubMembers(db, viewer("maya"), club.id),
      await listFriends(db, viewer("maya")),
      await friendSuggestions(db, viewer("maya"), (await currentUser(db, "maya")).person),
    ]);
    expect(outputs).toContain("Jordan Lee");
    for (const secret of ["jordan@yale.edu", "sam@yale.edu", "History", "Math", "linkedin.com", "+12035550102", "5550102"]) {
      expect(outputs).not.toContain(secret);
    }
  });

  test("/api/me never returns the full phone number, only a mask", async () => {
    const me = JSON.stringify(await getMe(db, await currentUser(db, "jordan")));
    expect(me).not.toContain("+12035550102");
    expect(me).toContain("0102");
  });
});

describe("rule 4: evidence or nothing", () => {
  test("a research-sourced membership for a non-user without evidence is not written", async () => {
    const other = await makeClub(db, "Evidence Club");
    const row = await upsertMembership(db, { netid: "sam", clubId: other.id, status: "verified", source: "web_research", evidence: [] });
    expect(row).toBeNull();
    const bad = await upsertMembership(db, {
      netid: "sam",
      clubId: other.id,
      status: "verified",
      source: "public_roster",
      evidence: [{ url: "not-a-url", quote: "x", source_type: "club_site" }],
    });
    expect(bad).toBeNull();
    expect(await db.select().from(memberships).where(eq(memberships.clubId, other.id))).toEqual([]);
  });

  test("unverified research results are hidden from club pages and counts", async () => {
    const other = await makeClub(db, "Hidden Results Club");
    await makePerson(db, "unver");
    await upsertMembership(db, { netid: "unver", clubId: other.id, status: "unverified", source: "web_research" });
    expect(await listClubMembers(db, viewer("maya"), other.id)).toEqual([]);
    const listed = (await listClubs(db, viewer("maya"), { q: "Hidden Results" }))[0];
    expect(listed.member_count).toBe(0);
  });
});

describe("rule 5: opt-out that sticks", () => {
  test("hiding works before onboarding is complete, and removes the person everywhere", async () => {
    await makeUser(db, "hider", { person: { firstName: "Hildegard", lastName: "Hider" }, user: { onboardingDoneAt: null } });
    await makeFriends(db, "maya", "hider");
    await makeMember(db, "hider", club.id, { role: "board", title: "Chair" });
    expect(JSON.stringify(await searchPaths(db, { requesterNetid: "maya", clubId: club.id, channel: "app", limit: 5 }))).toContain("Hildegard");

    await updateMe(db, await currentUser(db, "hider"), { visibility: "hidden" });

    const search = await searchPaths(db, { requesterNetid: "maya", clubId: club.id, channel: "app", limit: 5 });
    const share = await createShare(db, "maya", search.search_id);
    const everything = JSON.stringify([
      search,
      await searchDirectory(db, viewer("maya"), "hildegard"),
      await listClubMembers(db, viewer("maya"), club.id),
      await friendSuggestions(db, viewer("maya"), (await currentUser(db, "maya")).person),
      await graphForToken(db, share.share_token),
    ]);
    expect(everything).not.toContain("Hildegard");
    expect(everything).not.toContain("hider");
    // They cannot be added as a friend by NetID either.
    await makeUser(db, "seeker");
    await expect(addFriend(db, viewer("seeker"), "hider")).rejects.toMatchObject({ code: "person_not_found" });
  });

  test("a hidden person is never queued for research when someone tries to add them", async () => {
    await makePerson(db, "hidden_nonuser", { visibility: "hidden" });
    await expect(addFriend(db, viewer("maya"), "hidden_nonuser")).rejects.toMatchObject({ code: "person_not_found" });
    expect(await db.select().from(jobs).where(eq(jobs.dedupeKey, "research_person:hidden_nonuser"))).toEqual([]);
  });

  test("the login page links to the page explaining what NEPO knows and how to leave", () => {
    const login = fs.readFileSync(path.join(process.cwd(), "src/app/(auth)/login/page.tsx"), "utf8");
    expect(login).toContain('href="/privacy"');
    const privacy = fs.readFileSync(path.join(process.cwd(), "src/app/privacy/page.tsx"), "utf8");
    expect(privacy).toMatch(/Hide me from NEPO/);
  });
});

describe("rule 6: friend lists stay private", () => {
  test("listFriends only ever returns the viewer's own friendships", async () => {
    const mine = await listFriends(db, viewer("maya"));
    const netids = [...mine.friends, ...mine.incoming, ...mine.outgoing].map((f) => f.netid);
    expect(netids).not.toContain("sam"); // Priya's friend, not Maya's
  });

  test("a path reveals an F–T friendship only to F's confirmed friends, and only when F shares connections", async () => {
    const asFriend = await searchPaths(db, { requesterNetid: "maya", clubId: club.id, channel: "app", limit: 5 });
    expect(asFriend.results.find((r) => r.connector.netid === "priya")?.target?.person.netid).toBe("sam");

    // A stranger to Priya learns nothing about her friendships, even after adding her one-sidedly.
    await makeUser(db, "stranger");
    await makeFriends(db, "stranger", "priya", "pending");
    const asStranger = await searchPaths(db, { requesterNetid: "stranger", clubId: club.id, channel: "app", limit: 5 });
    expect(JSON.stringify(asStranger.results)).not.toContain("sam");

    await db.update(users).set({ shareConnections: false }).where(eq(users.netid, "priya"));
    const afterOptOut = await searchPaths(db, { requesterNetid: "maya", clubId: club.id, channel: "app", limit: 5 });
    expect(afterOptOut.results.find((r) => r.connector.netid === "priya")).toBeUndefined();
    await db.update(users).set({ shareConnections: true }).where(eq(users.netid, "priya"));
  });
});

describe("rules 7 and 8: nobody is contacted automatically; connectors are in control", () => {
  test("creating and sending an intro makes no outbound request; only a response notifies the bot webhook", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    try {
      const search = await searchPaths(db, { requesterNetid: "maya", clubId: club.id, channel: "app" });
      const { message } = await draftIntro(db, { requesterNetid: "maya", searchId: search.search_id, connectorNetid: "jordan" });
      const intro = await createIntro(db, {
        requesterNetid: "maya",
        searchId: search.search_id,
        connectorNetid: "jordan",
        message,
        channel: "app",
      });
      await introAction(db, intro.id, "maya", "mark_sent");
      expect(fetchSpy).not.toHaveBeenCalled();

      // The webhook is opt-in and tells the bot, never the connector or a non-user.
      process.env.BOT_WEBHOOK_URL = "https://bot.example/webhook";
      await db.update(users).set({ phoneE164: "+12035550101", phoneVerifiedAt: new Date() }).where(eq(users.netid, "maya"));
      await respondToIntro(db, intro.id, "jordan", "decline", "too busy this month");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://bot.example/webhook");
      expect(JSON.parse(init.body as string)).toEqual({
        event: "intro.responded",
        intro_id: intro.id,
        decision: "decline",
        requester_phone: "+12035550101",
        connector_first_name: "Jordan",
        club_name: "Privacy Test Club",
      });

      // The requester sees only "not right now": no reason, even though one was given.
      const asRequester = await getIntro(db, intro.id, "maya");
      expect(asRequester.intro.status_label).toBe("Not right now");
      expect(asRequester.intro.connector_note).toBeNull();
      expect(JSON.stringify(asRequester)).not.toContain("too busy");
      // The connector still sees their own note.
      expect((await getIntro(db, intro.id, "jordan")).intro.connector_note).toBe("too busy this month");
    } finally {
      delete process.env.BOT_WEBHOOK_URL;
      fetchSpy.mockRestore();
    }
  });

  test("declining needs no reason", async () => {
    await makeUser(db, "asker");
    await makeFriends(db, "asker", "jordan");
    const search = await searchPaths(db, { requesterNetid: "asker", clubId: club.id, channel: "app" });
    const intro = await createIntro(db, { requesterNetid: "asker", searchId: search.search_id, connectorNetid: "jordan", message: "hi", channel: "app" });
    await introAction(db, intro.id, "asker", "mark_sent");
    const declined = await respondToIntro(db, intro.id, "jordan", "decline");
    expect(declined.status).toBe("declined");
  });

  test("only the requester and the connector can see an intro; the token link works only for the connector", async () => {
    await makeUser(db, "asker2");
    await makeFriends(db, "asker2", "jordan");
    const search = await searchPaths(db, { requesterNetid: "asker2", clubId: club.id, channel: "bot" });
    const intro = await createIntro(db, { requesterNetid: "asker2", searchId: search.search_id, connectorNetid: "jordan", message: "hi", channel: "bot" });
    const token = intro.response_url!.split("/i/")[1];
    await expect(getIntro(db, intro.id, "priya")).rejects.toMatchObject({ code: "intro_not_found" });
    await expect(getIntroByToken(db, token, "priya")).rejects.toMatchObject({ code: "forbidden" });
    await expect(respondToIntro(db, intro.id, "asker2", "accept")).rejects.toMatchObject({ code: "forbidden" });
    expect((await getIntroByToken(db, token, "jordan")).intro.id).toBe(intro.id);
    // A draft is not in the connector's inbox until it is sent.
    expect((await listIntros(db, "jordan", "incoming")).map((i) => i.id)).not.toContain(intro.id);
    await introAction(db, intro.id, "asker2", "mark_sent");
    expect((await listIntros(db, "jordan", "incoming")).map((i) => i.id)).toContain(intro.id);
  });

  test("an intro can only be created for a connector that the saved search actually returned", async () => {
    const search = await searchPaths(db, { requesterNetid: "maya", clubId: club.id, channel: "app" });
    await expect(
      createIntro(db, { requesterNetid: "maya", searchId: search.search_id, connectorNetid: "sam", message: "hi", channel: "app" }),
    ).rejects.toMatchObject({ code: "connector_not_in_search" });
    await expect(
      createIntro(db, { requesterNetid: "priya", searchId: search.search_id, connectorNetid: "jordan", message: "hi", channel: "app" }),
    ).rejects.toMatchObject({ code: "search_not_found" });
  });
});

describe("the connector's phone (bot only)", () => {
  test("released only to the requester's bot session for a confirmed friend with a verified phone; never for a one-sided add", async () => {
    const { connectorPhoneForRequester } = await import("@/server/intros/service");
    await makeUser(db, "phoner", { person: { firstName: "Phoebe", lastName: "Phoner" } });
    await makeUser(db, "onesided", {
      person: { firstName: "Ona", lastName: "Sided" },
      user: { phoneE164: "+12035550161", phoneVerifiedAt: new Date() },
    });
    await makeUser(db, "mutual", {
      person: { firstName: "Mu", lastName: "Tual" },
      user: { phoneE164: "+12035550162", phoneVerifiedAt: new Date() },
    });
    await makeFriends(db, "phoner", "onesided", "pending"); // phoner added them; they never accepted
    await makeFriends(db, "phoner", "mutual", "accepted");
    await makeMember(db, "onesided", club.id);
    await makeMember(db, "mutual", club.id);

    const search = await searchPaths(db, { requesterNetid: "phoner", clubId: club.id, channel: "bot", limit: 5 });
    const tieOf = (netid: string) => search.results.find((r) => r.connector.netid === netid)?.connector_tie;
    expect([tieOf("mutual"), tieOf("onesided")]).toEqual(["friend", "added"]);

    const toMutual = await createIntro(db, { requesterNetid: "phoner", searchId: search.search_id, connectorNetid: "mutual", message: "hi", channel: "bot" });
    const toOneSided = await createIntro(db, { requesterNetid: "phoner", searchId: search.search_id, connectorNetid: "onesided", message: "hi", channel: "bot" });
    expect(await connectorPhoneForRequester(db, toMutual.id, "phoner")).toBe("+12035550162");
    expect(await connectorPhoneForRequester(db, toOneSided.id, "phoner")).toBeNull();
    await expect(connectorPhoneForRequester(db, toMutual.id, "mutual")).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("graph endpoint (section 9.4)", () => {
  test("first name and last initial only, opaque ids, requester-only share, 24-hour expiry", async () => {
    // A fresh requester: Jordan declined Maya earlier, which suppresses him for her.
    await makeUser(db, "gina", { person: { firstName: "Gina", lastName: "Graph" } });
    await makeFriends(db, "gina", "jordan");
    await makeFriends(db, "gina", "priya");
    const search = await searchPaths(db, { requesterNetid: "gina", clubId: club.id, channel: "app", limit: 5 });
    await expect(createShare(db, "priya", search.search_id)).rejects.toMatchObject({ code: "search_not_found" });
    const share = await createShare(db, "gina", search.search_id);
    const graph = await graphForToken(db, share.share_token);
    const labels = graph.nodes.map((n) => n.label);
    expect(labels).toEqual(expect.arrayContaining(["PTC", "Gina G.", "Jordan L.", "Priya K.", "Sam W."]));
    const text = JSON.stringify(graph);
    for (const leak of ["Graph", "Lee", "Kapoor", "gina", "jordan", "priya", "sam\""]) expect(text).not.toContain(leak);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { from: "p1", to: "p2", kind: "friend" },
        { from: "p2", to: "club", kind: "member" },
      ]),
    );
    expect(graph.edges.some((e) => e.kind === "board")).toBe(true);

    await db.update(pathSearches).set({ shareExpiresAt: new Date(Date.now() - 1000) }).where(eq(pathSearches.id, search.search_id));
    await expect(graphForToken(db, share.share_token)).rejects.toMatchObject({ code: "share_expired" });
    await expect(graphForToken(db, "no-such-token")).rejects.toMatchObject({ code: "share_expired" });
  });
});

describe("rule 12: deletion", () => {
  test("delete account removes the user, friendships, experiences, self-sourced memberships and intros, and leaves the person hidden", async () => {
    const { user } = await makeUser(db, "leaver", { person: { firstName: "Lena", lastName: "Leaver", linkedinUrl: "https://www.linkedin.com/in/lena" } });
    await makeFriends(db, "leaver", "jordan");
    await makeFriends(db, "maya", "leaver");
    await db.insert(experiences).values({ userId: user.id, orgName: "Acme", kind: "job" });
    const selfClub = await makeClub(db, "Self Club");
    const rosterClub = await makeClub(db, "Roster Club");
    await makeMember(db, "leaver", selfClub.id, { status: "claimed" });
    await makeMember(db, "leaver", rosterClub.id, { status: "verified", source: "public_roster" });
    const search = await searchPaths(db, { requesterNetid: "leaver", clubId: club.id, channel: "app" });
    await createIntro(db, { requesterNetid: "leaver", searchId: search.search_id, connectorNetid: "jordan", message: "hi", channel: "app" });

    await deleteAccount(db, await currentUser(db, "leaver"));

    expect(await db.select().from(users).where(eq(users.netid, "leaver"))).toEqual([]);
    expect(
      await db.select().from(friendships).where(or(eq(friendships.requesterNetid, "leaver"), eq(friendships.addresseeNetid, "leaver"))),
    ).toEqual([]);
    expect(await db.select().from(experiences).where(eq(experiences.userId, user.id))).toEqual([]);
    expect(await db.select().from(intros).where(eq(intros.requesterNetid, "leaver"))).toEqual([]);
    expect(await db.select().from(pathSearches).where(eq(pathSearches.requesterNetid, "leaver"))).toEqual([]);
    const left = await db.select().from(memberships).where(eq(memberships.netid, "leaver"));
    expect(left.map((m) => m.source)).toEqual(["public_roster"]);

    const [person] = await db.select().from(people).where(eq(people.netid, "leaver"));
    expect([person.visibility, person.linkedinUrl]).toEqual(["hidden", null]);
    // Hidden, so the remaining public-roster membership is not shown and research will not rebuild the profile.
    expect(await listClubMembers(db, viewer("maya"), rosterClub.id)).toEqual([]);
  });

  test("/me offers hide and delete", () => {
    const dir = path.join(process.cwd(), "src/components/me");
    const source = fs.existsSync(dir)
      ? fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n")
      : "";
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/me/page.tsx"), "utf8");
    expect(source + page).toMatch(/Hide me from NEPO/);
    expect(source + page).toMatch(/Delete account/i);
  });
});
