import { botRoute, parseBody } from "@/server/api/route";
import { botSchemas } from "@/server/bot/tools";
import { draftIntro } from "@/server/intros/service";
import { userForPhone } from "@/server/me/phone";


export const POST = botRoute(async ({ req, db }) => {
  const input = await parseBody(req, botSchemas.draft_intro);
  const user = await userForPhone(db, input.phone);
  return draftIntro(db, {
    requesterNetid: user.netid,
    searchId: input.search_id,
    connectorNetid: input.connector_netid,
    tone: input.tone,
    note: input.note,
  });
});
