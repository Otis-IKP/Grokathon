import type { Db } from "@/server/db/client";
import type { Job } from "@/server/db/schema";
import { redactPhones } from "@/server/privacy/redact";
import { claimNext, completeJob, failJob, recoverStuck } from "./queue";

export type JobOutcome = { result: unknown; payload?: unknown };
export type JobHandler = (db: Db, job: Job) => Promise<JobOutcome>;

/** A handler may throw this to fail without retrying (bad input will not get better). */
export class PermanentJobError extends Error {}

async function loadHandlers(): Promise<Record<string, JobHandler>> {
  // Imported lazily: handlers pull in every agent, and the route wrapper imports this file.
  const mod = await import("./handlers");
  return mod.handlers;
}

export async function runJob(db: Db, job: Job): Promise<"done" | "queued" | "failed"> {
  const handlers = await loadHandlers();
  const handler = handlers[job.type];
  if (!handler) {
    await failJob(db, { ...job, attempts: 99 }, `No handler for job type ${job.type}`);
    return "failed";
  }
  try {
    const outcome = await handler(db, job);
    await completeJob(db, job.id, outcome.result, outcome.payload);
    return "done";
  } catch (err) {
    const message = redactPhones(err instanceof Error ? err.message : String(err));
    const permanent = err instanceof PermanentJobError;
    const onFail = (await import("./handlers")).onJobFailed;
    const state = await failJob(db, permanent ? { ...job, attempts: 99 } : job, message);
    if (state === "failed") await onFail(db, job, message);
    return state;
  }
}

/** Claim and run up to `max` ready jobs. Used by the tick route, the worker and post-response kicks. */
export async function drainJobs(db: Db, max = 5): Promise<{ ran: number; done: number; failed: number; requeued: number }> {
  const stats = { ran: 0, done: 0, failed: 0, requeued: 0 };
  const recovered = await recoverStuck(db);
  stats.requeued = recovered.requeued;
  for (const dead of recovered.failed) {
    // Same clean-up as any other final failure (e.g. LinkedIn status leaves "reading").
    stats.failed++;
    await (await import("./handlers")).onJobFailed(db, dead, dead.error ?? "Stopped responding.");
  }
  for (let i = 0; i < max; i++) {
    const job = await claimNext(db);
    if (!job) break;
    stats.ran++;
    const state = await runJob(db, job);
    if (state === "done") stats.done++;
    if (state === "failed") stats.failed++;
  }
  return stats;
}
