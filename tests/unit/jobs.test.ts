import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Db } from "@/server/db/client";
import {
  agentRuns,
  clubs,
  experiences,
  jobs,
  membershipEvidence,
  memberships,
  people,
  unmatchedRosterNames,
  users,
  type Club,
} from "@/server/db/schema";
import { claimNext, enqueue, failJob, recoverStuck, requeueStuck } from "@/server/jobs/queue";
import { drainJobs } from "@/server/jobs/run";
import { confirmLinkedin, linkedinStatus, submitLinkedinPdfText, submitLinkedinUrl } from "@/server/linkedin/service";
import { sha256 } from "@/server/privacy/redact";
import { createTestDb } from "../helpers/db";
import { makeClub, makeMember, makePerson, makeUser } from "../helpers/factory";

let db: Db;
let close: () => Promise<void>;
let rosterClub: Club;
let uncitedClub: Club;
let oldClub: Club;

const membershipOf = async (netid: string, clubId: string) =>
  (await db.select().from(memberships).where(and(eq(memberships.netid, netid), eq(memberships.clubId, clubId))))[0];
const userRow = async (netid: string) => (await db.select().from(users).where(eq(users.netid, netid)))[0];
const drainAll = async () => {
  for (let i = 0; i < 10; i++) if ((await drainJobs(db, 10)).ran === 0) break;
};

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  rosterClub = await makeClub(db, "T Roster Club", undefined, { slug: "t-roster-club" });
  uncitedClub = await makeClub(db, "T Uncited Club", undefined, { slug: "t-uncited-club" });
  oldClub = await makeClub(db, "T Old Club", undefined, { slug: "t-old-club" });
  await makePerson(db, "alice1", { firstName: "Alice", lastName: "Roster" });
  await makePerson(db, "bob1", { firstName: "Robert", preferredName: "Bob", lastName: "Member" });
  await makePerson(db, "sw27", { firstName: "Sam", lastName: "Wright", year: 2027 });
  await makePerson(db, "sw28", { firstName: "Samuel", lastName: "Wright", year: 2028 });
  await makePerson(db, "hid1", { firstName: "Hidden", lastName: "Student", visibility: "hidden" });
});
afterAll(() => close());

describe("queue (section 10)", () => {
  test("dedupe: a queued key is a no-op; a finished key is replaced only after its TTL", async () => {
    const club = await makeClub(db, "Dedupe Club");
    const first = await enqueue(db, "crawl_roster", { club_id: club.id });
    expect(first.enqueued).toBe(true);
    expect((await enqueue(db, "crawl_roster", { club_id: club.id })).enqueued).toBe(false);

    await db.update(jobs).set({ status: "done", finishedAt: new Date() }).where(eq(jobs.id, first.job!.id));
    expect((await enqueue(db, "crawl_roster", { club_id: club.id })).enqueued).toBe(false);

    const longAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    await db.update(jobs).set({ finishedAt: longAgo }).where(eq(jobs.id, first.job!.id));
    const again = await enqueue(db, "crawl_roster", { club_id: club.id });
    expect(again.enqueued).toBe(true);
    expect(again.job!.id).toBe(first.job!.id);
    expect(again.job!.status).toBe("queued");
    await db.delete(jobs);
  });

  test("claimNext takes the oldest ready job once; run_after in the future is not ready", async () => {
    const a = await enqueue(db, "research_person", { netid: "x1" }, { runAfter: new Date(Date.now() - 2000) });
    await enqueue(db, "research_person", { netid: "x2" }, { runAfter: new Date(Date.now() + 60_000) });
    const claimed = await claimNext(db);
    expect(claimed?.id).toBe(a.job!.id);
    expect([claimed?.status, claimed?.attempts]).toEqual(["running", 1]);
    expect(await claimNext(db)).toBeNull();
    await db.delete(jobs);
  });

  test("failure: back to queued with attempts × 60 s backoff, then failed with the error on the third attempt", async () => {
    const { job } = await enqueue(db, "research_person", { netid: "x3" });
    const first = (await claimNext(db))!;
    expect(await failJob(db, first, "boom")).toBe("queued");
    const [afterFirst] = await db.select().from(jobs).where(eq(jobs.id, job!.id));
    const delay = afterFirst.runAfter.getTime() - Date.now();
    expect(delay).toBeGreaterThan(50_000);
    expect(delay).toBeLessThan(70_000);
    expect(await failJob(db, { ...afterFirst, attempts: 3 }, "boom again")).toBe("failed");
    const [final] = await db.select().from(jobs).where(eq(jobs.id, job!.id));
    expect([final.status, final.error]).toEqual(["failed", "boom again"]);
    await db.delete(jobs);
  });

  test("a job stuck in running is re-queued only after 20 minutes, and failed once its attempts are used up", async () => {
    try {
      const { job } = await enqueue(db, "research_person", { netid: "x4" });
      // Six minutes in, a slow agent run is still alive: it must not be handed to a second runner.
      await db
        .update(jobs)
        .set({ status: "running", attempts: 1, lockedAt: new Date(Date.now() - 6 * 60_000) })
        .where(eq(jobs.id, job!.id));
      expect(await requeueStuck(db)).toBe(0);
      await db.update(jobs).set({ lockedAt: new Date(Date.now() - 21 * 60_000) }).where(eq(jobs.id, job!.id));
      expect(await requeueStuck(db)).toBe(1);
      // The runner died on the last allowed attempt: the job fails instead of looping forever.
      await db
        .update(jobs)
        .set({ status: "running", attempts: 3, lockedAt: new Date(Date.now() - 21 * 60_000) })
        .where(eq(jobs.id, job!.id));
      const recovered = await recoverStuck(db);
      expect([recovered.requeued, recovered.failed.map((j) => j.id)]).toEqual([0, [job!.id]]);
      const [row] = await db.select().from(jobs).where(eq(jobs.id, job!.id));
      expect(row.status).toBe("failed");
    } finally {
      await db.delete(jobs);
    }
  });

  test("a failed crawl can be queued again after an hour, not after the full TTL", async () => {
    try {
      const { job } = await enqueue(db, "crawl_roster", { club_id: "00000000-0000-0000-0000-000000000001" });
      await db.update(jobs).set({ status: "failed", finishedAt: new Date(Date.now() - 2 * 60 * 60_000) }).where(eq(jobs.id, job!.id));
      expect((await enqueue(db, "crawl_roster", { club_id: "00000000-0000-0000-0000-000000000001" })).enqueued).toBe(true);
      await db.update(jobs).set({ status: "done", finishedAt: new Date(Date.now() - 2 * 60 * 60_000) }).where(eq(jobs.id, job!.id));
      expect((await enqueue(db, "crawl_roster", { club_id: "00000000-0000-0000-0000-000000000001" })).enqueued).toBe(false);
    } finally {
      await db.delete(jobs);
    }
  });

  test("the hourly budget stops claiming", async () => {
    process.env.ENRICH_MAX_JOBS_PER_HOUR = "1";
    try {
      await enqueue(db, "research_person", { netid: "x5" });
      await enqueue(db, "research_person", { netid: "x6" });
      expect(await claimNext(db)).not.toBeNull();
      expect(await claimNext(db)).toBeNull();
    } finally {
      delete process.env.ENRICH_MAX_JOBS_PER_HOUR;
      await db.delete(jobs);
    }
  });
});

describe("crawl_roster", () => {
  test("matches names to people, writes verified public_roster memberships with evidence, and never guesses", async () => {
    await enqueue(db, "crawl_roster", { club_id: rosterClub.id });
    await drainAll();

    const alice = await membershipOf("alice1", rosterClub.id);
    expect([alice.status, alice.source, alice.role, alice.title]).toEqual(["verified", "public_roster", "board", "President"]);
    const [evidence] = await db.select().from(membershipEvidence).where(eq(membershipEvidence.membershipId, alice.id));
    expect([evidence.url, evidence.sourceType]).toEqual(["https://rosterclub.example/team", "club_site"]);

    // "Bob Member" matches Robert "Bob" Member through the preferred name.
    expect((await membershipOf("bob1", rosterClub.id)).status).toBe("verified");
    // "Sam Wright" with no year is ambiguous between two people; with year 2028 it is not.
    expect(await membershipOf("sw27", rosterClub.id)).toBeUndefined();
    expect((await membershipOf("sw28", rosterClub.id)).title).toBe("Editor");
    // A hidden person is never matched.
    expect(await membershipOf("hid1", rosterClub.id)).toBeUndefined();

    const unmatched = await db.select().from(unmatchedRosterNames).where(eq(unmatchedRosterNames.clubId, rosterClub.id));
    expect(unmatched.map((u) => u.fullName).sort()).toEqual(["Ghost Person", "Hidden Student", "Sam Wright"]);

    const [club] = await db.select().from(clubs).where(eq(clubs.id, rosterClub.id));
    expect(club.rosterUrl).toBe("https://rosterclub.example/team");
    expect(club.website).toBe("https://rosterclub.example");
    expect(club.rosterCrawledAt).not.toBeNull();
  });

  test("evidence integrity: a roster whose page was not cited is discarded", async () => {
    await enqueue(db, "crawl_roster", { club_id: uncitedClub.id });
    await drainAll();
    expect(await membershipOf("alice1", uncitedClub.id)).toBeUndefined();
    const [club] = await db.select().from(clubs).where(eq(clubs.id, uncitedClub.id));
    expect(club.rosterUrl).toBeNull();
  });

  test("a roster from an earlier academic year yields `likely`, not `verified`", async () => {
    await enqueue(db, "crawl_roster", { club_id: oldClub.id });
    await drainAll();
    expect((await membershipOf("alice1", oldClub.id)).status).toBe("likely");
  });
});

describe("validate_membership", () => {
  const claim = async (netid: string, first: string, last: string) => {
    await makeUser(db, netid, { person: { firstName: first, lastName: last } });
    const m = await makeMember(db, netid, rosterClub.id, { status: "claimed" });
    await enqueue(db, "validate_membership", { membership_id: m.id });
    await drainAll();
    return (await db.select().from(memberships).where(eq(memberships.id, m.id)))[0];
  };

  test("confirmed with cited club-site evidence → verified", async () => {
    const m = await claim("t_val_ok", "Val", "Ok");
    expect([m.status, m.title]).toEqual(["verified", "Analyst"]);
  });

  test("evidence integrity: evidence the run did not cite is removed, and the verdict is not trusted", async () => {
    const m = await claim("t_val_fake", "Val", "Fake");
    expect(m.status).toBe("claimed");
    expect(await db.select().from(membershipEvidence).where(eq(membershipEvidence.membershipId, m.id))).toEqual([]);
  });

  test("\"confirmed\" backed only by LinkedIn is downgraded to likely (source type comes from the host)", async () => {
    const m = await claim("t_val_weak", "Val", "Weak");
    expect(m.status).toBe("likely");
    const [e] = await db.select().from(membershipEvidence).where(eq(membershipEvidence.membershipId, m.id));
    expect(e.sourceType).toBe("linkedin");
  });

  test("a hidden person is never sent to an agent", async () => {
    await makeUser(db, "t_val_hidden", { person: { visibility: "hidden" } });
    const m = await makeMember(db, "t_val_hidden", rosterClub.id, { status: "claimed" });
    const before = (await db.select().from(agentRuns)).length;
    const { job } = await enqueue(db, "validate_membership", { membership_id: m.id });
    await drainAll();
    expect((await db.select().from(agentRuns)).length).toBe(before);
    const [done] = await db.select().from(jobs).where(eq(jobs.id, job!.id));
    expect(done.result).toEqual({ skipped: "person is hidden" });
  });
});

describe("research_person", () => {
  test("writes only affiliations with cited evidence: strong source → verified, weak → likely, none → dropped", async () => {
    await makePerson(db, "t_research", { firstName: "Rita", lastName: "Research" });
    await enqueue(db, "research_person", { netid: "t_research" });
    await drainAll();

    expect((await membershipOf("t_research", rosterClub.id)).status).toBe("verified"); // club site
    expect((await membershipOf("t_research", oldClub.id)).status).toBe("likely"); // LinkedIn only
    expect(await membershipOf("t_research", uncitedClub.id)).toBeUndefined(); // evidence was not cited
    // A club NEPO has never heard of is not created from third-party evidence alone.
    expect(await db.select().from(clubs).where(eq(clubs.name, "Totally New Society"))).toEqual([]);

    const [person] = await db.select().from(people).where(eq(people.netid, "t_research"));
    expect(person.researchedAt).not.toBeNull();
    // Non-user: no LinkedIn URL is kept (privacy rule 2).
    expect(person.linkedinUrl).toBeNull();
  });

  test("hidden people and demo people are never researched", async () => {
    await makePerson(db, "t_hidden_research", { visibility: "hidden" });
    await makePerson(db, "demo_x", { isDemo: true });
    const before = (await db.select().from(agentRuns)).length;
    await enqueue(db, "research_person", { netid: "t_hidden_research" });
    await enqueue(db, "research_person", { netid: "demo_x" });
    await drainAll();
    expect((await db.select().from(agentRuns)).length).toBe(before);
  });
});

describe("LinkedIn flow", () => {
  const PDF_TEXT = `Pat D. Fine\nStudent at Yale University\n${"Experience line. ".repeat(20)}SECRET-MARKER-IN-PDF`;

  test("URL that cannot be read → needs_pdf, nothing stored", async () => {
    const { user } = await makeUser(db, "t_url_wall");
    await submitLinkedinUrl(db, user, "linkedin.com/in/t-url-wall/?trk=abc");
    expect((await userRow("t_url_wall")).linkedinStatus).toBe("reading");
    const [person] = await db.select().from(people).where(eq(people.netid, "t_url_wall"));
    expect(person.linkedinUrl).toBe("https://www.linkedin.com/in/t-url-wall");
    await drainAll();
    expect((await userRow("t_url_wall")).linkedinStatus).toBe("needs_pdf");
    expect(await db.select().from(memberships).where(eq(memberships.netid, "t_url_wall"))).toEqual([]);
  });

  test("readable URL with a matching identity → claims, then validation", async () => {
    const { user } = await makeUser(db, "t_url_ok");
    await submitLinkedinUrl(db, user, "https://www.linkedin.com/in/t-url-ok");
    await drainAll();
    const status = await linkedinStatus(db, await userRow("t_url_ok"));
    expect(status.status).toBe("ok");
    expect(status.found.map((f) => f.club_name)).toEqual(["T Roster Club"]);
    const m = await membershipOf("t_url_ok", rosterClub.id);
    expect([m.status, m.source]).toEqual(["claimed", "linkedin_url"]);
  });

  test("identity mismatch on a URL → mismatch, nothing stored", async () => {
    const { user } = await makeUser(db, "t_url_wrong");
    await submitLinkedinUrl(db, user, "https://www.linkedin.com/in/someone-else");
    await drainAll();
    expect((await userRow("t_url_wrong")).linkedinStatus).toBe("mismatch");
    expect(await membershipOf("t_url_wrong", rosterClub.id)).toBeUndefined();
  });

  test("rejects anything that is not a linkedin.com/in/ URL", async () => {
    const { user } = await makeUser(db, "t_url_bad");
    for (const bad of ["https://evil.example/in/me", "https://linkedin.com/company/yale", "javascript:alert(1)"]) {
      await expect(submitLinkedinUrl(db, user, bad)).rejects.toMatchObject({ code: "invalid_linkedin_url" });
    }
  });

  test("PDF: claims and experiences are written; the text is scrubbed from the payload and never logged", async () => {
    const { user } = await makeUser(db, "t_pdf_ok", { person: { firstName: "Patricia", preferredName: "Pat", lastName: "Fine" } });
    await submitLinkedinPdfText(db, user, PDF_TEXT);
    const [queued] = await db.select().from(jobs).where(eq(jobs.id, (await userRow("t_pdf_ok")).linkedinJobId!));
    expect((queued.payload as { text?: string }).text).toContain("SECRET-MARKER-IN-PDF");
    await drainAll();

    const [done] = await db.select().from(jobs).where(eq(jobs.id, queued.id));
    expect(done.status).toBe("done");
    expect(done.payload).toEqual({ user_id: user.id });
    const runs = await db.select().from(agentRuns).where(eq(agentRuns.jobId, queued.id));
    expect(runs).toHaveLength(1);
    expect(JSON.stringify(runs)).not.toContain("SECRET-MARKER-IN-PDF");
    expect((runs[0].input as { text: { sha256: string } }).text.sha256).toBe(sha256(PDF_TEXT));
    expect(JSON.stringify(await db.select().from(jobs))).not.toContain("SECRET-MARKER-IN-PDF");

    const m = await membershipOf("t_pdf_ok", rosterClub.id);
    expect([m.status, m.source, m.role]).toEqual(["claimed", "linkedin_pdf", "board"]);
    const exp = await db.select().from(experiences).where(eq(experiences.userId, user.id));
    expect(exp.map((e) => [e.orgName, e.kind])).toEqual([["Acme Corp", "internship"]]);
    expect((await userRow("t_pdf_ok")).linkedinStatus).toBe("ok");
  });

  test("PDF with someone else's name: nothing is written until the user confirms", async () => {
    const { user } = await makeUser(db, "t_pdf_other", { person: { firstName: "Pat", lastName: "Fine" } });
    await submitLinkedinPdfText(db, user, PDF_TEXT);
    await drainAll();
    expect(await membershipOf("t_pdf_other", rosterClub.id)).toBeUndefined();
    const status = await linkedinStatus(db, await userRow("t_pdf_other"));
    expect(status).toMatchObject({ status: "mismatch", needs_confirmation: true, profile_name: "Someone Else", found: [] });

    const confirmed = await confirmLinkedin(db, await userRow("t_pdf_other"), true);
    expect(confirmed.status).toBe("ok");
    expect((await membershipOf("t_pdf_other", rosterClub.id)).status).toBe("claimed");
    await expect(confirmLinkedin(db, await userRow("t_pdf_other"), true)).rejects.toMatchObject({ code: "nothing_to_confirm" });
  });

  test("declining the confirmation discards the held affiliations", async () => {
    const { user } = await makeUser(db, "t_pdf_other2", { person: { firstName: "Pat", lastName: "Fine" } });
    await submitLinkedinPdfText(db, user, PDF_TEXT);
    await drainAll();
    // default.json is a profile for "Sample Student", so this is also a mismatch.
    expect((await linkedinStatus(db, await userRow("t_pdf_other2"))).needs_confirmation).toBe(true);
    await confirmLinkedin(db, await userRow("t_pdf_other2"), false);
    expect(await db.select().from(memberships).where(eq(memberships.netid, "t_pdf_other2"))).toEqual([]);
    expect((await linkedinStatus(db, await userRow("t_pdf_other2"))).needs_confirmation).toBe(false);
    const [row] = await db.select().from(jobs).where(eq(jobs.id, (await userRow("t_pdf_other2")).linkedinJobId!));
    expect(JSON.stringify(row.result)).not.toContain("Yale Political Union");
  });
});
