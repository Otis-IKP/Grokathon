import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import type { Db } from "@/server/db/client";
import { people, users, type Person, type User } from "@/server/db/schema";
import { env } from "@/server/env";
import type { Viewer } from "@/server/privacy/visibility";
import { getSession } from "./session";

export type CurrentUser = { user: User; person: Person; viewer: Viewer; isAdmin: boolean };

export function isAdminNetid(netid: string): boolean {
  return env().ADMIN_NETIDS.includes(netid.toLowerCase());
}

export async function loadCurrentUser(db: Db, userId: string): Promise<CurrentUser | null> {
  const [row] = await db
    .select({ user: users, person: people })
    .from(users)
    .innerJoin(people, eq(people.netid, users.netid))
    .where(eq(users.id, userId));
  if (!row) return null;
  return {
    user: row.user,
    person: row.person,
    viewer: { netid: row.person.netid, isDemo: row.person.isDemo },
    isAdmin: isAdminNetid(row.person.netid),
  };
}

/** The signed-in user, or null. Reads the encrypted session cookie. */
export async function getCurrentUser(db: Db): Promise<CurrentUser | null> {
  const session = await getSession();
  if (!session.userId) return null;
  return loadCurrentUser(db, session.userId);
}

export async function requireUser(db: Db): Promise<CurrentUser> {
  const me = await getCurrentUser(db);
  if (!me) throw new AppError("unauthenticated", "Sign in with Yale to continue.");
  return me;
}

export async function requireAdmin(db: Db): Promise<CurrentUser> {
  const me = await requireUser(db);
  if (!me.isAdmin) throw new AppError("forbidden", "Admins only.");
  return me;
}

function bearer(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Compare against itself so timing does not reveal the length difference early.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

function requireBearerSecret(req: Request, secret: string | undefined, what: string): void {
  const token = bearer(req);
  if (!secret || !token || !constantTimeEquals(token, secret)) {
    throw new AppError("unauthenticated", `Missing or wrong ${what} bearer token.`);
  }
}

export function requireBot(req: Request): void {
  requireBearerSecret(req, env().BOT_API_SECRET, "bot");
}

export function requireCron(req: Request): void {
  requireBearerSecret(req, env().CRON_SECRET, "cron");
}
