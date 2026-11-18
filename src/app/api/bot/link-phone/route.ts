import { normalizePhone } from "@/lib/phone";
import { rateLimit } from "@/lib/rateLimit";
import { botRoute, parseBody } from "@/server/api/route";
import { botSchemas } from "@/server/bot/tools";
import { linkPhone } from "@/server/me/phone";
import { getPersonCards } from "@/server/people/service";


export const POST = botRoute(async ({ req, db }) => {
  const { phone, code } = await parseBody(req, botSchemas.link_phone);
  // A 6-digit code is guessable, so guesses are counted per phone and overall.
  await rateLimit(db, `link-phone:${normalizePhone(phone)}`, 5, 15 * 60_000);
  await rateLimit(db, "link-phone:all", 60, 60_000);
  const user = await linkPhone(db, phone, code);
  const cards = await getPersonCards(db, [user.netid]);
  return { linked: true, user: cards.get(user.netid) };
});
