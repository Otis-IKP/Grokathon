import { eq } from "drizzle-orm";
import { addAliases, slugify } from "@/server/clubs/aliases";
import type { Db } from "@/server/db/client";
import { clubs, friendships, people, users, type Club, type Person, type User } from "@/server/db/schema";
import { upsertMembership, type Evidence, type MembershipSource } from "@/server/memberships/service";
import type { CurrentUser } from "@/server/auth/guards";

let counter = 0;

export async function makePerson(
  db: Db,
  netid: string,
  opts: Partial<typeof people.$inferInsert> = {},
): Promise<Person> {
  const [first, last] = [opts.firstName ?? netid.charAt(0).toUpperCase() + netid.slice(1), opts.lastName ?? "Test"];
  const [row] = await db
    .insert(people)
    .values({ netid, firstName: first, lastName: last, college: "Berkeley", year: 2028, ...opts })
    .returning();
  return row;
}

/** A person who has signed in. */
export async function makeUser(
  db: Db,
  netid: string,
  opts: { person?: Partial<typeof people.$inferInsert>; user?: Partial<typeof users.$inferInsert> } = {},
): Promise<{ person: Person; user: User }> {
  const person = await makePerson(db, netid, opts.person);
  const [user] = await db
    .insert(users)
    .values({ netid, onboardingDoneAt: new Date(), ...opts.user })
    .returning();
  return { person, user };
}

export async function makeClub(db: Db, name: string, shortName?: string, opts: Partial<typeof clubs.$inferInsert> = {}): Promise<Club> {
  const [club] = await db
    .insert(clubs)
    .values({ slug: slugify(shortName ?? name) + (opts.slug ? "" : `-${++counter}`), name, shortName: shortName ?? null, ...opts })
    .returning();
  await addAliases(db, club.id, [name, ...(shortName ? [shortName] : [])]);
  return club;
}

export async function makeMember(
  db: Db,
  netid: string,
  clubId: string,
  opts: {
    role?: "member" | "board" | "alum";
    title?: string | null;
    status?: "claimed" | "verified" | "likely" | "unverified";
    source?: MembershipSource;
    evidence?: Evidence[];
    isCurrent?: boolean;
  } = {},
) {
  const status = opts.status ?? "verified";
  const row = await upsertMembership(db, {
    netid,
    clubId,
    role: opts.role ?? "member",
    title: opts.title ?? null,
    status,
    isCurrent: opts.isCurrent,
    source: opts.source ?? (status === "claimed" ? "self_report" : "seed"),
    evidence:
      opts.evidence ??
      (status === "claimed" ? [] : [{ url: `https://club.example/${clubId}/team`, quote: "listed", source_type: "club_site" }]),
  });
  return row!;
}

export async function makeFriends(db: Db, requester: string, addressee: string, status: "accepted" | "pending" = "accepted") {
  const [row] = await db
    .insert(friendships)
    .values({ requesterNetid: requester, addresseeNetid: addressee, status, respondedAt: status === "accepted" ? new Date() : null })
    .returning();
  return row;
}

export async function currentUser(db: Db, netid: string): Promise<CurrentUser> {
  const [user] = await db.select().from(users).where(eq(users.netid, netid));
  const [person] = await db.select().from(people).where(eq(people.netid, netid));
  return { user, person, viewer: { netid, isDemo: person.isDemo }, isAdmin: false };
}
