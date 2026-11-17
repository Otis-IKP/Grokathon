import { z } from "zod";
import { botRoute, parseBody } from "@/server/api/route";
import { botSchemas } from "@/server/bot/tools";
import { introAction } from "@/server/intros/service";
import { userForPhone } from "@/server/me/phone";

const body = z.object({ phone: botSchemas.whoami.shape.phone });

/** Call after the message goes out, whether the bot sent it or the user confirmed sending it. */
export const POST = botRoute(async ({ req, db, params }) => {
  const { phone } = await parseBody(req, body);
  const user = await userForPhone(db, phone);
  const intro = await introAction(db, params.id, user.netid, "mark_sent");
  return { status: intro.status };
});
