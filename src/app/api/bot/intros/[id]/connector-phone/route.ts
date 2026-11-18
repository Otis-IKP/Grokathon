import { z } from "zod";
import { botRoute, parseBody } from "@/server/api/route";
import { botSchemas } from "@/server/bot/tools";
import { connectorPhoneForRequester } from "@/server/intros/service";
import { userForPhone } from "@/server/me/phone";

const body = z.object({ phone: botSchemas.whoami.shape.phone });

/**
 * The connector's phone, so the bot can text the intro for the requester. Null
 * unless the connector is a NEPO user who linked that phone themselves; see
 * connectorPhoneForRequester. Bot secret only; never part of the bot's model tools.
 */
export const POST = botRoute(async ({ req, db, params }) => {
  const { phone } = await parseBody(req, body);
  const user = await userForPhone(db, phone);
  return { phone: await connectorPhoneForRequester(db, params.id, user.netid) };
});
