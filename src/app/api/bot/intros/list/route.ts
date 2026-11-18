import { botRoute, parseBody } from "@/server/api/route";
import { botSchemas } from "@/server/bot/tools";
import { botIntroListItem } from "@/server/bot/views";
import { recentIntrosForRequester } from "@/server/intros/service";
import { userForPhone } from "@/server/me/phone";

/** The user's recent intros, for "did Jordan reply?". The phone is in the body, never in the URL. */
export const POST = botRoute(async ({ req, db }) => {
  const { phone } = await parseBody(req, botSchemas.list_intros);
  const user = await userForPhone(db, phone);
  return { intros: (await recentIntrosForRequester(db, user.netid)).map(botIntroListItem) };
});
