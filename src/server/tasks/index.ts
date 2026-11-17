import { crawlAllClubs } from "@/server/admin/service";
import { migrateDb, type Db } from "@/server/db/client";
import { syncDirectory } from "@/server/yalies/sync";
import { purgeDemo, seed } from "./seed";

/**
 * Maintenance tasks behind the pnpm scripts. They live here, not in scripts/,
 * so the dev server can run them too: with the embedded database only one
 * process can have it open, so while `pnpm dev` is running the scripts ask
 * the dev server to run the task (POST /api/internal/dev/task).
 */
export const tasks = {
  migrate: async () => {
    await migrateDb();
    return { migrated: true };
  },
  seed: (db: Db) => seed(db),
  "seed-purge": (db: Db) => purgeDemo(db),
  "sync-directory": (db: Db) => syncDirectory(db, { log: (m) => console.log(`[sync] ${m}`) }),
  "crawl-clubs": (db: Db, args?: { force?: boolean }) => crawlAllClubs(db, Boolean(args?.force)),
} satisfies Record<string, (db: Db, args?: { force?: boolean }) => Promise<unknown>>;

export type TaskName = keyof typeof tasks;

export function isTaskName(name: string): name is TaskName {
  return name in tasks;
}
