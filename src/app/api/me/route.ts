import { z } from "zod";
import { appRoute, parseBody } from "@/server/api/route";
import { getSession } from "@/server/auth/session";
import { deleteAccount, getMe, updateMe } from "@/server/me/service";

export const GET = appRoute(async ({ db, me }) => getMe(db, me));

const patch = z.object({
  preferred_name: z.string().trim().max(60).nullable().optional(),
  first_name: z.string().trim().min(1).max(60).optional(),
  last_name: z.string().trim().min(1).max(60).optional(),
  allow_as_connector: z.boolean().optional(),
  share_connections: z.boolean().optional(),
  visibility: z.enum(["listed", "hidden"]).optional(),
  onboarding_done: z.boolean().optional(),
});

export const PATCH = appRoute(async ({ req, db, me }) => {
  await updateMe(db, me, await parseBody(req, patch));
  return { ok: true };
});

/** Delete account (privacy rule 12). */
export const DELETE = appRoute(async ({ db, me }) => {
  await deleteAccount(db, me);
  (await getSession()).destroy();
  return { ok: true };
});
