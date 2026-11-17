import { closeDb, embeddedDbOwner, getDb } from "@/server/db/client";
import { isTaskName, tasks, type TaskName } from "@/server/tasks";

/**
 * Run a maintenance task. Normally it runs right here against DATABASE_URL.
 * With the embedded database (pglite://) only one process can have it open,
 * so when `pnpm dev` is running the task is sent to the dev server instead.
 */
export async function runTask(name: TaskName, args: Record<string, unknown> = {}): Promise<void> {
  if (!isTaskName(name)) throw new Error(`Unknown task ${name}`);
  const owner = embeddedDbOwner();
  if (owner) {
    const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
    console.log(`The embedded database is open in the dev server (pid ${owner}); running "${name}" through ${appUrl}.`);
    const res = await fetch(`${appUrl}/api/internal/dev/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
      body: JSON.stringify({ task: name, args }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Dev server refused the task (${res.status}): ${body}`);
    console.log(body);
    return;
  }
  const result = await tasks[name](getDb(), args);
  console.log(JSON.stringify(result));
  await closeDb();
}

export function main(fn: () => Promise<void>) {
  fn()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
