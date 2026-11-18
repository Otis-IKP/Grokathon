import { z } from "zod";
import { botRoute, parseBody } from "@/server/api/route";
import { toClubCard } from "@/server/clubs/resolve";
import { getClubById } from "@/server/clubs/service";

const body = z.object({ club_id: z.string().uuid() });

/** Public club details for the bot's get_club_info tool. */
export const POST = botRoute(async ({ req, db }) => {
  const { club_id } = await parseBody(req, body);
  const club = await getClubById(db, club_id);
  return { club: toClubCard(club), description: club.description };
});
