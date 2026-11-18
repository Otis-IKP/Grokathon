import { and, eq, gt, lt } from "drizzle-orm";
import { normalizePhone } from "@/lib/phone";
import { sweepRateLimits } from "@/lib/rateLimit";
import type { Db } from "@/server/db/client";
import { botClaims, botState } from "@/server/db/schema";

/**
 * Storage for the messaging bot, so that nothing it needs between two texts
 * lives only in one process: the conversation, the draft waiting for "send",
 * and intro requests waiting for a connector's YES or NO. The app stores the
 * JSON as given and never reads inside it.
 */

/** State not touched for this long is gone. Conversations idle out after 30 minutes anyway. */
export const BOT_STATE_TTL_MS = 24 * 60 * 60 * 1000;
const CLAIM_TTL_MS = 2 * 24 * 60 * 60 * 1000;

const keyFor = (phone: string) => `phone:${normalizePhone(phone)}`;

export async function getBotState(db: Db, phone: string): Promise<unknown | null> {
  const [row] = await db
    .select({ state: botState.state })
    .from(botState)
    .where(and(eq(botState.key, keyFor(phone)), gt(botState.updatedAt, new Date(Date.now() - BOT_STATE_TTL_MS))));
  return row?.state ?? null;
}

/** `null` forgets the phone's state. */
export async function putBotState(db: Db, phone: string, state: unknown | null): Promise<void> {
  const key = keyFor(phone);
  if (state === null) {
    await db.delete(botState).where(eq(botState.key, key));
    return;
  }
  await db
    .insert(botState)
    .values({ key, state: state as object })
    .onConflictDoUpdate({ target: botState.key, set: { state: state as object, updatedAt: new Date() } });
}

/** True the first time a key is claimed, false every time after. */
export async function claimOnce(db: Db, key: string): Promise<boolean> {
  const rows = await db.insert(botClaims).values({ key }).onConflictDoNothing().returning({ key: botClaims.key });
  return rows.length > 0;
}

export async function releaseClaim(db: Db, key: string): Promise<void> {
  await db.delete(botClaims).where(eq(botClaims.key, key));
}

/** Housekeeping for the short-lived tables. Runs with the job tick. */
export async function sweepEphemeral(db: Db): Promise<void> {
  await db.delete(botState).where(lt(botState.updatedAt, new Date(Date.now() - BOT_STATE_TTL_MS)));
  await db.delete(botClaims).where(lt(botClaims.createdAt, new Date(Date.now() - CLAIM_TTL_MS)));
  await sweepRateLimits(db);
}
