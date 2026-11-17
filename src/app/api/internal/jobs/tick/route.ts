import { cronRoute } from "@/server/api/route";
import { drainJobs } from "@/server/jobs/run";

export const maxDuration = 300;

/** Drains up to 5 jobs. Trigger from a cron every minute with `Authorization: Bearer {CRON_SECRET}`. */
export const POST = cronRoute(async ({ db }) => drainJobs(db, 5));

/** Vercel Cron calls with GET and the same bearer secret. */
export const GET = cronRoute(async ({ db }) => drainJobs(db, 5));
