import { publicRoute } from "@/server/api/route";
import { casLogoutUrl } from "@/server/auth/cas";
import { getSession } from "@/server/auth/session";
import { env } from "@/server/env";

/** Clear the cookie, then send CAS sessions on to Yale's logout. */
async function logout() {
  const session = await getSession();
  const viaCas = session.via !== "dev";
  session.destroy();
  return Response.redirect(viaCas ? casLogoutUrl() : `${env().APP_URL}/login`, 303);
}

// POST only: a GET would let any page sign the visitor out with an image tag.
export const POST = publicRoute(logout);
