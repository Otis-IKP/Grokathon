import { and, eq, gt, gte, lt, sql } from "drizzle-orm";
import { execRows, type Db } from "@/server/db/client";
import { jobs, type Job } from "@/server/db/schema";
import { env } from "@/server/env";

export type JobType = "linkedin_read" | "linkedin_pdf" | "validate_membership" | "crawl_roster" | "research_person";

export type JobPayloads = {
  linkedin_read: { user_id: string; url: string };
  linkedin_pdf: { user_id: string; text?: string };
  validate_membership: { membership_id: string };
  crawl_roster: { club_id: string };
  research_person: { netid: string };
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
/**
 * A running job is presumed dead after this long. It must stay above the
 * longest a live handler can take (AGENT_DEADLINE_MS in claude/runAgent.ts),
 * or a healthy job would be handed to a second runner.
 */
const STUCK_AFTER_MS = 20 * 60 * 1000;
/** A failed crawl or research job can be queued again after this long, not after the full TTL. */
const FAILED_COOLOFF_MS = 60 * 60 * 1000;

/** How long a finished job blocks a new one with the same dedupe key. */
function dedupeTtlMs(type: JobType): number {
  if (type === "crawl_roster") return env().ENRICH_CLUB_TTL_DAYS * DAY_MS;
  if (type === "research_person") return env().ENRICH_PERSON_TTL_DAYS * DAY_MS;
  return 0;
}

export function dedupeKeyFor<T extends JobType>(type: T, payload: JobPayloads[T]): string | null {
  switch (type) {
    case "crawl_roster":
      return `crawl_roster:${(payload as JobPayloads["crawl_roster"]).club_id}`;
    case "research_person":
      return `research_person:${(payload as JobPayloads["research_person"]).netid}`;
    case "validate_membership":
      return `validate_membership:${(payload as JobPayloads["validate_membership"]).membership_id}`;
    case "linkedin_read":
      return `linkedin_read:${(payload as JobPayloads["linkedin_read"]).user_id}`;
    default:
      return null;
  }
}

type RawJob = {
  id: string;
  type: string;
  payload: unknown;
  dedupe_key: string | null;
  status: string;
  attempts: number;
};

/**
 * Queue a job. With a dedupe key: a queued or running job with that key makes
 * this a no-op; a finished one is replaced only once its TTL has passed
 * (`force` skips the TTL, for admin retries and explicit user re-runs).
 */
export async function enqueue<T extends JobType>(
  db: Db,
  type: T,
  payload: JobPayloads[T],
  opts: { dedupeKey?: string | null; runAfter?: Date; force?: boolean } = {},
): Promise<{ job: Job | null; enqueued: boolean }> {
  const dedupeKey = opts.dedupeKey === undefined ? dedupeKeyFor(type, payload) : opts.dedupeKey;
  const runAfter = opts.runAfter ?? new Date();
  if (!dedupeKey) {
    const [job] = await db.insert(jobs).values({ type, payload, runAfter }).returning();
    return { job, enqueued: true };
  }
  const [existing] = await db.select().from(jobs).where(eq(jobs.dedupeKey, dedupeKey));
  if (existing) {
    if (existing.status === "queued" || existing.status === "running") return { job: existing, enqueued: false };
    const finishedAt = existing.finishedAt?.getTime() ?? 0;
    // The TTL spaces out successful runs. A failed one found nothing, so it only waits out a short cool-off.
    const wait = existing.status === "failed" ? Math.min(FAILED_COOLOFF_MS, dedupeTtlMs(type)) : dedupeTtlMs(type);
    if (!opts.force && Date.now() - finishedAt < wait) return { job: existing, enqueued: false };
    const [job] = await db
      .update(jobs)
      .set({
        type,
        payload,
        status: "queued",
        attempts: 0,
        runAfter,
        lockedAt: null,
        finishedAt: null,
        error: null,
        result: null,
      })
      .where(eq(jobs.id, existing.id))
      .returning();
    return { job, enqueued: true };
  }
  const [job] = await db
    .insert(jobs)
    .values({ type, payload, dedupeKey, runAfter })
    .onConflictDoNothing({ target: jobs.dedupeKey })
    .returning();
  return { job: job ?? null, enqueued: Boolean(job) };
}

/** Jobs started in the last hour, for the global ENRICH_MAX_JOBS_PER_HOUR budget. */
export async function jobsStartedLastHour(db: Db): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(gt(jobs.lockedAt, since));
  return row?.n ?? 0;
}

/** Atomically claim the next ready job, or null when none is ready or the hourly budget is spent. */
export async function claimNext(db: Db): Promise<Job | null> {
  if ((await jobsStartedLastHour(db)) >= env().ENRICH_MAX_JOBS_PER_HOUR) return null;
  const rows = await execRows<RawJob>(
    db,
    sql`update jobs set status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
        where id = (
          select id from jobs
          where status = 'queued' and run_after <= now()
          order by run_after
          for update skip locked
          limit 1
        )
        returning id`,
  );
  if (rows.length === 0) return null;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, rows[0].id));
  return job ?? null;
}

export async function completeJob(db: Db, id: string, result: unknown, payload?: unknown): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: "done",
      finishedAt: new Date(),
      error: null,
      result: (result ?? {}) as object,
      ...(payload !== undefined ? { payload: payload as object } : {}),
    })
    .where(eq(jobs.id, id));
}

/** Retry with backoff (attempts × 60 s) up to 3 attempts, then fail with the error text. */
export async function failJob(db: Db, job: Job, error: string, payload?: unknown): Promise<"queued" | "failed"> {
  const scrub = payload !== undefined ? { payload: payload as object } : {};
  if (job.attempts < MAX_ATTEMPTS) {
    await db
      .update(jobs)
      .set({
        status: "queued",
        runAfter: new Date(Date.now() + job.attempts * 60_000),
        // locked_at is kept: it is when the attempt started, which the hourly budget counts.
        error: error.slice(0, 2000),
      })
      .where(eq(jobs.id, job.id));
    return "queued";
  }
  await db
    .update(jobs)
    .set({ status: "failed", finishedAt: new Date(), error: error.slice(0, 2000), ...scrub })
    .where(eq(jobs.id, job.id));
  return "failed";
}

/**
 * Jobs whose runner died mid-flight (still `running` long after they were
 * claimed). They go back to the queue while attempts remain; a job that has
 * used all its attempts is failed instead, so nothing is retried forever.
 */
export async function recoverStuck(db: Db): Promise<{ requeued: number; failed: Job[] }> {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS);
  const stuck = and(eq(jobs.status, "running"), lt(jobs.lockedAt, cutoff));
  const failed = await db
    .update(jobs)
    .set({ status: "failed", finishedAt: new Date(), error: "Stopped responding and ran out of attempts." })
    .where(and(stuck, gte(jobs.attempts, MAX_ATTEMPTS)))
    .returning();
  const requeued = await db
    .update(jobs)
    .set({ status: "queued", runAfter: new Date() })
    .where(and(stuck, lt(jobs.attempts, MAX_ATTEMPTS)))
    .returning({ id: jobs.id });
  return { requeued: requeued.length, failed };
}

/** Number of stuck jobs put back in the queue. */
export async function requeueStuck(db: Db): Promise<number> {
  return (await recoverStuck(db)).requeued;
}
