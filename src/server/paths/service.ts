import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { firstNameAndInitial } from "@/lib/names";
import { getClubById } from "@/server/clubs/service";
import { toClubCard, type ClubCard } from "@/server/clubs/resolve";
import type { Db } from "@/server/db/client";
import { clubs, jobs, pathSearches, people, type Club } from "@/server/db/schema";
import { env } from "@/server/env";
import { enqueue } from "@/server/jobs/queue";
import { clubShort, findPaths, type EmptyReason, type PathResult } from "./findPaths";

export type PathSearchResponse = {
  search_id: string;
  club: ClubCard;
  results: PathResult[];
  pending_research: boolean;
  empty_reason: EmptyReason | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const SHARE_TTL_MS = DAY_MS;

/** Section 11.5: queue a roster crawl when stale, and friend research when results are thin. */
async function queueResearch(db: Db, club: Club, results: PathResult[], friendNetids: string[]): Promise<boolean> {
  let pending = false;
  const e = env();
  const clubStale =
    !club.rosterCrawledAt || Date.now() - club.rosterCrawledAt.getTime() > e.ENRICH_CLUB_TTL_DAYS * DAY_MS;
  if (clubStale) {
    const { enqueued, job } = await enqueue(db, "crawl_roster", { club_id: club.id });
    if (enqueued || job?.status === "queued" || job?.status === "running") pending = true;
  }
  if (results.length < 3 && friendNetids.length > 0) {
    const staleBefore = new Date(Date.now() - e.ENRICH_PERSON_TTL_DAYS * DAY_MS);
    const stale = await db
      .select({ netid: people.netid })
      .from(people)
      .where(
        and(
          inArray(people.netid, friendNetids),
          eq(people.visibility, "listed"),
          eq(people.isDemo, false),
          or(isNull(people.researchedAt), lt(people.researchedAt, staleBefore)),
        ),
      )
      .limit(10);
    for (const { netid } of stale) {
      const { enqueued, job } = await enqueue(db, "research_person", { netid });
      if (enqueued || job?.status === "queued" || job?.status === "running") pending = true;
    }
  }
  return pending;
}

/** Run a path search, save it, and queue the research that could improve it. */
export async function searchPaths(
  db: Db,
  input: { requesterNetid: string; clubId: string; channel: "app" | "bot"; limit?: number },
): Promise<PathSearchResponse> {
  const club = await getClubById(db, input.clubId);
  const found = await findPaths(db, input.requesterNetid, club.id, input.limit ?? 3);
  const [row] = await db
    .insert(pathSearches)
    .values({ requesterNetid: input.requesterNetid, clubId: club.id, channel: input.channel, results: found.results })
    .returning();
  const pending =
    found.emptyReason === "already_member" ? false : await queueResearch(db, club, found.results, found.friendNetids);
  return {
    search_id: row.id,
    club: toClubCard(club),
    results: found.results,
    pending_research: pending,
    empty_reason: found.emptyReason,
  };
}

async function ownSearch(db: Db, requesterNetid: string, searchId: string) {
  const [row] = await db.select().from(pathSearches).where(eq(pathSearches.id, searchId));
  if (!row || row.requesterNetid !== requesterNetid) {
    throw new AppError("search_not_found", "That search does not exist.");
  }
  return row;
}

/** A previous search, re-ranked against current data. Requester only. */
export async function getSearch(db: Db, requesterNetid: string, searchId: string, limit = 5): Promise<PathSearchResponse> {
  const row = await ownSearch(db, requesterNetid, searchId);
  const club = await getClubById(db, row.clubId);
  const found = await findPaths(db, requesterNetid, club.id, limit);
  await db.update(pathSearches).set({ results: found.results }).where(eq(pathSearches.id, row.id));
  // Research is still pending while any job this search could have queued is unfinished.
  const keys = [`crawl_roster:${club.id}`, ...found.friendNetids.map((n) => `research_person:${n}`)];
  const open = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(inArray(jobs.dedupeKey, keys), inArray(jobs.status, ["queued", "running"])))
    .limit(1);
  return {
    search_id: row.id,
    club: toClubCard(club),
    results: found.results,
    pending_research: open.length > 0,
    empty_reason: found.emptyReason,
  };
}

/** The saved result for one connector in a search; used when drafting and creating intros. */
export async function getSearchResultFor(
  db: Db,
  requesterNetid: string,
  searchId: string,
  connectorNetid: string,
): Promise<{ search: typeof pathSearches.$inferSelect; club: Club; result: PathResult }> {
  const search = await ownSearch(db, requesterNetid, searchId);
  const club = await getClubById(db, search.clubId);
  const results = (search.results ?? []) as PathResult[];
  const result = results.find((r) => r.connector.netid === connectorNetid.toLowerCase());
  if (!result) {
    throw new AppError("connector_not_in_search", "That person was not one of the connectors in this search.");
  }
  return { search, club, result };
}

export async function recentSearches(db: Db, requesterNetid: string, limit = 5) {
  const rows = await db
    .select({ s: pathSearches, club: clubs })
    .from(pathSearches)
    .innerJoin(clubs, eq(clubs.id, pathSearches.clubId))
    .where(eq(pathSearches.requesterNetid, requesterNetid))
    .orderBy(desc(pathSearches.createdAt))
    .limit(30);
  // Latest search per club.
  const seen = new Set<string>();
  const out: { search_id: string; club: ClubCard; result_count: number; created_at: string }[] = [];
  for (const r of rows) {
    if (seen.has(r.club.id)) continue;
    seen.add(r.club.id);
    out.push({
      search_id: r.s.id,
      club: toClubCard(r.club),
      result_count: ((r.s.results ?? []) as unknown[]).length,
      created_at: r.s.createdAt.toISOString(),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Requester only. A 24-hour token for the public graph endpoint. */
export async function createShare(db: Db, requesterNetid: string, searchId: string) {
  const row = await ownSearch(db, requesterNetid, searchId);
  const token = randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + SHARE_TTL_MS);
  await db.update(pathSearches).set({ shareToken: token, shareExpiresAt: expires }).where(eq(pathSearches.id, row.id));
  return { share_token: token, expires_at: expires.toISOString() };
}

export type Graph = {
  nodes: { id: string; label: string; kind: "requester" | "connector" | "target" | "club"; role?: string }[];
  edges: { from: string; to: string; kind: "friend" | "member" | "board" }[];
};

/**
 * The graph for Arden's site (section 9.4). Labels are first name and last
 * initial only; node ids are opaque, never NetIDs; anyone who has since
 * hidden themselves is dropped.
 */
export async function graphForToken(db: Db, token: string): Promise<Graph> {
  const [search] = await db.select().from(pathSearches).where(eq(pathSearches.shareToken, token));
  if (!search || !search.shareExpiresAt || search.shareExpiresAt.getTime() < Date.now()) {
    throw new AppError("share_expired", "This link has expired.");
  }
  const [club] = await db.select().from(clubs).where(eq(clubs.id, search.clubId));
  const results = (search.results ?? []) as PathResult[];
  const netids = [
    search.requesterNetid,
    ...results.map((r) => r.connector.netid),
    ...results.flatMap((r) => (r.target ? [r.target.person.netid] : [])),
  ];
  const rows = await db.select().from(people).where(inArray(people.netid, netids));
  const byNetid = new Map(rows.map((p) => [p.netid, p]));
  const ids = new Map<string, string>();
  const idFor = (netid: string) => {
    if (!ids.has(netid)) ids.set(netid, `p${ids.size + 1}`);
    return ids.get(netid)!;
  };
  const label = (netid: string) => {
    const p = byNetid.get(netid)!;
    return firstNameAndInitial(p.preferredName?.trim() || p.firstName, p.lastName);
  };
  const shown = (netid: string) => byNetid.get(netid)?.visibility === "listed";

  const graph: Graph = { nodes: [], edges: [] };
  const added = new Set<string>();
  const addNode = (netid: string, kind: "requester" | "connector" | "target", role?: string) => {
    const id = idFor(netid);
    if (!added.has(id)) {
      added.add(id);
      graph.nodes.push({ id, label: label(netid), kind, ...(role ? { role } : {}) });
    }
    return id;
  };
  const clubNode = { id: "club", label: clubShort(club), kind: "club" as const };
  graph.nodes.push(clubNode);
  if (!byNetid.has(search.requesterNetid)) return graph;
  const r = addNode(search.requesterNetid, "requester");

  for (const res of results) {
    if (!shown(res.connector.netid)) continue;
    if (res.hops === 1 && res.link.type === "member") {
      const c = addNode(res.connector.netid, "connector", res.link.role);
      graph.edges.push({ from: r, to: c, kind: "friend" });
      graph.edges.push({ from: c, to: "club", kind: res.link.role === "board" ? "board" : "member" });
    } else if (res.target && shown(res.target.person.netid)) {
      const c = addNode(res.connector.netid, "connector");
      const t = addNode(res.target.person.netid, "target", res.target.role);
      graph.edges.push({ from: r, to: c, kind: "friend" });
      graph.edges.push({ from: c, to: t, kind: "friend" });
      graph.edges.push({ from: t, to: "club", kind: res.target.role === "board" ? "board" : "member" });
    }
  }
  return graph;
}
