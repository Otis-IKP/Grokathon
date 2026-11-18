import { randomInt } from "node:crypto";
import { and, eq, isNull, lt, ne } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import type { Db } from "@/server/db/client";
import { botState, phoneLinkCodes, users, type User } from "@/server/db/schema";
import { env } from "@/server/env";

const CODE_TTL_MS = 10 * 60 * 1000;

/** A 6-digit, single-use code valid for 10 minutes. Replaces any earlier unused code for the user. */
export async function createPhoneCode(db: Db, userId: string) {
  await db.delete(phoneLinkCodes).where(and(eq(phoneLinkCodes.userId, userId), isNull(phoneLinkCodes.usedAt)));
  await db.delete(phoneLinkCodes).where(lt(phoneLinkCodes.expiresAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const [row] = await db.insert(phoneLinkCodes).values({ code, userId, expiresAt }).onConflictDoNothing().returning();
    if (row) return { code, expires_at: expiresAt.toISOString(), bot_phone: env().BOT_PHONE_DISPLAY };
  }
  throw new AppError("internal_error", "Could not create a code. Try again.");
}

/**
 * Called by the bot when a number texts a code. Texting from the number
 * proves control of it. A phone belongs to one user: linking it to a second
 * user unlinks it from the first.
 */
export async function linkPhone(db: Db, phoneRaw: string, code: string): Promise<User> {
  const phone = normalizePhone(phoneRaw);
  const [row] = await db.select().from(phoneLinkCodes).where(eq(phoneLinkCodes.code, code.trim()));
  if (!row || row.usedAt) throw new AppError("invalid_code", "That code is not valid.");
  if (row.expiresAt.getTime() < Date.now()) throw new AppError("code_expired", "That code has expired. Get a new one in the app.");
  return db.transaction(async (tx) => {
    // Claim the code first: two texts racing with the same code cannot both link.
    const [claimed] = await tx
      .update(phoneLinkCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(phoneLinkCodes.code, row.code), isNull(phoneLinkCodes.usedAt)))
      .returning({ code: phoneLinkCodes.code });
    if (!claimed) throw new AppError("invalid_code", "That code is not valid.");
    await tx
      .update(users)
      .set({ phoneE164: null, phoneVerifiedAt: null })
      .where(and(eq(users.phoneE164, phone), ne(users.id, row.userId)));
    const [user] = await tx
      .update(users)
      .set({ phoneE164: phone, phoneVerifiedAt: new Date() })
      .where(eq(users.id, row.userId))
      .returning();
    return user;
  });
}

export async function unlinkPhone(db: Db, userId: string): Promise<void> {
  const [user] = await db.select({ phone: users.phoneE164 }).from(users).where(eq(users.id, userId));
  // The bot's saved conversation belongs to whoever held the number.
  if (user?.phone) await db.delete(botState).where(eq(botState.key, `phone:${user.phone}`));
  await db.update(users).set({ phoneE164: null, phoneVerifiedAt: null }).where(eq(users.id, userId));
}

/** Resolve a texter to a user. Unknown phone → `user_not_linked`, and the bot tells them to sign up. */
export async function userForPhone(db: Db, phoneRaw: string): Promise<User> {
  const phone = normalizePhone(phoneRaw);
  const [user] = await db.select().from(users).where(eq(users.phoneE164, phone));
  if (!user || !user.phoneVerifiedAt) {
    throw new AppError("user_not_linked", "This number is not linked to a NEPO account.");
  }
  return user;
}
