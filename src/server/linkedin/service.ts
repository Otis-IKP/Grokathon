import { eq } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import type { Affiliation } from "@/server/agents/shared";
import { createUnreviewedClub } from "@/server/clubs/service";
import { resolveClub } from "@/server/clubs/resolve";
import type { Db } from "@/server/db/client";
import { experiences, jobs, people, users, type User } from "@/server/db/schema";
import { enqueue } from "@/server/jobs/queue";
import { upsertMembership, type MembershipSource } from "@/server/memberships/service";

export type LinkedinStatus = "none" | "reading" | "ok" | "needs_pdf" | "mismatch" | "failed";

const PROFILE_URL = /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%.]{2,100}\/?(\?.*)?$/i;

/** Accept only `linkedin.com/in/…` profile URLs, and store them without query strings. */
export function cleanLinkedinUrl(raw: string): string {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  if (!PROFILE_URL.test(url)) {
    throw new AppError("invalid_linkedin_url", "That doesn't look like a LinkedIn profile URL (linkedin.com/in/…).");
  }
  const u = new URL(url);
  return `https://www.linkedin.com${u.pathname.replace(/\/+$/, "")}`;
}

async function setStatus(db: Db, userId: string, status: LinkedinStatus, jobId?: string | null) {
  await db
    .update(users)
    .set({ linkedinStatus: status, ...(jobId !== undefined ? { linkedinJobId: jobId } : {}) })
    .where(eq(users.id, userId));
}

export { setStatus as setLinkedinStatus };

/** Layer A: the user pastes their URL; a job reads the public page. */
export async function submitLinkedinUrl(db: Db, user: User, rawUrl: string) {
  const url = cleanLinkedinUrl(rawUrl);
  await db.update(people).set({ linkedinUrl: url, linkedinUrlSource: "self" }).where(eq(people.netid, user.netid));
  const { job } = await enqueue(db, "linkedin_read", { user_id: user.id, url }, { force: true });
  await setStatus(db, user.id, "reading", job?.id ?? null);
  return { status: "reading" as const };
}

/**
 * Layer B: the user uploads LinkedIn's "Save to PDF" export of their own
 * profile. The handler extracts the text; only the text travels in the job
 * payload, and it is scrubbed when the job finishes.
 */
export async function submitLinkedinPdfText(db: Db, user: User, text: string) {
  if (text.trim().length < 80) {
    throw new AppError("invalid_pdf", "We couldn't read any text in that PDF. Use LinkedIn's More → Save to PDF.");
  }
  const { job } = await enqueue(db, "linkedin_pdf", { user_id: user.id, text });
  await setStatus(db, user.id, "reading", job?.id ?? null);
  return { status: "reading" as const };
}

export type FoundAffiliation = Affiliation & { club_name: string | null };
type LinkedinJobResult = {
  found?: FoundAffiliation[];
  held?: Affiliation[];
  needs_confirmation?: boolean;
  profile_name?: string | null;
  reason?: string | null;
  source?: MembershipSource;
};

async function latestResult(db: Db, user: User): Promise<{ id: string; result: LinkedinJobResult } | null> {
  if (!user.linkedinJobId) return null;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, user.linkedinJobId));
  if (!job) return null;
  return { id: job.id, result: (job.result ?? {}) as LinkedinJobResult };
}

export async function linkedinStatus(db: Db, user: User) {
  const latest = await latestResult(db, user);
  const r = latest?.result ?? {};
  return {
    status: user.linkedinStatus as LinkedinStatus,
    found: r.needs_confirmation ? [] : (r.found ?? []),
    needs_confirmation: Boolean(r.needs_confirmation),
    profile_name: r.needs_confirmation ? (r.profile_name ?? null) : null,
    reason: r.reason ?? null,
  };
}

/**
 * Write affiliations as claims. Yale clubs become `claimed` memberships (each
 * then validated); jobs and internships become display-only experiences.
 */
export async function applyAffiliations(
  db: Db,
  user: User,
  affiliations: Affiliation[],
  source: "linkedin_pdf" | "linkedin_url",
): Promise<FoundAffiliation[]> {
  const found: FoundAffiliation[] = [];
  const work = affiliations.filter((a) => a.kind === "job" || a.kind === "internship" || a.kind === "other");
  if (work.length > 0) {
    await db.delete(experiences).where(eq(experiences.userId, user.id));
    await db.insert(experiences).values(
      work.slice(0, 30).map((a) => ({
        userId: user.id,
        orgName: a.org_name.slice(0, 200),
        roleTitle: a.role_title?.slice(0, 200) ?? null,
        kind: a.kind,
        startYear: a.start_year,
        endYear: a.end_year,
      })),
    );
  }
  for (const a of affiliations) {
    if (a.kind !== "yale_club") {
      if (a.kind !== "school") found.push({ ...a, club_name: null });
      continue;
    }
    const resolved = await resolveClub(db, a.org_name);
    const club = resolved.club ?? (await createUnreviewedClub(db, a.org_name));
    const membership = await upsertMembership(db, {
      netid: user.netid,
      clubId: club.id,
      role: !a.is_current ? "alum" : a.is_leadership ? "board" : "member",
      title: a.role_title,
      startYear: a.start_year,
      endYear: a.end_year,
      isCurrent: a.is_current,
      status: "claimed",
      source,
      byOwner: true,
    });
    if (membership) await enqueue(db, "validate_membership", { membership_id: membership.id }, { force: true });
    found.push({ ...a, club_name: club.name });
  }
  return found;
}

/** After a name mismatch on a PDF: `true` writes the held affiliations as claims; `false` discards them. */
export async function confirmLinkedin(db: Db, user: User, confirm: boolean) {
  const latest = await latestResult(db, user);
  if (!latest?.result.needs_confirmation) {
    throw new AppError("nothing_to_confirm", "There is nothing waiting for confirmation.");
  }
  if (!confirm) {
    await db.update(jobs).set({ result: { found: [], needs_confirmation: false } }).where(eq(jobs.id, latest.id));
    await setStatus(db, user.id, "none");
    return { status: "none" as const, found: [] };
  }
  const found = await applyAffiliations(db, user, latest.result.held ?? [], "linkedin_pdf");
  await db.update(jobs).set({ result: { found, needs_confirmation: false } }).where(eq(jobs.id, latest.id));
  await setStatus(db, user.id, "ok");
  return { status: "ok" as const, found };
}
