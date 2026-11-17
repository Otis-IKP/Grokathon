import { and, asc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import type { Db } from "@/server/db/client";
import { clubAliases, clubs, memberships, people, users, type Club } from "@/server/db/schema";
import { enqueue } from "@/server/jobs/queue";
import { toPersonCard, type PersonCard } from "@/server/people/service";
import { visibleMembership, visiblePerson, type Viewer } from "@/server/privacy/visibility";
import { addAliases, normalizeClubName, slugify } from "./aliases";
import { resolveClub, toClubCard, type ClubCard } from "./resolve";

export const CLUB_CATEGORIES = [
  "finance",
  "consulting",
  "publication",
  "arts",
  "politics",
  "tech",
  "service",
  "sports",
  "cultural",
  "other",
] as const;

export async function getClubById(db: Db, id: string): Promise<Club> {
  const [club] = await db.select().from(clubs).where(eq(clubs.id, id));
  if (!club || club.status === "hidden") throw new AppError("club_not_found", "That club does not exist.");
  return club;
}

export async function getClubBySlug(db: Db, slug: string): Promise<Club> {
  const [club] = await db.select().from(clubs).where(eq(clubs.slug, slug.toLowerCase()));
  if (!club || club.status === "hidden") throw new AppError("club_not_found", "That club does not exist.");
  return club;
}

async function uniqueSlug(db: Db, base: string): Promise<string> {
  let slug = base;
  for (let i = 2; i < 50; i++) {
    const [taken] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.slug, slug));
    if (!taken) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

/**
 * A club name NEPO has not seen before: created as `unreviewed` (searchable,
 * flagged in /admin) with the given name as its first alias, and a roster
 * crawl is queued.
 */
export async function createUnreviewedClub(db: Db, name: string): Promise<Club> {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!normalizeClubName(clean)) throw new AppError("invalid_request", "Club name is empty.");
  const [club] = await db
    .insert(clubs)
    .values({ slug: await uniqueSlug(db, slugify(clean)), name: clean, status: "unreviewed", category: "other" })
    .returning();
  await addAliases(db, club.id, [clean]);
  await enqueue(db, "crawl_roster", { club_id: club.id });
  return club;
}

/** Resolve a name to a club, creating an unreviewed club when nothing matches. */
export async function resolveOrCreateClub(db: Db, name: string): Promise<Club> {
  const resolved = await resolveClub(db, name);
  if (resolved.club) return resolved.club;
  return createUnreviewedClub(db, name);
}

export type ClubListItem = ClubCard & { status: string; member_count: number };

export async function listClubs(
  db: Db,
  viewer: Viewer,
  opts: { q?: string; category?: string; limit?: number } = {},
): Promise<ClubListItem[]> {
  const conditions = [ne(clubs.status, "hidden")];
  if (opts.category) conditions.push(eq(clubs.category, opts.category));
  const q = opts.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
    const norm = normalizeClubName(q);
    const aliasMatch = db
      .select({ id: clubAliases.clubId })
      .from(clubAliases)
      .where(
        or(
          ilike(clubAliases.alias, like),
          norm ? sql`similarity(${clubAliases.aliasNorm}, ${norm}) > 0.35` : sql`false`,
        ),
      );
    conditions.push(or(ilike(clubs.name, like), inArray(clubs.id, aliasMatch))!);
  }
  const rows = await db
    .select()
    .from(clubs)
    .where(and(...conditions))
    .orderBy(asc(clubs.name))
    .limit(opts.limit ?? 200);
  if (rows.length === 0) return [];

  const counts = await db
    .select({ clubId: memberships.clubId, n: sql<number>`count(*)::int` })
    .from(memberships)
    .innerJoin(people, eq(people.netid, memberships.netid))
    .where(
      and(
        inArray(
          memberships.clubId,
          rows.map((c) => c.id),
        ),
        visibleMembership(),
        visiblePerson(viewer),
      ),
    )
    .groupBy(memberships.clubId);
  const countBy = new Map(counts.map((c) => [c.clubId, c.n]));
  return rows.map((c) => ({ ...toClubCard(c), status: c.status, member_count: countBy.get(c.id) ?? 0 }));
}

export type ClubMember = {
  person: PersonCard;
  role: string;
  title: string | null;
  status: string;
  evidence_url: string | null;
};

/** Visible members of a club for this viewer, board first. */
export async function listClubMembers(db: Db, viewer: Viewer, clubId: string): Promise<ClubMember[]> {
  const rows = await db
    .select({
      m: memberships,
      person: people,
      userId: users.id,
      evidenceUrl: sql<string | null>`(select e.url from membership_evidence e where e.membership_id = ${memberships.id} order by e.retrieved_at desc limit 1)`,
    })
    .from(memberships)
    .innerJoin(people, eq(people.netid, memberships.netid))
    .leftJoin(users, eq(users.netid, people.netid))
    .where(and(eq(memberships.clubId, clubId), visibleMembership(), visiblePerson(viewer)));
  const order = { board: 0, member: 1, alum: 2 } as Record<string, number>;
  return rows
    .map((r) => ({
      person: toPersonCard(r.person, r.userId !== null),
      role: r.m.role,
      title: r.m.title,
      status: r.m.status,
      evidence_url: r.evidenceUrl,
    }))
    .sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9) || a.person.name.localeCompare(b.person.name));
}

export function clubDetailCard(club: Club) {
  return {
    ...toClubCard(club),
    website: club.website,
    description: club.description,
    status: club.status,
    roster_url: club.rosterUrl,
    roster_crawled_at: club.rosterCrawledAt?.toISOString() ?? null,
  };
}
