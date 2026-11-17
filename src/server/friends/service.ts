import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import type { Db } from "@/server/db/client";
import { friendships, memberships, people, users, type Friendship, type Person } from "@/server/db/schema";
import { env } from "@/server/env";
import { enqueue } from "@/server/jobs/queue";
import { getPersonCards, requireVisiblePerson, toPersonCard, type PersonCard } from "@/server/people/service";
import { visibleMembership, visiblePerson, type Viewer } from "@/server/privacy/visibility";

export type FriendState = "none" | "pending_out" | "pending_in" | "accepted";
export type FriendEntry = PersonCard & { friendship_id: string; since: string };

function other(f: Friendship, me: string): string {
  return f.requesterNetid === me ? f.addresseeNetid : f.requesterNetid;
}

async function pairRow(db: Db, a: string, b: string): Promise<Friendship | undefined> {
  const [row] = await db
    .select()
    .from(friendships)
    .where(
      or(
        and(eq(friendships.requesterNetid, a), eq(friendships.addresseeNetid, b)),
        and(eq(friendships.requesterNetid, b), eq(friendships.addresseeNetid, a)),
      ),
    );
  return row;
}

/** A user's friends are visible only to that user (privacy rule 6). */
export async function listFriends(
  db: Db,
  viewer: Viewer,
): Promise<{ friends: FriendEntry[]; incoming: FriendEntry[]; outgoing: FriendEntry[] }> {
  const me = viewer.netid;
  const rows = await db
    .select()
    .from(friendships)
    .where(
      and(
        or(eq(friendships.requesterNetid, me), eq(friendships.addresseeNetid, me)),
        inArray(friendships.status, ["pending", "accepted"]),
      ),
    );
  const cards = await getPersonCards(
    db,
    rows.map((f) => other(f, me)),
  );
  const out = { friends: [] as FriendEntry[], incoming: [] as FriendEntry[], outgoing: [] as FriendEntry[] };
  for (const f of rows) {
    const card = cards.get(other(f, me));
    if (!card) continue;
    const entry: FriendEntry = { ...card, friendship_id: f.id, since: (f.respondedAt ?? f.createdAt).toISOString() };
    if (f.status === "accepted") out.friends.push(entry);
    else if (f.requesterNetid === me) out.outgoing.push(entry);
    else out.incoming.push(entry);
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function friendCounts(db: Db, netid: string): Promise<{ friends: number; pending_requests: number }> {
  const rows = await db
    .select({ status: friendships.status, requester: friendships.requesterNetid })
    .from(friendships)
    .where(
      and(
        or(eq(friendships.requesterNetid, netid), eq(friendships.addresseeNetid, netid)),
        inArray(friendships.status, ["pending", "accepted"]),
      ),
    );
  return {
    friends: rows.filter((r) => r.status === "accepted").length,
    pending_requests: rows.filter((r) => r.status === "pending" && r.requester !== netid).length,
  };
}

/** Friendship state between `me` and each of `netids`, for directory search results. */
export async function friendStates(db: Db, me: string, netids: string[]): Promise<Map<string, FriendState>> {
  const out = new Map<string, FriendState>();
  if (netids.length === 0) return out;
  const rows = await db
    .select()
    .from(friendships)
    .where(
      or(
        and(eq(friendships.requesterNetid, me), inArray(friendships.addresseeNetid, netids)),
        and(eq(friendships.addresseeNetid, me), inArray(friendships.requesterNetid, netids)),
      ),
    );
  for (const f of rows) {
    const o = other(f, me);
    if (f.status === "accepted") out.set(o, "accepted");
    else if (f.status === "pending") out.set(o, f.requesterNetid === me ? "pending_out" : "pending_in");
  }
  return out;
}

export type AddFriendResult = {
  friendship_id: string;
  status: "pending" | "accepted";
  person: PersonCard;
  invite_url: string | null;
};

/**
 * Add a friend by NetID. One row per pair: a reverse pending request is
 * accepted; a declined or removed row goes back to pending with the new
 * requester. Adding a non-user returns an invite link for the user to send
 * themselves (NEPO never contacts anyone) and queues public-source research.
 */
export async function addFriend(db: Db, viewer: Viewer, netidRaw: string): Promise<AddFriendResult> {
  const me = viewer.netid;
  const netid = netidRaw.trim().toLowerCase();
  if (netid === me) throw new AppError("cannot_friend_self", "You can't add yourself.");
  const person: Person = await requireVisiblePerson(db, netid, viewer);
  const [targetUser] = await db.select({ id: users.id }).from(users).where(eq(users.netid, netid));
  const card = toPersonCard(person, Boolean(targetUser));
  const inviteUrl = targetUser ? null : `${env().APP_URL}/login?ref=${encodeURIComponent(me)}`;

  const existing = await pairRow(db, me, netid);
  let row: Friendship;
  if (!existing) {
    [row] = await db.insert(friendships).values({ requesterNetid: me, addresseeNetid: netid }).returning();
  } else if (existing.status === "accepted") {
    throw new AppError("already_friends", `You and ${card.first_name} are already friends.`);
  } else if (existing.status === "pending" && existing.addresseeNetid === me) {
    [row] = await db
      .update(friendships)
      .set({ status: "accepted", respondedAt: new Date() })
      .where(eq(friendships.id, existing.id))
      .returning();
  } else if (existing.status === "pending") {
    row = existing;
  } else {
    [row] = await db
      .update(friendships)
      .set({ requesterNetid: me, addresseeNetid: netid, status: "pending", respondedAt: null, createdAt: new Date() })
      .where(eq(friendships.id, existing.id))
      .returning();
  }

  if (!targetUser && !person.isDemo) {
    await enqueue(db, "research_person", { netid });
  }
  return { friendship_id: row.id, status: row.status as "pending" | "accepted", person: card, invite_url: inviteUrl };
}

async function loadFriendship(db: Db, id: string): Promise<Friendship> {
  const [row] = await db.select().from(friendships).where(eq(friendships.id, id));
  if (!row) throw new AppError("friendship_not_found", "That request does not exist.");
  return row;
}

/** Addressee only. */
export async function respondToFriendRequest(
  db: Db,
  me: string,
  id: string,
  decision: "accept" | "decline",
): Promise<Friendship> {
  const f = await loadFriendship(db, id);
  if (f.addresseeNetid !== me) throw new AppError("friendship_not_found", "That request does not exist.");
  if (f.status !== "pending") throw new AppError("invalid_state", "That request has already been answered.");
  const [row] = await db
    .update(friendships)
    .set({ status: decision === "accept" ? "accepted" : "declined", respondedAt: new Date() })
    .where(eq(friendships.id, id))
    .returning();
  return row;
}

/** Either side. Also used to cancel an outgoing request. */
export async function removeFriend(db: Db, me: string, id: string): Promise<void> {
  const f = await loadFriendship(db, id);
  if (f.requesterNetid !== me && f.addresseeNetid !== me) {
    throw new AppError("friendship_not_found", "That friendship does not exist.");
  }
  await db.update(friendships).set({ status: "removed", respondedAt: new Date() }).where(eq(friendships.id, id));
}

/**
 * "People you may know": visible members of the viewer's clubs, then people
 * in the same college and class year. Excludes existing friends and requests.
 */
export async function friendSuggestions(db: Db, viewer: Viewer, me: Person, limit = 12): Promise<PersonCard[]> {
  const existing = await db
    .select()
    .from(friendships)
    .where(
      and(
        or(eq(friendships.requesterNetid, me.netid), eq(friendships.addresseeNetid, me.netid)),
        inArray(friendships.status, ["pending", "accepted"]),
      ),
    );
  const skip = new Set([me.netid, ...existing.map((f) => other(f, me.netid))]);
  const out: PersonCard[] = [];
  const push = (rows: { person: Person; userId: string | null }[]) => {
    for (const r of rows) {
      if (out.length >= limit) return;
      if (skip.has(r.person.netid)) continue;
      skip.add(r.person.netid);
      out.push(toPersonCard(r.person, r.userId !== null));
    }
  };

  const myClubs = db.select({ id: memberships.clubId }).from(memberships).where(eq(memberships.netid, me.netid));
  push(
    await db
      .selectDistinct({ person: people, userId: users.id })
      .from(memberships)
      .innerJoin(people, eq(people.netid, memberships.netid))
      .leftJoin(users, eq(users.netid, people.netid))
      .where(and(inArray(memberships.clubId, myClubs), visibleMembership(), visiblePerson(viewer), ne(people.netid, me.netid)))
      .limit(limit * 3),
  );
  if (out.length < limit && me.college && me.year) {
    push(
      await db
        .select({ person: people, userId: users.id })
        .from(people)
        .leftJoin(users, eq(users.netid, people.netid))
        .where(and(eq(people.college, me.college), eq(people.year, me.year), visiblePerson(viewer)))
        .orderBy(sql`${users.id} is null`, people.lastName)
        .limit(limit * 3),
    );
  }
  return out;
}
