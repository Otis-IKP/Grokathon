import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { memberships, people } from "@/server/db/schema";

/** Membership statuses anyone other than the owner or an admin may see or route through. */
export const VISIBLE_MEMBERSHIP_STATUSES = ["verified", "likely", "claimed"] as const;
/** Statuses that are hidden from everyone but the owner and admins, and never used in paths. */
export const HIDDEN_MEMBERSHIP_STATUSES = ["unverified", "disputed", "rejected"] as const;

export type Viewer = { netid: string; isDemo: boolean };

/**
 * SQL condition for "this people row may be shown to this viewer":
 * not hidden, and demo people are only visible to demo viewers (section 14).
 */
export function visiblePerson(viewer: { isDemo: boolean }): SQL {
  const listed = eq(people.visibility, "listed");
  return viewer.isDemo ? listed : and(listed, eq(people.isDemo, false))!;
}

/** SQL condition for a membership that may be shown and used in path finding. */
export function visibleMembership(): SQL {
  return and(
    inArray(memberships.status, [...VISIBLE_MEMBERSHIP_STATUSES]),
    or(eq(memberships.isCurrent, true), eq(memberships.role, "alum")),
  )!;
}

export function isVisibleStatus(status: string): boolean {
  return (VISIBLE_MEMBERSHIP_STATUSES as readonly string[]).includes(status);
}
