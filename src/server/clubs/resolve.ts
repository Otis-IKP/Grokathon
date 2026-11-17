import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { clubAliases, clubs, type Club } from "@/server/db/schema";
import { normalizeClubName } from "./aliases";

export type ClubCard = { id: string; slug: string; name: string; short_name: string | null; category: string | null };

export function toClubCard(c: Pick<Club, "id" | "slug" | "name" | "shortName" | "category">): ClubCard {
  return { id: c.id, slug: c.slug, name: c.name, short_name: c.shortName, category: c.category };
}

export type ResolveResult = { club: Club | null; candidates: Club[]; confidence: number };

const MIN_SIMILARITY = 0.6;
const MIN_LEAD = 0.15;

/**
 * Map free text ("ysig", "the Dramat", "Yale Student Investment Grp") to a club.
 * Exact alias match → confidence 1. Otherwise the best trigram match when it
 * is at least 0.6 and at least 0.15 ahead of the runner-up club. Otherwise up
 * to 3 candidates and `club: null`, so the caller can ask "Did you mean…?".
 */
export async function resolveClub(db: Db, text: string): Promise<ResolveResult> {
  const norm = normalizeClubName(text);
  if (!norm) return { club: null, candidates: [], confidence: 0 };

  const [exact] = await db
    .select({ club: clubs })
    .from(clubAliases)
    .innerJoin(clubs, eq(clubs.id, clubAliases.clubId))
    .where(and(eq(clubAliases.aliasNorm, norm), ne(clubs.status, "hidden")));
  if (exact) return { club: exact.club, candidates: [exact.club], confidence: 1 };

  // Best alias per club, ranked by similarity.
  const sim = sql<number>`max(similarity(${clubAliases.aliasNorm}, ${norm}))`;
  const ranked = await db
    .select({ clubId: clubAliases.clubId, sim })
    .from(clubAliases)
    .innerJoin(clubs, eq(clubs.id, clubAliases.clubId))
    .where(ne(clubs.status, "hidden"))
    .groupBy(clubAliases.clubId)
    .having(sql`max(similarity(${clubAliases.aliasNorm}, ${norm})) > 0.2`)
    .orderBy(desc(sim))
    .limit(3);
  if (ranked.length === 0) return { club: null, candidates: [], confidence: 0 };

  const rows = await db
    .select()
    .from(clubs)
    .where(
      inArray(
        clubs.id,
        ranked.map((r) => r.clubId),
      ),
    );
  const byId = new Map(rows.map((c) => [c.id, c]));
  const candidates = ranked.map((r) => byId.get(r.clubId)!).filter(Boolean);
  const best = Number(ranked[0].sim);
  const runnerUp = ranked[1] ? Number(ranked[1].sim) : 0;
  if (best >= MIN_SIMILARITY && best - runnerUp >= MIN_LEAD) {
    return { club: candidates[0], candidates, confidence: best };
  }
  return { club: null, candidates, confidence: best };
}
