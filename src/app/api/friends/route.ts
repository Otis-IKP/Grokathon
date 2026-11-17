import { z } from "zod";
import { appRoute, parseBody } from "@/server/api/route";
import { addFriend, listFriends } from "@/server/friends/service";

export const GET = appRoute(async ({ db, me }) => listFriends(db, me.viewer));

const body = z.object({ netid: z.string().trim().min(1).max(40) });

export const POST = appRoute(async ({ req, db, me }) => {
  const { netid } = await parseBody(req, body);
  return addFriend(db, me.viewer, netid);
});
