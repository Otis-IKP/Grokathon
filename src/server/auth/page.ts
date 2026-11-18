import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getDb, type Db } from "@/server/db/client";
import { getCurrentUser, type CurrentUser } from "./guards";

/**
 * For server components: the signed-in user and a db handle, or a redirect
 * to /login that comes back to `next` afterwards.
 */
export async function pageUser(next: string): Promise<{ db: Db; me: CurrentUser }> {
  // Every signed-in page is per-request. Without this, `next build` tries to
  // prerender them and opens the database at build time.
  await connection();
  const db = getDb();
  const me = await getCurrentUser(db);
  if (!me) redirect(`/login?next=${encodeURIComponent(next)}`);
  return { db, me };
}

export async function pageAdmin(next: string): Promise<{ db: Db; me: CurrentUser }> {
  const ctx = await pageUser(next);
  if (!ctx.me.isAdmin) redirect("/");
  return ctx;
}
