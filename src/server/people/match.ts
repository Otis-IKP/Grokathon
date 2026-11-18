import { and, eq, sql } from "drizzle-orm";
import { lastToken, pickRosterMatch, type RosterMatch } from "@/lib/names";
import type { Db } from "@/server/db/client";
import { people } from "@/server/db/schema";

/**
 * Match a name found on a public roster to a directory person (section 7.6).
 * Hidden people are never candidates, so nothing is attached to someone who
 * opted out. Demo people are never matched against real rosters.
 */
export async function matchRosterName(
  db: Db,
  roster: { fullName: string; classYear?: number | null; college?: string | null },
): Promise<RosterMatch> {
  const last = lastToken(roster.fullName);
  if (!last) return { kind: "none" };
  const candidates = await db
    .select({
      netid: people.netid,
      firstName: people.firstName,
      preferredName: people.preferredName,
      lastName: people.lastName,
      year: people.year,
      college: people.college,
    })
    .from(people)
    .where(
      and(
        eq(people.visibility, "listed"),
        eq(people.isDemo, false),
        // Last token of the last name, so "van der Berg" and "García-López" still pre-filter.
        sql`(lower(${people.lastName}) = ${last} or lower(${people.lastName}) like ${"%" + last} or lower(${people.lastName}) like ${"%" + last.slice(0, 3) + "%"})`,
      ),
    )
    // Exact last-name matches first, so the cap never drops the likeliest candidates.
    .orderBy(sql`case when lower(${people.lastName}) = ${last} then 0 else 1 end`, people.netid)
    .limit(500);
  return pickRosterMatch(roster, candidates);
}
