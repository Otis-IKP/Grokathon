import { appRoute } from "@/server/api/route";
import { getSearch } from "@/server/paths/service";

/** A previous search, re-ranked if new data arrived. Requester only. */
export const GET = appRoute(async ({ db, me, params }) => getSearch(db, me.person.netid, params.searchId));
