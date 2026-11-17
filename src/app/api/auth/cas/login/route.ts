import { publicRoute } from "@/server/api/route";
import { casLoginUrl, safeNext } from "@/server/auth/cas";

/** Step 1 of CAS sign-in: redirect to Yale with our service URL. */
export const GET = publicRoute(async ({ url }) => {
  return Response.redirect(casLoginUrl(safeNext(url.searchParams.get("next"))), 302);
});
