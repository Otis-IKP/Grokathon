import { botRoute, parseBody } from "@/server/api/route";
import { botSchemas } from "@/server/bot/tools";
import { linkPhone } from "@/server/me/phone";
import { getPersonCards } from "@/server/people/service";


export const POST = botRoute(async ({ req, db }) => {
  const { phone, code } = await parseBody(req, botSchemas.link_phone);
  const user = await linkPhone(db, phone, code);
  const cards = await getPersonCards(db, [user.netid]);
  return { linked: true, user: cards.get(user.netid) };
});
