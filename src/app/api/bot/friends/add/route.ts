import { normalizeName } from "@/lib/names";
import { botRoute, parseBody } from "@/server/api/route";
import { botSchemas } from "@/server/bot/tools";
import { loadCurrentUser } from "@/server/auth/guards";
import { addFriend } from "@/server/friends/service";
import { userForPhone } from "@/server/me/phone";
import { searchDirectory } from "@/server/people/service";


/**
 * Directory matches for a name. With `confirm: true` and exactly one strong
 * match (the only result, or the only exact-name result), the request is created.
 */
export const POST = botRoute(async ({ req, db }) => {
  const { phone, query, confirm } = await parseBody(req, botSchemas.add_friend);
  const user = await userForPhone(db, phone);
  const me = (await loadCurrentUser(db, user.id))!;
  const matches = await searchDirectory(db, me.viewer, query, 5);
  const exact = matches.filter((m) => normalizeName(m.name) === normalizeName(query));
  const strong = matches.length === 1 ? matches[0] : exact.length === 1 ? exact[0] : null;
  if (confirm && strong) {
    const res = await addFriend(db, me.viewer, strong.netid);
    return { matches, created: true, friendship: res };
  }
  return { matches, created: false, strong_match: strong };
});
