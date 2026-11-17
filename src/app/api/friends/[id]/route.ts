import { appRoute } from "@/server/api/route";
import { removeFriend } from "@/server/friends/service";

/** Either side may remove a friendship or cancel a request. */
export const DELETE = appRoute(async ({ db, me, params }) => {
  await removeFriend(db, me.person.netid, params.id);
  return { ok: true };
});
