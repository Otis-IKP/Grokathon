import { z } from "zod";
import { botRoute, parseBody } from "@/server/api/route";
import { botSchemas } from "@/server/bot/tools";
import { botIntroView } from "@/server/bot/views";
import { getIntroForRequester } from "@/server/intros/service";
import { userForPhone } from "@/server/me/phone";

const body = z.object({ phone: botSchemas.whoami.shape.phone });

/**
 * One of the requester's intros, for the bot's draft link and send step. Same
 * answer as `GET /api/bot/intros/{id}?phone=`, but the phone is in the body so
 * it never appears in a URL or an access log.
 */
export const POST = botRoute(async ({ req, db, params }) => {
  const { phone } = await parseBody(req, body);
  const user = await userForPhone(db, phone);
  return { intro: botIntroView(await getIntroForRequester(db, params.id, user.netid)) };
});
