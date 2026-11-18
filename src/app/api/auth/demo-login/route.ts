import { z } from "zod";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rateLimit";
import { parseBody, publicRoute } from "@/server/api/route";
import { safeNext } from "@/server/auth/cas";
import { demoLoginCode, isDemoAccount } from "@/server/auth/demo";
import { constantTimeEquals } from "@/server/auth/guards";
import { getSession } from "@/server/auth/session";
import { signInNetid } from "@/server/auth/signIn";

const body = z.object({
  netid: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{2,32}$/),
  code: z.string().trim().min(1).max(200),
  next: z.string().optional(),
});

/**
 * Sign in as a seeded demo account with the demo code, without CAS. Works on a
 * deployed app, unlike dev login. Off unless DEMO_LOGIN_CODE is set; a wrong
 * code and a NetID that is not a demo account get the same answer.
 */
export const POST = publicRoute(async ({ req, db }) => {
  const expected = demoLoginCode();
  if (!expected) throw new AppError("demo_login_disabled", "Demo sign-in is not available.");
  const { netid, code, next } = await parseBody(req, body);
  // The code is the only thing between a visitor and the demo accounts, so guesses are capped
  // per caller and overall (counted in the database, across every server instance).
  const caller = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  await rateLimit(db, `demo-login:${caller}`, 8, 10 * 60_000);
  await rateLimit(db, "demo-login:all", 60, 10 * 60_000);
  const allowed = constantTimeEquals(code, expected) && (await isDemoAccount(db, netid));
  if (!allowed) throw new AppError("forbidden", "That demo code or account isn't right.");

  const { user } = await signInNetid(db, netid);
  const session = await getSession();
  session.userId = user.id;
  session.netid = user.netid;
  session.via = "dev"; // signing out returns to the sign-in page, not to Yale's logout
  await session.save();
  const target = safeNext(next);
  return { ok: true, redirect: !user.onboardingDoneAt && target === "/" ? "/onboarding" : target };
});
