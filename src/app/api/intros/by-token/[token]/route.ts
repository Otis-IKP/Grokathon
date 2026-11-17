import { appRoute } from "@/server/api/route";
import { getIntroByToken } from "@/server/intros/service";

/** For /i/{token}. Requires sign-in, and the signed-in NetID must be the connector. */
export const GET = appRoute(async ({ db, me, params }) => getIntroByToken(db, params.token, me.person.netid));
