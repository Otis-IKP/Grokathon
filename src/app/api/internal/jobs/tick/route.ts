import { cronRoute } from "@/server/api/route";
import { sweepEphemeral } from "@/server/bot/state";
import type { Db } from "@/server/db/client";
import { drainJobs } from "@/server/jobs/run";

export const maxDuration = 300;

/** Drains up to 5 jobs. Trigger from a cron every minute with `Authorization: Bearer {CRON_SECRET}`. */
export const POST = cronRoute(async ({ db }) => tick(db));

/** Vercel Cron calls with GET and the same bearer secret. */
export const GET = cronRoute(async ({ db }) => tick(db));

/** Jobs first, then housekeeping for expired bot state, webhook claims and rate-limit counters. */
async function tick(db: Db) {
  const stats = await drainJobs(db, 5);
  await sweepEphemeral(db);
  return stats;
}
