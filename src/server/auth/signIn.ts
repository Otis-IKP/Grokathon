import { eq } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { people, users, type Person, type User } from "@/server/db/schema";
import { ensurePerson } from "@/server/people/service";

/**
 * Called after CAS (or dev login) has proven a NetID. Upserts the `people`
 * row from Yalies and the `users` row. People missing from Yalies can still
 * sign in: they get a `self` row and are asked for their name in onboarding.
 */
export async function signInNetid(db: Db, netidRaw: string): Promise<{ user: User; person: Person }> {
  const netid = netidRaw.trim().toLowerCase();
  let person: Person | null = null;
  try {
    person = await ensurePerson(db, netid);
  } catch {
    // Yalies being down must not block sign-in; fall through to a self row.
    const [existing] = await db.select().from(people).where(eq(people.netid, netid));
    person = existing ?? null;
  }
  if (!person) {
    [person] = await db
      .insert(people)
      .values({ netid, firstName: netid, lastName: "", directorySource: "self" })
      .onConflictDoNothing()
      .returning();
    if (!person) [person] = await db.select().from(people).where(eq(people.netid, netid));
  }
  const [user] = await db
    .insert(users)
    .values({ netid, lastSeenAt: new Date() })
    .onConflictDoUpdate({ target: users.netid, set: { lastSeenAt: new Date() } })
    .returning();
  return { user, person };
}
