import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { resolveClub } from "@/server/clubs/resolve";
import { resolveOrCreateClub } from "@/server/clubs/service";
import type { Db } from "@/server/db/client";
import { jobs, membershipEvidence, memberships, type Club } from "@/server/db/schema";
import {
  applyVerdict,
  createSelfReport,
  deleteMyMembership,
  listMyMemberships,
  upsertMembership,
  type Verdict,
} from "@/server/memberships/service";
import { seedClubs } from "@/server/tasks/seed";
import { createTestDb } from "../helpers/db";
import { makeClub, makeMember, makePerson, makeUser } from "../helpers/factory";

let db: Db;
let close: () => Promise<void>;
let n = 0;
const freshClub = () => makeClub(db, `Test Club ${++n}`);
const freshUser = async () => (await makeUser(db, `u${++n}`)).person.netid;
const ev = (url = "https://club.example/team") => [{ url, quote: "listed", source_type: "club_site" as const }];
const verdict = (v: Verdict["verdict"], evidence = ev()): Verdict => ({
  verdict: v,
  confidence: 0.9,
  role_found: null,
  is_board: null,
  evidence: v === "confirmed" || v === "likely" ? evidence : [],
});
const statusOf = async (id: string) => (await db.select().from(memberships).where(eq(memberships.id, id)))[0].status;

beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

describe("verdict → status (table in section 7.4)", () => {
  test.each([
    ["confirmed", "verified"],
    ["likely", "likely"],
    ["not_found", "claimed"],
    ["contradicted", "disputed"],
  ] as const)("claim from the person: %s → %s", async (v, expected) => {
    const m = await makeMember(db, await freshUser(), (await freshClub()).id, { status: "claimed" });
    expect((await applyVerdict(db, m.id, verdict(v))).status).toBe(expected);
  });

  test.each([
    ["confirmed", "verified"],
    ["likely", "likely"],
    ["not_found", "unverified"],
    ["contradicted", "rejected"],
  ] as const)("claim from research on a non-user: %s → %s", async (v, expected) => {
    const person = await makePerson(db, `p${++n}`);
    const m = await makeMember(db, person.netid, (await freshClub()).id, { status: "likely", source: "web_research" });
    await db.update(memberships).set({ status: "claimed" }).where(eq(memberships.id, m.id));
    expect((await applyVerdict(db, m.id, verdict(v))).status).toBe(expected);
  });

  test("a positive verdict with no surviving evidence is treated as not found", async () => {
    const m = await makeMember(db, await freshUser(), (await freshClub()).id, { status: "claimed" });
    expect((await applyVerdict(db, m.id, verdict("confirmed", []))).status).toBe("claimed");
  });

  test("re-validation never lowers verified to claimed; only contradicted moves it, to disputed", async () => {
    const m = await makeMember(db, await freshUser(), (await freshClub()).id, { status: "claimed" });
    await applyVerdict(db, m.id, verdict("confirmed"));
    expect((await applyVerdict(db, m.id, verdict("not_found"))).status).toBe("verified");
    expect((await applyVerdict(db, m.id, verdict("likely"))).status).toBe("verified");
    expect((await applyVerdict(db, m.id, verdict("contradicted"))).status).toBe("disputed");
  });

  test("a confirmed verdict replaces evidence and can raise the role, but not over a public roster", async () => {
    const club = await freshClub();
    const m = await makeMember(db, await freshUser(), club.id, { status: "claimed" });
    const updated = await applyVerdict(db, m.id, { ...verdict("confirmed"), role_found: "Treasurer", is_board: true });
    expect([updated.role, updated.title]).toEqual(["board", "Treasurer"]);
    const evidence = await db.select().from(membershipEvidence).where(eq(membershipEvidence.membershipId, m.id));
    expect(evidence.map((e) => e.url)).toEqual(["https://club.example/team"]);

    const roster = await makeMember(db, await freshUser(), club.id, { role: "member", source: "public_roster" });
    const after = await applyVerdict(db, roster.id, { ...verdict("confirmed"), role_found: "President", is_board: true });
    expect(after.role).toBe("member");
  });
});

describe("upsert rule (section 10)", () => {
  test("keeps the higher-trust status and merges evidence", async () => {
    const club = await freshClub();
    const netid = await freshUser();
    await makeMember(db, netid, club.id, { status: "verified", evidence: ev("https://a.example/1") });
    const again = await upsertMembership(db, {
      netid,
      clubId: club.id,
      status: "likely",
      source: "web_research",
      evidence: ev("https://b.example/2"),
    });
    expect(again?.status).toBe("verified");
    const urls = (await db.select().from(membershipEvidence).where(eq(membershipEvidence.membershipId, again!.id))).map((e) => e.url);
    expect(urls.sort()).toEqual(["https://a.example/1", "https://b.example/2"]);

    const raised = await upsertMembership(db, { netid: await freshUser(), clubId: club.id, status: "claimed", source: "self_report" });
    const up = await upsertMembership(db, { netid: raised!.netid, clubId: club.id, status: "verified", source: "public_roster", evidence: ev() });
    expect(up?.status).toBe("verified");
  });

  test("never resurrects rejected, except when the owner re-adds the club themselves", async () => {
    const club = await freshClub();
    const netid = await freshUser();
    const m = await makeMember(db, netid, club.id, { status: "verified", source: "public_roster" });
    await deleteMyMembership(db, netid, m.id); // research-sourced → rejected
    expect(await statusOf(m.id)).toBe("rejected");
    await upsertMembership(db, { netid, clubId: club.id, status: "verified", source: "public_roster", evidence: ev() });
    expect(await statusOf(m.id)).toBe("rejected");
    expect(await listMyMemberships(db, netid)).toEqual([]);
    await createSelfReport(db, netid, { clubId: club.id });
    expect(await statusOf(m.id)).toBe("claimed");
  });

  test("role preference: public_roster wins over a later self-report", async () => {
    const club = await freshClub();
    const netid = await freshUser();
    await makeMember(db, netid, club.id, { role: "board", title: "President", source: "public_roster" });
    const after = await upsertMembership(db, { netid, clubId: club.id, role: "member", status: "likely", source: "web_research", evidence: ev("https://x.example") });
    expect([after?.role, after?.title]).toEqual(["board", "President"]);
  });

  test("deleting a self-reported membership removes the row", async () => {
    const netid = await freshUser();
    const m = await createSelfReport(db, netid, { clubId: (await freshClub()).id });
    await deleteMyMembership(db, netid, m.id);
    expect(await db.select().from(memberships).where(eq(memberships.id, m.id))).toEqual([]);
  });

  test("an owner cannot edit or delete someone else's membership", async () => {
    const m = await makeMember(db, await freshUser(), (await freshClub()).id);
    await expect(deleteMyMembership(db, await freshUser(), m.id)).rejects.toMatchObject({ code: "membership_not_found" });
  });
});

describe("self-report and club resolution", () => {
  let ysig: Club;
  beforeAll(async () => {
    await seedClubs(db);
    ysig = (await resolveClub(db, "YSIG")).club!;
  });

  test("a self-report is `claimed`, source self_report, and queues validation", async () => {
    const netid = await freshUser();
    const m = await createSelfReport(db, netid, { clubName: "ysig", role: "member", title: "Analyst" });
    expect([m.status, m.source, m.clubId]).toEqual(["claimed", "self_report", ysig.id]);
    const [job] = await db.select().from(jobs).where(eq(jobs.dedupeKey, `validate_membership:${m.id}`));
    expect(job.status).toBe("queued");
  });

  test("exact alias match has confidence 1, with or without Yale / the", async () => {
    for (const text of ["YSIG", "ysig", "Yale Student Investment Group", "student investment group", "the Dramat", "Whiffs", "The News"]) {
      const r = await resolveClub(db, text);
      expect(r.club, text).not.toBeNull();
      expect(r.confidence).toBe(1);
    }
  });

  test("a close misspelling resolves by trigram similarity", async () => {
    const r = await resolveClub(db, "Yale Student Investmnt Group");
    expect(r.club?.id).toBe(ysig.id);
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
    expect(r.confidence).toBeLessThan(1);
  });

  test("an ambiguous or unknown phrase returns candidates and no club", async () => {
    const vague = await resolveClub(db, "Yale Magazine");
    expect(vague.club).toBeNull();
    expect(vague.candidates.length).toBeLessThanOrEqual(3);
    const none = await resolveClub(db, "zzzz qqqq");
    expect(none).toMatchObject({ club: null, candidates: [] });
  });

  test("an unknown club name creates an unreviewed club with an alias and queues a roster crawl", async () => {
    const club = await resolveOrCreateClub(db, "Yale Underwater Basket Weaving Society");
    expect(club.status).toBe("unreviewed");
    expect((await resolveClub(db, "underwater basket weaving society")).club?.id).toBe(club.id);
    const [job] = await db.select().from(jobs).where(eq(jobs.dedupeKey, `crawl_roster:${club.id}`));
    expect(job.type).toBe("crawl_roster");
  });
});
