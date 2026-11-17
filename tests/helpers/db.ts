import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { setDb, type Db } from "@/server/db/client";
import * as schema from "@/server/db/schema";

/** A fresh in-memory Postgres with the real migrations applied. */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite({ extensions: { citext, pg_trgm, pgcrypto } });
  const pgliteDb = drizzle(client, { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  const db = pgliteDb as unknown as Db;
  setDb(db);
  return {
    db,
    close: async () => {
      setDb(undefined);
      await client.close();
    },
  };
}
