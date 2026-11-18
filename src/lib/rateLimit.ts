import { createHash } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { rateLimits } from "@/server/db/schema";
import { AppError } from "./errors";

/**
 * Sliding-window limiter kept in Postgres (`rate_limits`), so the limit is
 * shared by every server instance rather than counted separately in each.
 *
 * Hits are counted per fixed window. The estimate for "the last `windowMs`"
 * is this window's count plus the previous window's count weighted by how
 * much of it still overlaps, which avoids a double burst at a window boundary.
 * A refused request still counts.
 *
 * Keys may contain a user id or a phone number, so only a hash is stored.
 */
export async function rateLimit(db: Db, key: string, limit: number, windowMs: number, now = Date.now()): Promise<void> {
  const hashed = createHash("sha256").update(`${windowMs}:${key}`).digest("hex").slice(0, 40);
  const start = Math.floor(now / windowMs) * windowMs;
  const [previous] = await db
    .select({ hits: rateLimits.hits })
    .from(rateLimits)
    .where(and(eq(rateLimits.key, hashed), eq(rateLimits.windowStart, new Date(start - windowMs))));
  const [current] = await db
    .insert(rateLimits)
    .values({ key: hashed, windowStart: new Date(start), hits: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { hits: sql`${rateLimits.hits} + 1` },
    })
    .returning({ hits: rateLimits.hits });
  const overlap = 1 - (now - start) / windowMs;
  if (current.hits + (previous?.hits ?? 0) * overlap > limit) {
    throw new AppError("rate_limited", "Too many requests. Try again in a moment.");
  }
}

/** Remove counters nobody can still be limited by. The longest window in use is one hour. */
export async function sweepRateLimits(db: Db, now = Date.now()): Promise<void> {
  await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(now - 3 * 60 * 60 * 1000)));
}

/** Tests only. */
export async function resetRateLimits(db: Db): Promise<void> {
  await db.delete(rateLimits);
}
