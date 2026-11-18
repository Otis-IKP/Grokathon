import { rateLimit } from "@/lib/rateLimit";
import { botRoute, parseBody } from "@/server/api/route";
import { botSchemas } from "@/server/bot/tools";
import { draftIntro } from "@/server/intros/service";
import { userForPhone } from "@/server/me/phone";


export const POST = botRoute(async ({ req, db }) => {
  const input = await parseBody(req, botSchemas.draft_intro);
  const user = await userForPhone(db, input.phone);
  // Each draft is an inline model call.
  await rateLimit(db, `bot:draft:${user.id}`, 20, 10 * 60_000);
  return draftIntro(db, {
    requesterNetid: user.netid,
    searchId: input.search_id,
    connectorNetid: input.connector_netid,
    tone: input.tone,
    note: input.note,
  });
});
