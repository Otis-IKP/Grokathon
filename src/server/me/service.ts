import { and, eq, inArray, or } from "drizzle-orm";
import { maskPhone } from "@/lib/phone";
import type { CurrentUser } from "@/server/auth/guards";
import type { Db } from "@/server/db/client";
import {
  experiences,
  friendships,
  intros,
  memberships,
  pathSearches,
  people,
  phoneLinkCodes,
  users,
} from "@/server/db/schema";
import { env } from "@/server/env";
import { friendCounts } from "@/server/friends/service";
import { introCounts } from "@/server/intros/service";
import { toPersonCard } from "@/server/people/service";

export async function getMe(db: Db, me: CurrentUser) {
  const [friends, inbox] = await Promise.all([friendCounts(db, me.person.netid), introCounts(db, me.person.netid)]);
  return {
    user: toPersonCard(me.person, true),
    netid: me.person.netid,
    preferred_name: me.person.preferredName,
    first_name: me.person.firstName,
    last_name: me.person.lastName,
    needs_name: me.person.directorySource === "self" && !me.person.lastName,
    phone: {
      linked: Boolean(me.user.phoneVerifiedAt),
      masked: me.user.phoneE164 ? maskPhone(me.user.phoneE164) : null,
    },
    phone_verified_at: me.user.phoneVerifiedAt?.toISOString() ?? null,
    bot_phone: env().BOT_PHONE_DISPLAY,
    onboarding_done: Boolean(me.user.onboardingDoneAt),
    settings: {
      allow_as_connector: me.user.allowAsConnector,
      share_connections: me.user.shareConnections,
      visibility: me.person.visibility as "listed" | "hidden",
    },
    linkedin_status: me.user.linkedinStatus,
    is_admin: me.isAdmin,
    counts: { friends: friends.friends, pending_requests: friends.pending_requests, inbox: inbox.inbox },
  };
}

export type MePatch = {
  preferred_name?: string | null;
  first_name?: string;
  last_name?: string;
  allow_as_connector?: boolean;
  share_connections?: boolean;
  visibility?: "listed" | "hidden";
  onboarding_done?: boolean;
};

export async function updateMe(db: Db, me: CurrentUser, patch: MePatch): Promise<void> {
  const personPatch: Partial<typeof people.$inferInsert> = {};
  if (patch.preferred_name !== undefined) personPatch.preferredName = patch.preferred_name?.trim() || null;
  if (patch.visibility) personPatch.visibility = patch.visibility;
  // Legal names come from the directory; only people missing from Yalies type their own.
  if (me.person.directorySource === "self") {
    if (patch.first_name?.trim()) personPatch.firstName = patch.first_name.trim();
    if (patch.last_name?.trim()) personPatch.lastName = patch.last_name.trim();
  }
  if (Object.keys(personPatch).length > 0) {
    await db.update(people).set(personPatch).where(eq(people.netid, me.person.netid));
  }
  const userPatch: Partial<typeof users.$inferInsert> = {};
  if (patch.allow_as_connector !== undefined) userPatch.allowAsConnector = patch.allow_as_connector;
  if (patch.share_connections !== undefined) userPatch.shareConnections = patch.share_connections;
  if (patch.onboarding_done) userPatch.onboardingDoneAt = me.user.onboardingDoneAt ?? new Date();
  if (Object.keys(userPatch).length > 0) {
    await db.update(users).set(userPatch).where(eq(users.id, me.user.id));
  }
}

/**
 * Delete account (privacy rule 12): removes the user row, friendships,
 * experiences, self-sourced memberships, intros and searches, then marks the
 * person hidden so research does not rebuild the profile.
 */
export async function deleteAccount(db: Db, me: CurrentUser): Promise<void> {
  const netid = me.person.netid;
  await db.transaction(async (tx) => {
    await tx.delete(intros).where(or(eq(intros.requesterNetid, netid), eq(intros.connectorNetid, netid)));
    await tx.update(intros).set({ targetNetid: null }).where(eq(intros.targetNetid, netid));
    await tx.delete(pathSearches).where(eq(pathSearches.requesterNetid, netid));
    await tx.delete(friendships).where(or(eq(friendships.requesterNetid, netid), eq(friendships.addresseeNetid, netid)));
    await tx
      .delete(memberships)
      .where(
        and(eq(memberships.netid, netid), inArray(memberships.source, ["self_report", "linkedin_pdf", "linkedin_url"])),
      );
    await tx.delete(experiences).where(eq(experiences.userId, me.user.id));
    await tx.delete(phoneLinkCodes).where(eq(phoneLinkCodes.userId, me.user.id));
    await tx.delete(users).where(eq(users.id, me.user.id));
    await tx
      .update(people)
      .set({ visibility: "hidden", linkedinUrl: null, linkedinUrlSource: null })
      .where(eq(people.netid, netid));
  });
}
