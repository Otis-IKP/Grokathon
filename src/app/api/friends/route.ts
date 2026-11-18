import { z } from "zod";
import { rateLimit } from "@/lib/rateLimit";
import { appRoute, parseBody } from "@/server/api/route";
import { addFriend, listFriends } from "@/server/friends/service";

export const GET = appRoute(async ({ db, me }) => listFriends(db, me.viewer));

const body = z.object({ netid: z.string().trim().min(1).max(40) });

export const POST = appRoute(async ({ req, db, me }) => {
  // Adding a non-user queues a research job, so adds are capped.
  await rateLimit(db, `friends:add:${me.user.id}`, 40, 60 * 60_000);
  const { netid } = await parseBody(req, body);
  return addFriend(db, me.viewer, netid);
});
