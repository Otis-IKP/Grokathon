import { and, eq, gt, inArray, ne, or, sql } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import type { ClubCard } from "@/server/clubs/resolve";
import type { Db } from "@/server/db/client";
import {
  clubs,
  friendships,
  intros,
  membershipEvidence,
  memberships,
  people,
  users,
  type Club,
  type Membership,
  type Person,
} from "@/server/db/schema";
import { toPersonCard, type PersonCard } from "@/server/people/service";
import { visibleMembership, visiblePerson } from "@/server/privacy/visibility";
import { explainPath } from "./explain";
import { comparePaths, scorePath, type Role, type Tie, type VisibleStatus } from "./score";

export type PathLink =
  | { type: "member"; role: string; title: string | null; status: string; evidence_url: string | null }
  | { type: "knows_member"; via: "friend" | "shared_club"; shared_club?: string };

export type PathTarget = { person: PersonCard; role: string; title: string | null; status: string };

export type PathResult = {
  rank: number;
  score: number;
  hops: 1 | 2;
  connector: PersonCard;
  connector_tie: "friend" | "added";
  link: PathLink;
  target: PathTarget | null;
  why: string;
};

export type EmptyReason = "no_friends" | "no_known_members" | "no_connection" | "already_member";

export type FindPathsResult = {
  results: PathResult[];
  emptyReason: EmptyReason | null;
  /** Friend NetIDs of the requester (confirmed and own one-sided), for the research side effect. */
  friendNetids: string[];
};

type MemberRow = { m: Membership; person: Person; isUser: boolean };
type Candidate = Omit<PathResult, "rank"> & { connectorName: string };

const SMALL_CLUB_MAX = 40;
const DECLINE_SUPPRESS_DAYS = 30;

export function clubShort(club: Pick<Club, "shortName" | "name">): string {
  return club.shortName?.trim() || club.name;
}

/**
 * Path finding (section 11). Read-only: side effects (saving the search,
 * queueing research) live in paths/service.ts.
 *
 * Graph edges:
 * - confirmed friend: an accepted friendship, usable in both directions;
 * - one-sided friend: a pending friendship the requester created, usable only
 *   by them and only as their first hop;
 * - membership: a current (or alum) membership with a visible status, for a
 *   person who is listed and visible to the requester.
 */
export async function findPaths(db: Db, requesterNetid: string, clubId: string, limit = 3): Promise<FindPathsResult> {
  const [requester] = await db.select().from(people).where(eq(people.netid, requesterNetid));
  if (!requester) throw new AppError("person_not_found");
  const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId));
  if (!club || club.status === "hidden") throw new AppError("club_not_found", "That club does not exist.");
  const viewer = { netid: requester.netid, isDemo: requester.isDemo };
  const short = clubShort(club);

  // Already a member? (Any of the requester's own non-rejected, current claims counts.)
  const [mine] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.netid, requester.netid),
        eq(memberships.clubId, clubId),
        eq(memberships.isCurrent, true),
        inArray(memberships.status, ["verified", "likely", "claimed"]),
      ),
    );
  if (mine) return { results: [], emptyReason: "already_member", friendNetids: [] };

  // 1. The requester's friend edges.
  const edgeRows = await db
    .select()
    .from(friendships)
    .where(
      or(
        and(
          eq(friendships.status, "accepted"),
          or(eq(friendships.requesterNetid, requester.netid), eq(friendships.addresseeNetid, requester.netid)),
        ),
        and(eq(friendships.status, "pending"), eq(friendships.requesterNetid, requester.netid)),
      ),
    );
  const tieBy = new Map<string, Tie>();
  for (const f of edgeRows) {
    const o = f.requesterNetid === requester.netid ? f.addresseeNetid : f.requesterNetid;
    tieBy.set(o, f.status === "accepted" ? "confirmed" : "one_sided");
  }

  // 2. Connector eligibility: listed, visible to the requester, allows being a
  //    connector, and has not declined this requester for this club recently.
  const friendRows =
    tieBy.size === 0
      ? []
      : await db
          .select({ person: people, user: users })
          .from(people)
          .leftJoin(users, eq(users.netid, people.netid))
          .where(and(inArray(people.netid, [...tieBy.keys()]), visiblePerson(viewer)));
  const declinedSince = new Date(Date.now() - DECLINE_SUPPRESS_DAYS * 24 * 60 * 60 * 1000);
  const declined = await db
    .select({ connector: intros.connectorNetid })
    .from(intros)
    .where(
      and(
        eq(intros.requesterNetid, requester.netid),
        eq(intros.clubId, clubId),
        eq(intros.status, "declined"),
        gt(intros.respondedAt, declinedSince),
      ),
    );
  const declinedSet = new Set(declined.map((d) => d.connector));
  const friends = new Map<string, { person: Person; isUser: boolean; shares: boolean; tie: Tie }>();
  for (const r of friendRows) {
    if (r.user && !r.user.allowAsConnector) continue;
    if (declinedSet.has(r.person.netid)) continue;
    friends.set(r.person.netid, {
      person: r.person,
      isUser: r.user !== null,
      shares: r.user?.shareConnections === true,
      tie: tieBy.get(r.person.netid)!,
    });
  }
  const friendNetids = [...friends.keys()];

  // 3. M(C): visible current members of the club.
  const memberRows: MemberRow[] = (
    await db
      .select({ m: memberships, person: people, userId: users.id })
      .from(memberships)
      .innerJoin(people, eq(people.netid, memberships.netid))
      .leftJoin(users, eq(users.netid, people.netid))
      .where(and(eq(memberships.clubId, clubId), visibleMembership(), visiblePerson(viewer)))
  ).map((r) => ({ m: r.m, person: r.person, isUser: r.userId !== null }));
  const members = new Map(memberRows.map((r) => [r.person.netid, r]));

  if (tieBy.size === 0) return { results: [], emptyReason: "no_friends", friendNetids };
  if (members.size === 0) return { results: [], emptyReason: "no_known_members", friendNetids };

  // Evidence for the memberships used, newest first.
  const evidenceRows = await db
    .select()
    .from(membershipEvidence)
    .where(
      inArray(
        membershipEvidence.membershipId,
        memberRows.map((r) => r.m.id),
      ),
    )
    .orderBy(sql`${membershipEvidence.retrievedAt} desc`);
  const evidenceBy = new Map<string, { url: string; sourceType: string }>();
  for (const e of evidenceRows) {
    if (!evidenceBy.has(e.membershipId)) evidenceBy.set(e.membershipId, { url: e.url, sourceType: e.sourceType });
  }

  // Connector load: intros awaiting their response.
  const loadRows =
    friendNetids.length === 0
      ? []
      : await db
          .select({ connector: intros.connectorNetid, n: sql<number>`count(*)::int` })
          .from(intros)
          .where(and(inArray(intros.connectorNetid, friendNetids), eq(intros.status, "sent")))
          .groupBy(intros.connectorNetid);
  const loadBy = new Map(loadRows.map((r) => [r.connector, r.n]));

  const candidates: Candidate[] = [];
  const base = (f: { person: Person; isUser: boolean; tie: Tie }) => ({
    connector: toPersonCard(f.person, f.isUser),
    connector_tie: f.tie === "confirmed" ? ("friend" as const) : ("added" as const),
    connectorName: toPersonCard(f.person, f.isUser).name,
    sameCollege: Boolean(requester.college && requester.college === f.person.college),
    sameYear: Boolean(requester.year && requester.year === f.person.year),
    pendingIntros: loadBy.get(f.person.netid) ?? 0,
  });
  const targetOf = (t: MemberRow): PathTarget => ({
    person: toPersonCard(t.person, t.isUser),
    role: t.m.role,
    title: t.m.title,
    status: t.m.status,
  });

  // 4. 1-hop: a friend (confirmed or the requester's own one-sided add) who is a member.
  for (const [netid, f] of friends) {
    const member = members.get(netid);
    if (!member) continue;
    const b = base(f);
    const evidence = evidenceBy.get(member.m.id) ?? null;
    candidates.push({
      score: scorePath({
        tie: f.tie,
        hops: 1,
        role: member.m.role as Role,
        status: member.m.status as VisibleStatus,
        pendingIntros: b.pendingIntros,
        sameCollege: b.sameCollege,
        sameYear: b.sameYear,
      }),
      hops: 1,
      connector: b.connector,
      connector_tie: b.connector_tie,
      connectorName: b.connectorName,
      link: {
        type: "member",
        role: member.m.role,
        title: member.m.title,
        status: member.m.status,
        evidence_url: evidence?.url ?? null,
      },
      target: null,
      why: explainPath({
        kind: "member",
        tie: f.tie,
        connectorFirstName: b.connector.first_name,
        clubShort: short,
        role: member.m.role as Role,
        title: member.m.title,
        status: member.m.status as VisibleStatus,
        evidenceSource: evidence?.sourceType ?? null,
      }),
    });
  }

  // Alumni are reachable as 1-hop connectors only; a 2-hop target must be a current member.
  const targetNetids = memberRows.filter((r) => r.m.role !== "alum").map((r) => r.person.netid);

  // 5. 2-hop via a friend: R–F confirmed, F a user who shares connections,
  //    F–T confirmed, T in the club, F not in the club, T is not R.
  const sharers = [...friends.values()].filter(
    (f) => f.tie === "confirmed" && f.isUser && f.shares && !members.has(f.person.netid),
  );
  if (sharers.length > 0 && targetNetids.length > 0) {
    const sharerIds = sharers.map((f) => f.person.netid);
    const hop = await db
      .select()
      .from(friendships)
      .where(
        and(
          eq(friendships.status, "accepted"),
          or(
            and(inArray(friendships.requesterNetid, sharerIds), inArray(friendships.addresseeNetid, targetNetids)),
            and(inArray(friendships.addresseeNetid, sharerIds), inArray(friendships.requesterNetid, targetNetids)),
          ),
        ),
      );
    for (const edge of hop) {
      for (const [fId, tId] of [
        [edge.requesterNetid, edge.addresseeNetid],
        [edge.addresseeNetid, edge.requesterNetid],
      ]) {
        const f = friends.get(fId);
        const t = members.get(tId);
        if (!f || !t || !sharerIds.includes(fId) || t.m.role === "alum") continue;
        if (tId === requester.netid || tId === fId) continue;
        const b = base(f);
        candidates.push({
          score: scorePath({
            tie: f.tie,
            hops: 2,
            via: "friend",
            role: t.m.role as Role,
            status: t.m.status as VisibleStatus,
            pendingIntros: b.pendingIntros,
            sameCollege: b.sameCollege,
            sameYear: b.sameYear,
          }),
          hops: 2,
          connector: b.connector,
          connector_tie: b.connector_tie,
          connectorName: b.connectorName,
          link: { type: "knows_member", via: "friend" },
          target: targetOf(t),
          why: explainPath({
            kind: "via_friend",
            tie: f.tie,
            connectorFirstName: b.connector.first_name,
            clubShort: short,
            targetName: toPersonCard(t.person, t.isUser).name,
            targetRole: t.m.role as Role,
            targetTitle: t.m.title,
          }),
        });
      }
    }
  }

  // 6. 2-hop weak tie: F and T are both current verified members of another
  //    small club (40 or fewer known members), T in the target club.
  const weakConnectors = [...friends.values()].filter((f) => !members.has(f.person.netid));
  if (weakConnectors.length > 0 && targetNetids.length > 0) {
    const verifiedCurrent = and(eq(memberships.status, "verified"), eq(memberships.isCurrent, true));
    const fClubs = await db
      .select({ netid: memberships.netid, clubId: memberships.clubId })
      .from(memberships)
      .where(
        and(
          inArray(
            memberships.netid,
            weakConnectors.map((f) => f.person.netid),
          ),
          ne(memberships.clubId, clubId),
          verifiedCurrent,
        ),
      );
    const sharedIds = [...new Set(fClubs.map((r) => r.clubId))];
    if (sharedIds.length > 0) {
      const sizes = await db
        .select({ clubId: memberships.clubId, n: sql<number>`count(*)::int` })
        .from(memberships)
        .where(and(inArray(memberships.clubId, sharedIds), visibleMembership()))
        .groupBy(memberships.clubId);
      const small = new Set(sizes.filter((s) => s.n <= SMALL_CLUB_MAX).map((s) => s.clubId));
      const smallIds = sharedIds.filter((id) => small.has(id));
      if (smallIds.length > 0) {
        const tClubs = await db
          .select({ netid: memberships.netid, clubId: memberships.clubId, clubName: clubs.name, clubShort: clubs.shortName })
          .from(memberships)
          .innerJoin(clubs, eq(clubs.id, memberships.clubId))
          .where(and(inArray(memberships.netid, targetNetids), inArray(memberships.clubId, smallIds), verifiedCurrent));
        for (const fc of fClubs) {
          if (!small.has(fc.clubId)) continue;
          const f = friends.get(fc.netid)!;
          for (const tc of tClubs) {
            if (tc.clubId !== fc.clubId) continue;
            const t = members.get(tc.netid);
            if (!t || tc.netid === requester.netid || tc.netid === fc.netid) continue;
            const b = base(f);
            const sharedName = tc.clubShort?.trim() || tc.clubName;
            candidates.push({
              score: scorePath({
                tie: f.tie,
                hops: 2,
                via: "shared_club",
                role: t.m.role as Role,
                status: t.m.status as VisibleStatus,
                pendingIntros: b.pendingIntros,
                sameCollege: b.sameCollege,
                sameYear: b.sameYear,
              }),
              hops: 2,
              connector: b.connector,
              connector_tie: b.connector_tie,
              connectorName: b.connectorName,
              link: { type: "knows_member", via: "shared_club", shared_club: sharedName },
              target: targetOf(t),
              why: explainPath({
                kind: "via_shared_club",
                tie: f.tie,
                connectorFirstName: b.connector.first_name,
                clubShort: short,
                targetName: toPersonCard(t.person, t.isUser).name,
                targetRole: t.m.role as Role,
                sharedClub: sharedName,
              }),
            });
          }
        }
      }
    }
  }

  // 7. Best path per connector, ranked.
  const best = new Map<string, Candidate>();
  for (const c of candidates) {
    const current = best.get(c.connector.netid);
    if (!current || comparePaths(c, current) < 0 || (comparePaths(c, current) === 0 && betterTarget(c, current))) {
      best.set(c.connector.netid, c);
    }
  }
  const ranked = [...best.values()].sort(comparePaths).slice(0, Math.max(1, limit));
  const results: PathResult[] = ranked.map((c, i) => ({
    rank: i + 1,
    score: c.score,
    hops: c.hops,
    connector: c.connector,
    connector_tie: c.connector_tie,
    link: c.link,
    target: c.target,
    why: c.why,
  }));
  return { results, emptyReason: results.length === 0 ? "no_connection" : null, friendNetids };
}

/** Deterministic tie-break between equal paths through the same connector. */
function betterTarget(a: Candidate, b: Candidate): boolean {
  return (a.target?.person.name ?? "").localeCompare(b.target?.person.name ?? "") < 0;
}

export type { ClubCard };
