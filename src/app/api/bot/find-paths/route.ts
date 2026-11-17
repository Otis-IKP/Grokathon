import { botRoute, parseBody } from "@/server/api/route";
import { botSchemas } from "@/server/bot/tools";
import { userForPhone } from "@/server/me/phone";
import { clubShort } from "@/server/paths/findPaths";
import { searchPaths } from "@/server/paths/service";


export const POST = botRoute(async ({ req, db }) => {
  const { phone, club_id, limit } = await parseBody(req, botSchemas.find_paths);
  const user = await userForPhone(db, phone);
  const res = await searchPaths(db, { requesterNetid: user.netid, clubId: club_id, channel: "bot", limit: limit ?? 3 });
  return {
    search_id: res.search_id,
    club: {
      id: res.club.id,
      slug: res.club.slug,
      name: res.club.name,
      short_name: res.club.short_name ?? clubShort({ name: res.club.name, shortName: null }),
    },
    results: res.results,
    pending_research: res.pending_research,
    empty_reason: res.empty_reason,
  };
});
