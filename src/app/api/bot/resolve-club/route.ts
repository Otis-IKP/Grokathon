import { botRoute, parseBody } from "@/server/api/route";
import { botSchemas } from "@/server/bot/tools";
import { resolveClub, toClubCard } from "@/server/clubs/resolve";


export const POST = botRoute(async ({ req, db }) => {
  const { text } = await parseBody(req, botSchemas.resolve_club);
  const resolved = await resolveClub(db, text);
  return {
    club: resolved.club ? toClubCard(resolved.club) : null,
    candidates: resolved.candidates.map(toClubCard),
    confidence: Math.round(resolved.confidence * 100) / 100,
  };
});
