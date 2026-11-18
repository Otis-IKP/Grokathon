import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { toClubCard } from "@/server/clubs/resolve";
import { CLUB_CATEGORIES } from "@/server/clubs/service";
import type { Db } from "@/server/db/client";
import { agentRuns, clubs, jobs, people, unmatchedRosterNames } from "@/server/db/schema";
import { enqueue } from "@/server/jobs/queue";
import { upsertMembership } from "@/server/memberships/service";
import { classifySource } from "@/server/claude/evidence";

export async function listJobs(db: Db, opts: { status?: string; limit?: number } = {}) {
  const counts = await db.select({ status: jobs.status, n: sql<number>`count(*)::int` }).from(jobs).groupBy(jobs.status);
  const rows = await db
    .select()
    .from(jobs)
    .where(opts.status ? eq(jobs.status, opts.status) : undefined)
    .orderBy(desc(jobs.updatedAt))
    .limit(opts.limit ?? 50);
  return {
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number>,
    jobs: rows.map((j) => ({
      id: j.id,
      type: j.type,
      status: j.status,
      attempts: j.attempts,
      // Payloads can hold uploaded text while a job is in flight; admins see keys only.
      payload_keys: Object.keys((j.payload ?? {}) as object),
      dedupe_key: j.dedupeKey,
      error: j.error,
      result: j.result,
      run_after: j.runAfter.toISOString(),
      finished_at: j.finishedAt?.toISOString() ?? null,
      created_at: j.createdAt.toISOString(),
    })),
  };
}

export async function retryJob(db: Db, id: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (!job) throw new AppError("job_not_found", "That job does not exist.");
  if (job.status === "running") throw new AppError("invalid_state", "That job is running.");
  await db
    .update(jobs)
    .set({ status: "queued", attempts: 0, runAfter: new Date(), lockedAt: null, finishedAt: null, error: null })
    .where(eq(jobs.id, id));
  return { ok: true };
}

export async function listAgentRuns(db: Db, jobId?: string) {
  const rows = await db
    .select()
    .from(agentRuns)
    .where(jobId ? eq(agentRuns.jobId, jobId) : undefined)
    .orderBy(desc(agentRuns.createdAt))
    .limit(50);
  return rows.map((r) => ({
    id: r.id,
    job_id: r.jobId,
    agent: r.agent,
    model: r.model,
    input: r.input,
    output: r.output,
    citations: r.citations,
    duration_ms: r.durationMs,
    error: r.error,
    created_at: r.createdAt.toISOString(),
  }));
}

export async function crawlClub(db: Db, clubId: string) {
  const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId));
  if (!club) throw new AppError("club_not_found", "That club does not exist.");
  const { enqueued } = await enqueue(db, "crawl_roster", { club_id: club.id }, { force: true });
  return { enqueued };
}

/** Queue a roster crawl for every active club. Respects the per-club TTL unless forced. */
export async function crawlAllClubs(db: Db, force = false) {
  const rows = await db.select({ id: clubs.id }).from(clubs).where(ne(clubs.status, "hidden"));
  let enqueued = 0;
  for (const c of rows) {
    const res = await enqueue(db, "crawl_roster", { club_id: c.id }, { force });
    if (res.enqueued) enqueued++;
  }
  return { clubs: rows.length, enqueued };
}

export async function updateClub(
  db: Db,
  id: string,
  patch: {
    name?: string;
    short_name?: string | null;
    category?: string;
    website?: string | null;
    description?: string | null;
    status?: "active" | "unreviewed" | "hidden";
  },
) {
  if (patch.category && !(CLUB_CATEGORIES as readonly string[]).includes(patch.category)) {
    throw new AppError("invalid_request", "Unknown category.");
  }
  const [club] = await db
    .update(clubs)
    .set({
      ...(patch.name ? { name: patch.name.trim() } : {}),
      ...(patch.short_name !== undefined ? { shortName: patch.short_name?.trim() || null } : {}),
      ...(patch.category ? { category: patch.category } : {}),
      ...(patch.website !== undefined ? { website: patch.website?.trim() || null } : {}),
      ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
      ...(patch.status ? { status: patch.status } : {}),
    })
    .where(eq(clubs.id, id))
    .returning();
  if (!club) throw new AppError("club_not_found", "That club does not exist.");
  return { ...toClubCard(club), status: club.status };
}

export async function listUnreviewedClubs(db: Db) {
  const rows = await db.select().from(clubs).where(eq(clubs.status, "unreviewed")).orderBy(desc(clubs.createdAt)).limit(100);
  return rows.map((c) => ({ ...toClubCard(c), status: c.status, website: c.website }));
}

export async function listUnmatchedNames(db: Db) {
  const rows = await db
    .select({ u: unmatchedRosterNames, club: clubs })
    .from(unmatchedRosterNames)
    .innerJoin(clubs, eq(clubs.id, unmatchedRosterNames.clubId))
    .where(isNull(unmatchedRosterNames.resolvedNetid))
    .orderBy(desc(unmatchedRosterNames.createdAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.u.id,
    full_name: r.u.fullName,
    role_title: r.u.roleTitle,
    source_url: r.u.sourceUrl,
    club: toClubCard(r.club),
  }));
}

/** An admin picks the directory person a roster name refers to; `netid: null` dismisses the name. */
export async function resolveRosterName(db: Db, id: string, netid: string | null) {
  const [row] = await db
    .select({ u: unmatchedRosterNames, club: clubs })
    .from(unmatchedRosterNames)
    .innerJoin(clubs, eq(clubs.id, unmatchedRosterNames.clubId))
    .where(eq(unmatchedRosterNames.id, id));
  if (!row) throw new AppError("not_found", "That roster name does not exist.");
  if (!netid) {
    await db.delete(unmatchedRosterNames).where(eq(unmatchedRosterNames.id, id));
    return { resolved: false };
  }
  const [person] = await db
    .select()
    .from(people)
    .where(and(eq(people.netid, netid.toLowerCase()), eq(people.visibility, "listed")));
  if (!person) throw new AppError("person_not_found", "No listed person with that NetID.");
  if (row.u.sourceUrl) {
    await upsertMembership(db, {
      netid: person.netid,
      clubId: row.club.id,
      role: /president|chair|director|editor|captain|board|treasurer|secretary/i.test(row.u.roleTitle ?? "")
        ? "board"
        : "member",
      title: row.u.roleTitle,
      status: "verified",
      source: "public_roster",
      evidence: [
        {
          url: row.u.sourceUrl,
          quote: `${row.u.fullName}${row.u.roleTitle ? `, ${row.u.roleTitle}` : ""}`,
          source_type: classifySource(row.u.sourceUrl, row.club.website),
        },
      ],
    });
  }
  await db.update(unmatchedRosterNames).set({ resolvedNetid: person.netid }).where(eq(unmatchedRosterNames.id, id));
  return { resolved: true };
}
