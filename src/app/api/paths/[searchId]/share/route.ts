import { appRoute } from "@/server/api/route";
import { createShare } from "@/server/paths/service";

/** Requester only. A 24-hour token for the public graph endpoint. */
export const POST = appRoute(async ({ db, me, params }) => createShare(db, me.person.netid, params.searchId));
