import { and, desc, eq, inArray } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { resolveOrCreateClub, getClubById } from "@/server/clubs/service";
import { toClubCard, type ClubCard } from "@/server/clubs/resolve";
import type { Db } from "@/server/db/client";
import { clubs, membershipEvidence, memberships, users, type Membership } from "@/server/db/schema";
import { enqueue } from "@/server/jobs/queue";

/**
 * The single writer for `memberships` and `membership_evidence` (section 16).
 * The invariants in section 8 are enforced here and nowhere else.
 */

export type MembershipStatus = "claimed" | "verified" | "likely" | "unverified" | "disputed" | "rejected";
export type MembershipSource =
  | "self_report"
  | "linkedin_pdf"
  | "linkedin_url"
  | "public_roster"
  | "web_research"
  | "seed";
export type MembershipRole = "member" | "board" | "alum";
export type EvidenceSourceType = "club_site" | "yale_connect" | "campus_news" | "linkedin" | "other";
export type Evidence = { url: string; quote?: string | null; source_type: EvidenceSourceType };

const TRUST: Record<string, number> = { verified: 4, likely: 3, claimed: 2, unverified: 1 };
const STATUS_CONFIDENCE: Record<string, number> = { verified: 1, likely: 0.8, claimed: 0.7, unverified: 0.3 };
const SOURCE_ROLE_RANK: Record<string, number> = {
  public_roster: 3,
  web_research: 2,
  linkedin_url: 1,
  linkedin_pdf: 1,
  self_report: 1,
  seed: 1,
};

/** Did the claim come from the person themselves (self-report, own PDF, own URL)? */
export function isOwnSource(source: string): boolean {
  return source === "self_report" || source === "linkedin_pdf" || source === "linkedin_url";
}

export function isResearchSource(source: string): boolean {
  return source === "public_roster" || source === "web_research";
}

function cleanEvidence(evidence: Evidence[] | undefined): Evidence[] {
  const out: Evidence[] = [];
  const seen = new Set<string>();
  for (const e of evidence ?? []) {
    const url = e.url?.trim();
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, quote: e.quote ? e.quote.slice(0, 300) : null, source_type: e.source_type });
  }
  return out;
}

async function mergeEvidence(db: Db, membershipId: string, evidence: Evidence[]): Promise<void> {
  if (evidence.length === 0) return;
  const existing = await db
    .select({ url: membershipEvidence.url })
    .from(membershipEvidence)
    .where(eq(membershipEvidence.membershipId, membershipId));
  const have = new Set(existing.map((e) => e.url));
  const fresh = evidence.filter((e) => !have.has(e.url));
  if (fresh.length === 0) return;
  await db
    .insert(membershipEvidence)
    .values(fresh.map((e) => ({ membershipId, url: e.url, quote: e.quote ?? null, sourceType: e.source_type })));
}

async function replaceEvidence(db: Db, membershipId: string, evidence: Evidence[]): Promise<void> {
  await db.delete(membershipEvidence).where(eq(membershipEvidence.membershipId, membershipId));
  if (evidence.length === 0) return;
  await db
    .insert(membershipEvidence)
    .values(evidence.map((e) => ({ membershipId, url: e.url, quote: e.quote ?? null, sourceType: e.source_type })));
}

export type UpsertInput = {
  netid: string;
  clubId: string;
  role?: MembershipRole;
  title?: string | null;
  startYear?: number | null;
  endYear?: number | null;
  isCurrent?: boolean;
  status: "claimed" | "verified" | "likely" | "unverified";
  source: MembershipSource;
  evidence?: Evidence[];
  /** The owner is explicitly (re-)adding this club; the only thing that may revive a rejected row. */
  byOwner?: boolean;
};

/**
 * Create or merge a membership.
 * - Keeps the higher-trust status (verified > likely > claimed > unverified).
 * - Merges evidence.
 * - Never resurrects `rejected` (unless the owner re-adds it themselves).
 * - Role preference: public_roster, then research, then the claim.
 * - A research-sourced membership for a non-user needs at least one evidence
 *   URL (privacy rule 4); without one, nothing is written.
 */
export async function upsertMembership(db: Db, input: UpsertInput): Promise<Membership | null> {
  const evidence = cleanEvidence(input.evidence);
  const [existing] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.netid, input.netid), eq(memberships.clubId, input.clubId)));

  if (isResearchSource(input.source) && input.status !== "unverified" && evidence.length === 0) {
    const [isUser] = await db.select({ id: users.id }).from(users).where(eq(users.netid, input.netid));
    if (!isUser && !existing) return null;
    // For an existing row, research without evidence adds nothing.
    if (!isUser) return existing ?? null;
  }

  const role = input.role ?? "member";
  const isCurrent = input.isCurrent ?? true;

  if (!existing) {
    const [row] = await db
      .insert(memberships)
      .values({
        netid: input.netid,
        clubId: input.clubId,
        role,
        title: input.title ?? null,
        startYear: input.startYear ?? null,
        endYear: input.endYear ?? null,
        isCurrent,
        status: input.status,
        confidence: STATUS_CONFIDENCE[input.status],
        source: input.source,
        lastCheckedAt: input.status === "claimed" ? null : new Date(),
      })
      .returning();
    await mergeEvidence(db, row.id, evidence);
    return row;
  }

  if (existing.status === "rejected" && !input.byOwner) return existing;

  let status = existing.status;
  if (existing.status === "rejected" || existing.status === "disputed") {
    // Only the owner re-adding, or stronger outside evidence, moves these.
    if (input.byOwner) status = "claimed";
    if ((TRUST[input.status] ?? 0) > TRUST.claimed) status = input.status;
  } else if ((TRUST[input.status] ?? 0) > (TRUST[existing.status] ?? 0)) {
    status = input.status;
  }

  const incomingRank = SOURCE_ROLE_RANK[input.source] ?? 0;
  const existingRank = SOURCE_ROLE_RANK[existing.source] ?? 0;
  const takeRole = incomingRank >= existingRank || input.byOwner;
  // Source follows whichever claim now carries the status.
  const source = status !== existing.status || incomingRank > existingRank ? input.source : existing.source;

  const [row] = await db
    .update(memberships)
    .set({
      status,
      confidence: STATUS_CONFIDENCE[status] ?? existing.confidence,
      source,
      role: takeRole ? role : existing.role,
      title: takeRole ? (input.title ?? existing.title) : (existing.title ?? input.title ?? null),
      startYear: input.startYear ?? existing.startYear,
      endYear: input.endYear ?? existing.endYear,
      isCurrent: takeRole ? isCurrent : existing.isCurrent,
      lastCheckedAt: input.status === "claimed" ? existing.lastCheckedAt : new Date(),
    })
    .where(eq(memberships.id, existing.id))
    .returning();
  await mergeEvidence(db, row.id, evidence);
  return row;
}

export type Verdict = {
  verdict: "confirmed" | "likely" | "not_found" | "contradicted";
  confidence: number;
  role_found: string | null;
  is_board: boolean | null;
  evidence: Evidence[];
  reasoning?: string;
};

/**
 * Apply a validator verdict (table in section 7.4).
 * Re-validation never lowers a `verified` membership to `claimed`; only a
 * `contradicted` verdict moves it, to `disputed`.
 */
export async function applyVerdict(db: Db, membershipId: string, verdict: Verdict): Promise<Membership> {
  const [m] = await db.select().from(memberships).where(eq(memberships.id, membershipId));
  if (!m) throw new AppError("membership_not_found");
  if (m.status === "rejected") return m;

  const own = isOwnSource(m.source) || m.source === "seed";
  const evidence = cleanEvidence(verdict.evidence);
  let kind = verdict.verdict;
  // Evidence or nothing: a positive verdict without a surviving source is "not found".
  if ((kind === "confirmed" || kind === "likely") && evidence.length === 0) kind = "not_found";

  let status: MembershipStatus = m.status as MembershipStatus;
  switch (kind) {
    case "confirmed":
      status = "verified";
      break;
    case "likely":
      if (m.status !== "verified") status = "likely";
      break;
    case "not_found":
      if (m.status === "verified" || m.status === "likely") break; // never lowered by a search that found nothing
      status = own ? "claimed" : "unverified";
      break;
    case "contradicted":
      status = own ? "disputed" : "rejected";
      break;
  }

  const patch: Partial<typeof memberships.$inferInsert> = {
    status,
    confidence:
      kind === "confirmed" || kind === "likely"
        ? Math.min(1, Math.max(0, verdict.confidence))
        : (STATUS_CONFIDENCE[status] ?? m.confidence),
    lastCheckedAt: new Date(),
  };
  // Role: a public roster wins over the validator, which wins over the claim.
  if ((kind === "confirmed" || kind === "likely") && m.source !== "public_roster") {
    if (verdict.is_board === true) patch.role = "board";
    if (verdict.role_found) patch.title = verdict.role_found.slice(0, 120);
  }
  const [row] = await db.update(memberships).set(patch).where(eq(memberships.id, m.id)).returning();
  if (kind === "confirmed" || kind === "likely") await replaceEvidence(db, m.id, evidence);
  return row;
}

export type MyMembership = {
  id: string;
  club: ClubCard;
  role: string;
  title: string | null;
  start_year: number | null;
  end_year: number | null;
  is_current: boolean;
  status: string;
  source: string;
  confidence: number;
  last_checked_at: string | null;
  evidence: { url: string; quote: string | null; source_type: string }[];
};

/** The owner's own memberships, every status except `rejected`, with evidence. */
export async function listMyMemberships(db: Db, netid: string): Promise<MyMembership[]> {
  const rows = await db
    .select({ m: memberships, club: clubs })
    .from(memberships)
    .innerJoin(clubs, eq(clubs.id, memberships.clubId))
    .where(eq(memberships.netid, netid))
    .orderBy(desc(memberships.createdAt));
  const shown = rows.filter((r) => r.m.status !== "rejected" && r.m.status !== "unverified");
  if (shown.length === 0) return [];
  const ev = await db
    .select()
    .from(membershipEvidence)
    .where(
      inArray(
        membershipEvidence.membershipId,
        shown.map((r) => r.m.id),
      ),
    );
  return shown.map((r) => ({
    id: r.m.id,
    club: toClubCard(r.club),
    role: r.m.role,
    title: r.m.title,
    start_year: r.m.startYear,
    end_year: r.m.endYear,
    is_current: r.m.isCurrent,
    status: r.m.status,
    source: r.m.source,
    confidence: r.m.confidence,
    last_checked_at: r.m.lastCheckedAt?.toISOString() ?? null,
    evidence: ev
      .filter((e) => e.membershipId === r.m.id)
      .map((e) => ({ url: e.url, quote: e.quote, source_type: e.sourceType })),
  }));
}

export type SelfReportInput = {
  clubId?: string;
  clubName?: string;
  role?: MembershipRole;
  title?: string | null;
  startYear?: number | null;
  endYear?: number | null;
};

/** "I'm in this club": a `claimed` membership plus a validation job. */
export async function createSelfReport(db: Db, netid: string, input: SelfReportInput): Promise<Membership> {
  const club = input.clubId ? await getClubById(db, input.clubId) : await resolveOrCreateClub(db, input.clubName ?? "");
  const row = await upsertMembership(db, {
    netid,
    clubId: club.id,
    role: input.role ?? "member",
    title: input.title ?? null,
    startYear: input.startYear ?? null,
    endYear: input.endYear ?? null,
    isCurrent: input.role !== "alum",
    status: "claimed",
    source: "self_report",
    byOwner: true,
  });
  await enqueue(db, "validate_membership", { membership_id: row!.id }, { force: true });
  return row!;
}

async function ownMembership(db: Db, netid: string, id: string): Promise<Membership> {
  const [m] = await db.select().from(memberships).where(eq(memberships.id, id));
  if (!m || m.netid !== netid) throw new AppError("membership_not_found", "That membership does not exist.");
  return m;
}

export async function updateMyMembership(
  db: Db,
  netid: string,
  id: string,
  patch: { role?: MembershipRole; title?: string | null; startYear?: number | null; endYear?: number | null },
): Promise<Membership> {
  const m = await ownMembership(db, netid, id);
  const [row] = await db
    .update(memberships)
    .set({
      ...(patch.role ? { role: patch.role, isCurrent: patch.role !== "alum" } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.startYear !== undefined ? { startYear: patch.startYear } : {}),
      ...(patch.endYear !== undefined ? { endYear: patch.endYear } : {}),
    })
    .where(eq(memberships.id, m.id))
    .returning();
  return row;
}

/**
 * Owner removes a club. A research-sourced membership becomes `rejected`
 * so that research does not add it again; anything else is deleted.
 */
export async function deleteMyMembership(db: Db, netid: string, id: string): Promise<void> {
  const m = await ownMembership(db, netid, id);
  if (isResearchSource(m.source)) {
    await db.update(memberships).set({ status: "rejected", isCurrent: false }).where(eq(memberships.id, m.id));
  } else {
    await db.delete(memberships).where(eq(memberships.id, m.id));
  }
}

/** Admin or roster re-crawl: mark a research membership rejected. */
export async function rejectMembership(db: Db, id: string): Promise<void> {
  await db.update(memberships).set({ status: "rejected" }).where(eq(memberships.id, id));
}
