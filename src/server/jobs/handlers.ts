import { and, eq, inArray, ne } from "drizzle-orm";
import { fullNameMatchesPerson } from "@/lib/names";
import { runMembershipValidator } from "@/server/agents/membershipValidator";
import { runPersonResearcher } from "@/server/agents/personResearcher";
import { runProfileExtractor } from "@/server/agents/profileExtractor";
import { runProfileReader } from "@/server/agents/profileReader";
import { runRosterCrawler } from "@/server/agents/rosterCrawler";
import { createUnreviewedClub } from "@/server/clubs/service";
import { resolveClub } from "@/server/clubs/resolve";
import type { Db } from "@/server/db/client";
import {
  clubAliases,
  clubs,
  memberships,
  people,
  unmatchedRosterNames,
  users,
  type Job,
} from "@/server/db/schema";
import { applyAffiliations, setLinkedinStatus } from "@/server/linkedin/service";
import { applyVerdict, isOwnSource, upsertMembership, type Evidence } from "@/server/memberships/service";
import { matchRosterName } from "@/server/people/match";
import { displayName } from "@/server/people/service";
import { classifySource, filterCited, isCited, isCitedHost, isStrongSource } from "@/server/claude/evidence";
import { jobs } from "@/server/db/schema";
import type { JobPayloads } from "./queue";
import { PermanentJobError, type JobHandler, type JobOutcome } from "./run";

async function loadUser(db: Db, userId: string) {
  const [row] = await db
    .select({ user: users, person: people })
    .from(users)
    .innerJoin(people, eq(people.netid, users.netid))
    .where(eq(users.id, userId));
  if (!row) throw new PermanentJobError("User no longer exists.");
  return row;
}

async function aliasesOf(db: Db, clubId: string): Promise<string[]> {
  const rows = await db.select({ alias: clubAliases.alias }).from(clubAliases).where(eq(clubAliases.clubId, clubId));
  return rows.map((r) => r.alias);
}

/** linkedin_read: profileReader → claims, or `needs_pdf` / `mismatch`. Nothing is stored unless readable and matched. */
const linkedinRead: JobHandler = async (db, job) => {
  const payload = job.payload as JobPayloads["linkedin_read"];
  const { user, person } = await loadUser(db, payload.user_id);
  const { output } = await runProfileReader(
    db,
    { url: payload.url, name: displayName(person), college: person.college, year: person.year, netid: person.netid },
    { jobId: job.id },
  );
  if (!output.readable || output.identity_match === "unsure") {
    await setLinkedinStatus(db, user.id, "needs_pdf");
    return { result: { found: [], needs_confirmation: false, reason: output.reason ?? "Profile was not readable." } };
  }
  if (output.identity_match === "no") {
    await setLinkedinStatus(db, user.id, "mismatch");
    return { result: { found: [], needs_confirmation: false, reason: "That profile does not look like yours." } };
  }
  const found = await applyAffiliations(db, user, output.affiliations, "linkedin_url");
  await setLinkedinStatus(db, user.id, "ok");
  return { result: { found, needs_confirmation: false } };
};

/** linkedin_pdf: profileExtractor → claims. The text is scrubbed from the payload when the job finishes. */
const linkedinPdf: JobHandler = async (db, job) => {
  const payload = job.payload as JobPayloads["linkedin_pdf"];
  const scrubbed = { user_id: payload.user_id };
  if (!payload.text) throw new PermanentJobError("The uploaded text is no longer available. Upload the PDF again.");
  const { user, person } = await loadUser(db, payload.user_id);
  const { output } = await runProfileExtractor(
    db,
    { text: payload.text, name: displayName(person), year: person.year, netid: person.netid },
    { jobId: job.id },
  );
  if (!fullNameMatchesPerson(output.profile_name, person)) {
    // Create nothing until the user confirms the document is theirs.
    await setLinkedinStatus(db, user.id, "mismatch");
    return {
      result: { held: output.affiliations, needs_confirmation: true, profile_name: output.profile_name.slice(0, 120) },
      payload: scrubbed,
    };
  }
  const found = await applyAffiliations(db, user, output.affiliations, "linkedin_pdf");
  await setLinkedinStatus(db, user.id, "ok");
  return { result: { found, needs_confirmation: false }, payload: scrubbed };
};

/** validate_membership: membershipValidator → status, confidence, role, evidence. */
const validateMembership: JobHandler = async (db, job) => {
  const payload = job.payload as JobPayloads["validate_membership"];
  const [row] = await db
    .select({ m: memberships, person: people, club: clubs })
    .from(memberships)
    .innerJoin(people, eq(people.netid, memberships.netid))
    .innerJoin(clubs, eq(clubs.id, memberships.clubId))
    .where(eq(memberships.id, payload.membership_id));
  if (!row) return { result: { skipped: "membership no longer exists" } };
  if (row.m.status === "rejected") return { result: { skipped: "membership was rejected" } };
  // Hidden people are never an agent input (privacy rule 5).
  if (row.person.visibility !== "listed") return { result: { skipped: "person is hidden" } };

  const years =
    row.m.startYear || row.m.endYear ? `${row.m.startYear ?? "?"} to ${row.m.endYear ?? "present"}` : null;
  const { output, citations } = await runMembershipValidator(
    db,
    {
      personName: displayName(row.person),
      college: row.person.college,
      year: row.person.year,
      clubName: row.club.name,
      clubAliases: await aliasesOf(db, row.club.id),
      clubWebsite: row.club.website,
      claimedRole: row.m.title ?? row.m.role,
      claimedYears: years,
      claimSource: isOwnSource(row.m.source) ? "the student themselves" : "public research",
      fixtureKey: `${row.person.netid}__${row.club.slug}`,
    },
    { jobId: job.id },
  );
  // Evidence integrity: only URLs the run actually cited survive, and the
  // source type is decided by the host, not by the agent's label.
  const evidence: Evidence[] = filterCited(output.evidence, citations).map((e) => ({
    url: e.url,
    quote: e.quote,
    source_type: classifySource(e.url, row.club.website),
  }));
  let verdict = output.verdict;
  if (verdict === "confirmed" && !evidence.some((e) => isStrongSource(e.source_type))) {
    verdict = evidence.length > 0 ? "likely" : "not_found";
  }
  const updated = await applyVerdict(db, row.m.id, { ...output, verdict, evidence });
  return {
    result: {
      verdict,
      agent_verdict: output.verdict,
      status: updated.status,
      evidence_kept: evidence.length,
      evidence_dropped: output.evidence.length - evidence.length,
    },
  };
};

/** Academic year start (the fall year) for a date: Aug–Dec → that year, Jan–Jul → the year before. */
function academicYearStart(d = new Date()): number {
  return d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
}

/** Is an `as_of` label ("2024-2025", "Spring 2025") from an earlier academic year than now? */
export function rosterIsOld(asOf: string | null, now = new Date()): boolean {
  if (!asOf) return false;
  const years = [...asOf.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
  const short = asOf.match(/\b20(\d{2})\s*[-–/]\s*(\d{2})\b/);
  if (short) years.push(2000 + Number(short[2]));
  if (years.length === 0) return false;
  const start = academicYearStart(now);
  // A roster labelled with the current fall year or the following spring year is current.
  return Math.max(...years) < start + (years.length === 1 ? 0 : 1);
}

/** crawl_roster: rosterCrawler → match names → verified/public_roster memberships; unmatched names to review. */
const crawlRoster: JobHandler = async (db, job) => {
  const payload = job.payload as JobPayloads["crawl_roster"];
  const [club] = await db.select().from(clubs).where(eq(clubs.id, payload.club_id));
  if (!club) return { result: { skipped: "club no longer exists" } };
  const { output, citations } = await runRosterCrawler(
    db,
    { clubName: club.name, aliases: await aliasesOf(db, club.id), website: club.website, slug: club.slug },
    { jobId: job.id },
  );

  // The agent's idea of the club's website is kept only if a page on that host
  // was actually retrieved: evidence on the club's own site can verify a member.
  const website =
    club.website ??
    (output.website && /^https?:\/\//i.test(output.website) && isCitedHost(output.website, citations)
      ? output.website
      : null);
  // Evidence integrity: a roster whose page was not cited is not used.
  const rosterCited = Boolean(output.roster_url && isCited(output.roster_url, citations));
  await db
    .update(clubs)
    .set({ rosterCrawledAt: new Date(), website, ...(rosterCited ? { rosterUrl: output.roster_url } : {}) })
    .where(eq(clubs.id, club.id));
  if (!rosterCited || output.members.length === 0) {
    return {
      result: {
        matched: 0,
        unmatched: 0,
        members_reported: output.members.length,
        note: output.roster_url && !rosterCited ? "roster page was not among the cited sources; discarded" : output.notes,
      },
    };
  }

  const old = rosterIsOld(output.as_of);
  const sourceType = classifySource(output.roster_url!, website);
  let matched = 0;
  let unmatched = 0;
  for (const member of output.members.slice(0, 200)) {
    const match = await matchRosterName(db, {
      fullName: member.full_name,
      classYear: member.class_year,
      college: member.college,
    });
    if (match.kind !== "match") {
      // Never pick among ambiguous candidates; a human resolves these in /admin.
      const [seen] = await db
        .select({ id: unmatchedRosterNames.id })
        .from(unmatchedRosterNames)
        .where(and(eq(unmatchedRosterNames.clubId, club.id), eq(unmatchedRosterNames.fullName, member.full_name)));
      if (!seen) {
        await db.insert(unmatchedRosterNames).values({
          clubId: club.id,
          fullName: member.full_name.slice(0, 200),
          roleTitle: member.role_title?.slice(0, 200) ?? null,
          sourceUrl: output.roster_url,
        });
      }
      unmatched++;
      continue;
    }
    await upsertMembership(db, {
      netid: match.netid,
      clubId: club.id,
      role: member.is_board ? "board" : "member",
      title: member.role_title,
      // Boards turn over every year, so an old roster is only "likely".
      status: old ? "likely" : "verified",
      source: "public_roster",
      evidence: [{ url: output.roster_url!, quote: member.quote, source_type: sourceType }],
    });
    matched++;
  }
  return { result: { matched, unmatched, roster_url: output.roster_url, as_of: output.as_of, old } };
};

/** research_person: personResearcher → memberships, only with evidence the run cited. */
const researchPerson: JobHandler = async (db, job) => {
  const payload = job.payload as JobPayloads["research_person"];
  const [person] = await db.select().from(people).where(eq(people.netid, payload.netid));
  if (!person) return { result: { skipped: "person no longer exists" } };
  // Never researched: hidden people (privacy rule 5) and demo rows.
  if (person.visibility !== "listed") return { result: { skipped: "person is hidden" } };
  if (person.isDemo) return { result: { skipped: "demo person" } };

  const known = await db.select({ name: clubs.name }).from(clubs).where(ne(clubs.status, "hidden")).limit(150);
  const { output, citations } = await runPersonResearcher(
    db,
    {
      netid: person.netid,
      name: displayName(person),
      college: person.college,
      year: person.year,
      major: null, // not kept (privacy rule 2)
      knownClubs: known.map((c) => c.name),
    },
    { jobId: job.id },
  );

  const [isUser] = await db.select({ id: users.id }).from(users).where(eq(users.netid, person.netid));
  let written = 0;
  let dropped = 0;
  for (const a of output.affiliations) {
    if (a.kind !== "yale_club") continue;
    const resolved = await resolveClub(db, a.org_name);
    const cited = filterCited(
      output.evidence.filter((e) => e.org_name.trim().toLowerCase() === a.org_name.trim().toLowerCase()),
      citations,
    );
    const evidence: Evidence[] = cited.map((e) => ({
      url: e.url,
      quote: e.quote,
      source_type: classifySource(e.url, resolved.club?.website),
    }));
    // Evidence or nothing (privacy rule 4).
    if (evidence.length === 0) {
      dropped++;
      continue;
    }
    const strong = evidence.some((e) => isStrongSource(e.source_type));
    const club = resolved.club ?? (strong ? await createUnreviewedClub(db, a.org_name) : null);
    if (!club) {
      dropped++;
      continue;
    }
    const row = await upsertMembership(db, {
      netid: person.netid,
      clubId: club.id,
      role: !a.is_current ? "alum" : a.is_leadership ? "board" : "member",
      title: a.role_title,
      startYear: a.start_year,
      endYear: a.end_year,
      isCurrent: a.is_current,
      status: strong ? "verified" : "likely",
      source: "web_research",
      evidence,
    });
    if (row) written++;
    else dropped++;
  }
  const patch: Partial<typeof people.$inferInsert> = { researchedAt: new Date() };
  // A LinkedIn URL is kept only for users; for non-users NEPO keeps memberships and evidence only (privacy rule 2).
  if (isUser && !person.linkedinUrl && output.linkedin_url && isCited(output.linkedin_url, citations)) {
    patch.linkedinUrl = output.linkedin_url;
    patch.linkedinUrlSource = "agent";
  }
  await db.update(people).set(patch).where(eq(people.netid, person.netid));
  return { result: { written, dropped } };
};

export const handlers: Record<string, JobHandler> = {
  linkedin_read: linkedinRead,
  linkedin_pdf: linkedinPdf,
  validate_membership: validateMembership,
  crawl_roster: crawlRoster,
  research_person: researchPerson,
};

/** Called once a job has failed for good. No silent fallbacks: the failure is surfaced on the record. */
export async function onJobFailed(db: Db, job: Job, message: string): Promise<void> {
  if (job.type === "linkedin_read" || job.type === "linkedin_pdf") {
    const payload = job.payload as { user_id?: string };
    if (payload.user_id) {
      await db
        .update(users)
        .set({ linkedinStatus: "failed" })
        .where(and(eq(users.id, payload.user_id), inArray(users.linkedinStatus, ["reading"])));
    }
    if (job.type === "linkedin_pdf") {
      // Uploads are transient even when the job fails (privacy rule 9).
      await db.update(jobs).set({ payload: { user_id: payload.user_id } }).where(eq(jobs.id, job.id));
    }
  }
  console.error(`[jobs] ${job.type} ${job.id} failed: ${message}`);
}

export type { JobOutcome };
