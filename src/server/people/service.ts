import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import type { Db } from "@/server/db/client";
import { people, users, type Person } from "@/server/db/schema";
import { visiblePerson, type Viewer } from "@/server/privacy/visibility";
import { yaliesLookup, yaliesPeople } from "@/server/yalies/client";
import type { YaliesPerson } from "@/server/yalies/types";

/** The only shape in which a person leaves the API (section 9.1). */
export type PersonCard = {
  netid: string;
  name: string;
  first_name: string;
  college: string | null;
  year: number | null;
  image_url: string | null;
  is_user: boolean;
};

const DIRECTORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function displayFirstName(p: Pick<Person, "firstName" | "preferredName">): string {
  return (p.preferredName?.trim() || p.firstName).trim();
}

export function displayName(p: Pick<Person, "firstName" | "preferredName" | "lastName">): string {
  return `${displayFirstName(p)} ${p.lastName}`.trim();
}

export function toPersonCard(p: Person, isUser: boolean): PersonCard {
  return {
    netid: p.netid,
    name: displayName(p),
    first_name: displayFirstName(p),
    college: p.college,
    year: p.year,
    image_url: p.imageUrl,
    is_user: isUser,
  };
}

/** Columns for building PersonCards in joins: `...personCardColumns` then `rowToCard`. */
export async function getPeople(db: Db, netids: string[]): Promise<Map<string, { person: Person; isUser: boolean }>> {
  const out = new Map<string, { person: Person; isUser: boolean }>();
  const unique = [...new Set(netids)];
  if (unique.length === 0) return out;
  const rows = await db
    .select({ person: people, userId: users.id })
    .from(people)
    .leftJoin(users, eq(users.netid, people.netid))
    .where(inArray(people.netid, unique));
  for (const r of rows) out.set(r.person.netid, { person: r.person, isUser: r.userId !== null });
  return out;
}

export async function getPersonCards(db: Db, netids: string[]): Promise<Map<string, PersonCard>> {
  const found = await getPeople(db, netids);
  const out = new Map<string, PersonCard>();
  for (const [netid, v] of found) out.set(netid, toPersonCard(v.person, v.isUser));
  return out;
}

function directoryValues(y: YaliesPerson) {
  return {
    upi: y.upi,
    firstName: y.first_name ?? y.preferred_name ?? y.netid,
    // preferred_name is only kept when it differs, so search_name stays meaningful.
    preferredName: y.preferred_name && y.preferred_name !== y.first_name ? y.preferred_name : null,
    lastName: y.last_name ?? "",
    email: y.email,
    schoolCode: y.school_code,
    school: y.school,
    college: y.college,
    year: y.year,
    major: y.major,
    imageUrl: y.image,
    directorySyncedAt: new Date(),
  };
}

/** Cache a Yalies record into `people`. Never overwrites a user-edited preferred name or visibility. */
export async function upsertFromDirectory(db: Db, y: YaliesPerson): Promise<Person> {
  const values = directoryValues(y);
  const [row] = await db
    .insert(people)
    .values({ netid: y.netid, ...values, directorySource: "yalies" })
    .onConflictDoUpdate({
      target: people.netid,
      set: {
        upi: values.upi,
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        schoolCode: values.schoolCode,
        school: values.school,
        college: values.college,
        year: values.year,
        major: values.major,
        imageUrl: values.imageUrl,
        directorySyncedAt: values.directorySyncedAt,
        directorySource: sql`case when ${people.directorySource} = 'demo' then 'demo' else 'yalies' end`,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

/**
 * Find a person by NetID: Postgres first, Yalies when missing or stale.
 * Returns null when the directory does not know them.
 */
export async function ensurePerson(db: Db, netidRaw: string): Promise<Person | null> {
  const netid = netidRaw.trim().toLowerCase();
  if (!netid) return null;
  const [existing] = await db.select().from(people).where(eq(people.netid, netid));
  const stale =
    existing &&
    existing.directorySource === "yalies" &&
    (!existing.directorySyncedAt || Date.now() - existing.directorySyncedAt.getTime() > DIRECTORY_TTL_MS);
  if (existing && !stale) return existing;
  if (existing?.directorySource === "demo") return existing;
  try {
    const fromDirectory = await yaliesLookup(netid);
    if (fromDirectory) return upsertFromDirectory(db, fromDirectory);
  } catch (err) {
    // A stale cached row is still usable when Yalies is down; a missing one is an error.
    if (existing) return existing;
    throw err;
  }
  return existing ?? null;
}

export async function requireVisiblePerson(db: Db, netid: string, viewer: Viewer): Promise<Person> {
  const person = await ensurePerson(db, netid);
  if (!person || person.visibility !== "listed" || (person.isDemo && !viewer.isDemo)) {
    throw new AppError("person_not_found", "No one with that NetID is in the directory.");
  }
  return person;
}

/**
 * Directory search (section 9.2): trigram search on `people`; when that finds
 * fewer than 8 and the query has 3+ characters, also ask Yalies and merge.
 */
export async function searchDirectory(db: Db, viewer: Viewer, qRaw: string, limit = 20): Promise<PersonCard[]> {
  const q = qRaw.trim().toLowerCase().replace(/\s+/g, " ");
  if (q.length < 2) return [];

  const local = async () => {
    const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
    return db
      .select({ person: people, userId: users.id, score: sql<number>`similarity(${people.searchName}, ${q})` })
      .from(people)
      .leftJoin(users, eq(users.netid, people.netid))
      .where(
        and(
          visiblePerson(viewer),
          ne(people.netid, viewer.netid),
          sql`(${people.searchName} ilike ${like} or similarity(${people.searchName}, ${q}) > 0.35 or ${people.netid} = ${q})`,
        ),
      )
      .orderBy(desc(sql`similarity(${people.searchName}, ${q})`), people.lastName)
      .limit(limit);
  };

  let rows = await local();
  if (rows.length < 8 && q.length >= 3) {
    const remote = await yaliesPeople({ query: q, page: 0, page_size: 25 });
    if (remote.length > 0) {
      for (const y of remote) await upsertFromDirectory(db, y);
      rows = await local();
    }
  }
  return rows.map((r) => toPersonCard(r.person, r.userId !== null));
}
