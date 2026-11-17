import { AppError } from "@/lib/errors";
import { publicRoute } from "@/server/api/route";
import { safeNext, validateCasTicket } from "@/server/auth/cas";
import { getSession } from "@/server/auth/session";
import { signInNetid } from "@/server/auth/signIn";
import { env } from "@/server/env";

/** Step 2: validate the ticket server-side, upsert the person and user, set the session cookie. */
export const GET = publicRoute(async ({ url, db }) => {
  const next = safeNext(url.searchParams.get("next"));
  const ticket = url.searchParams.get("ticket");
  const base = env().APP_URL;
  if (!ticket) return Response.redirect(`${base}/login?error=cas_failed`, 302);
  let netid: string;
  try {
    // The NetID comes only from the validated CAS response, never from the query string.
    netid = await validateCasTicket(ticket, next);
  } catch (err) {
    if (err instanceof AppError) return Response.redirect(`${base}/login?error=cas_failed`, 302);
    throw err;
  }
  const { user } = await signInNetid(db, netid);
  const session = await getSession();
  session.userId = user.id;
  session.netid = user.netid;
  session.via = "cas";
  await session.save();
  const target = !user.onboardingDoneAt && next === "/" ? "/onboarding" : next;
  return Response.redirect(`${base}${target}`, 302);
});
