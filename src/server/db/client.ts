import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { sql, type SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * The db handle every service takes. It is driver-agnostic so the same code
 * runs on postgres-js (real Postgres) and on in-process PGlite (local dev, tests).
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

type Holder = {
  db?: Db;
  kind?: "pglite" | "postgres";
  close?: () => Promise<void>;
  lockFile?: string;
};
const globalForDb = globalThis as unknown as { __nepoDb?: Holder };
const holder: Holder = (globalForDb.__nepoDb ??= {});

const PGLITE_PREFIX = "pglite://";

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  return url;
}

export function isEmbeddedDb(): boolean {
  return (process.env.DATABASE_URL ?? "").startsWith(PGLITE_PREFIX);
}

function embeddedDir(): string | null {
  const rest = databaseUrl().slice(PGLITE_PREFIX.length);
  if (rest === "memory" || rest === "") return null;
  return path.resolve(rest);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The embedded database can be open in one process only. Returns the pid of
 * another live process that holds it (normally `pnpm dev`), or null.
 */
export function embeddedDbOwner(): number | null {
  if (!isEmbeddedDb()) return null;
  const dir = embeddedDir();
  if (!dir) return null;
  try {
    const pid = Number(fs.readFileSync(`${dir}.lock`, "utf8").trim());
    if (pid && pid !== process.pid && pidAlive(pid)) return pid;
  } catch {
    // no lock file
  }
  return null;
}

function openEmbedded(): void {
  const dir = embeddedDir();
  if (dir) {
    const owner = embeddedDbOwner();
    if (owner) {
      throw new Error(
        `The embedded database at ${dir} is in use by process ${owner} (probably \`pnpm dev\`). ` +
          `Run this through the dev server or stop it first.`,
      );
    }
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    const lockFile = `${dir}.lock`;
    fs.writeFileSync(lockFile, String(process.pid));
    holder.lockFile = lockFile;
    const release = () => {
      try {
        if (fs.readFileSync(lockFile, "utf8").trim() === String(process.pid)) fs.unlinkSync(lockFile);
      } catch {
        // already gone
      }
    };
    process.once("exit", release);
    for (const sig of ["SIGINT", "SIGTERM"] as const) {
      process.once(sig, () => {
        release();
        process.exit(0);
      });
    }
  }
  const client = dir
    ? new PGlite(dir, { extensions: { citext, pg_trgm, pgcrypto } })
    : new PGlite({ extensions: { citext, pg_trgm, pgcrypto } });
  holder.kind = "pglite";
  holder.db = drizzlePglite(client, { schema }) as unknown as Db;
  holder.close = async () => {
    await client.close();
  };
}

function openPostgres(): void {
  const client = postgres(databaseUrl(), {
    max: Number(process.env.DB_POOL_MAX ?? 5) || 5,
    prepare: false,
    connect_timeout: 10,
    onnotice: () => {},
  });
  holder.kind = "postgres";
  holder.db = drizzlePostgres(client, { schema }) as unknown as Db;
  holder.close = async () => {
    await client.end({ timeout: 5 });
  };
}

export function getDb(): Db {
  if (holder.db) return holder.db;
  if (isEmbeddedDb()) openEmbedded();
  else openPostgres();
  return holder.db!;
}

/** Tests inject an in-memory PGlite database here. */
export function setDb(db: Db | undefined) {
  holder.db = db;
  holder.kind = db ? "pglite" : undefined;
  holder.close = undefined;
}

export async function closeDb() {
  await holder.close?.();
  if (holder.lockFile) {
    try {
      fs.unlinkSync(holder.lockFile);
    } catch {
      // already gone
    }
  }
  holder.db = undefined;
  holder.kind = undefined;
  holder.close = undefined;
  holder.lockFile = undefined;
}

export async function migrateDb(migrationsFolder = "./drizzle") {
  const db = getDb();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  if (holder.kind === "pglite") await migratePglite(db as any, { migrationsFolder });
  else await migratePostgres(db as any, { migrationsFolder });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Run raw SQL and get plain rows back on either driver. */
export async function execRows<T = Record<string, unknown>>(db: Db | Tx, query: SQL): Promise<T[]> {
  const res = (await db.execute(query)) as unknown;
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] }).rows ?? []) as T[];
}

export { schema, sql };
