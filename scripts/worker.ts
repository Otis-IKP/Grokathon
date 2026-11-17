import { closeDb, embeddedDbOwner, getDb } from "@/server/db/client";
import { drainJobs } from "@/server/jobs/run";

/**
 * Local job worker: loops over the queue with a 1 s idle sleep, 3 at a time.
 * With the embedded database open in `pnpm dev`, it drives the dev server's
 * tick endpoint instead, since only one process can open that database.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

async function viaHttp() {
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  console.log(`Worker driving ${appUrl}/api/internal/jobs/tick (embedded database is open in the dev server).`);
  while (!stopping) {
    try {
      const res = await fetch(`${appUrl}/api/internal/jobs/tick`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
      });
      const body = (await res.json()) as { ran?: number; done?: number; failed?: number };
      if (body.ran) console.log(`ran ${body.ran}: ${body.done} done, ${body.failed} failed`);
      if (!body.ran) await sleep(1000);
    } catch (err) {
      console.error("tick failed:", err instanceof Error ? err.message : err);
      await sleep(3000);
    }
  }
}

async function direct() {
  const db = getDb();
  console.log("Worker started. Ctrl+C to stop.");
  const lane = async () => {
    while (!stopping) {
      const stats = await drainJobs(db, 1);
      if (stats.ran) console.log(`ran ${stats.ran}: ${stats.done} done, ${stats.failed} failed`);
      else await sleep(1000);
    }
  };
  await Promise.all([lane(), lane(), lane()]);
  await closeDb();
}

(embeddedDbOwner() ? viaHttp() : direct()).then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
