import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { people, users } from "@/server/db/schema";
import { env } from "@/server/env";

/**
 * Demo sign-in: a way into a deployed NEPO without Yale CAS, for showing the
 * app. It exists only while DEMO_LOGIN_CODE is set, needs that code, and can
 * only ever sign in as a seeded demo account (`people.is_demo`), never as a
 * real NetID. Real accounts stay behind CAS.
 */
export function demoLoginCode(): string | null {
  return env().DEMO_LOGIN_CODE ?? null;
}

export type DemoAccount = { netid: string; name: string };

/** The seeded demo people who have an account, for the picker on the sign-in page. */
export async function listDemoAccounts(db: Db): Promise<DemoAccount[]> {
  const rows = await db
    .select({ netid: people.netid, first: people.firstName, last: people.lastName })
    .from(users)
    .innerJoin(people, eq(people.netid, users.netid))
    .where(eq(people.isDemo, true))
    .orderBy(asc(people.firstName));
  return rows.map((r) => ({ netid: r.netid, name: `${r.first} ${r.last}`.trim() }));
}

export async function isDemoAccount(db: Db, netid: string): Promise<boolean> {
  const [row] = await db
    .select({ netid: users.netid })
    .from(users)
    .innerJoin(people, eq(people.netid, users.netid))
    .where(and(eq(users.netid, netid), eq(people.isDemo, true)));
  return Boolean(row);
}
