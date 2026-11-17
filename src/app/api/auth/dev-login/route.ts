import { z } from "zod";
import { AppError } from "@/lib/errors";
import { parseBody, publicRoute } from "@/server/api/route";
import { safeNext } from "@/server/auth/cas";
import { getSession } from "@/server/auth/session";
import { signInNetid } from "@/server/auth/signIn";
import { env } from "@/server/env";

const body = z.object({
  netid: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{2,32}$/, "NetIDs are letters, digits and underscores."),
  next: z.string().optional(),
});

/** "Sign in as NetID" without CAS. Local development only; always refused in production. */
export const POST = publicRoute(async ({ req, db }) => {
  if (!env().DEV_LOGIN_ENABLED) throw new AppError("dev_login_disabled", "Dev login is disabled.");
  const { netid, next } = await parseBody(req, body);
  const { user } = await signInNetid(db, netid);
  const session = await getSession();
  session.userId = user.id;
  session.netid = user.netid;
  session.via = "dev";
  await session.save();
  const target = safeNext(next);
  return { ok: true, redirect: !user.onboardingDoneAt && target === "/" ? "/onboarding" : target };
});
