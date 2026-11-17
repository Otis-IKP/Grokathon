import { appRoute } from "@/server/api/route";
import { respondToFriendRequest } from "@/server/friends/service";

export const POST = appRoute(async ({ db, me, params }) => {
  const f = await respondToFriendRequest(db, me.person.netid, params.id, "decline");
  return { friendship_id: f.id, status: f.status };
});
