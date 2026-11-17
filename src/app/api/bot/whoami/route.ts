import { botRoute, parseBody } from "@/server/api/route";
import { botSchemas } from "@/server/bot/tools";
import { friendCounts } from "@/server/friends/service";
import { userForPhone } from "@/server/me/phone";
import { listMyMemberships } from "@/server/memberships/service";
import { getPersonCards } from "@/server/people/service";


export const POST = botRoute(async ({ req, db }) => {
  const { phone } = await parseBody(req, botSchemas.whoami);
  const user = await userForPhone(db, phone);
  const cards = await getPersonCards(db, [user.netid]);
  const counts = await friendCounts(db, user.netid);
  const clubs = (await listMyMemberships(db, user.netid))
    .filter((m) => m.status !== "disputed")
    .map((m) => ({ name: m.club.name, role: m.title ?? m.role }));
  return {
    user: cards.get(user.netid),
    friends_count: counts.friends,
    clubs,
    onboarding_done: Boolean(user.onboardingDoneAt),
  };
});
