import { z } from "zod";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rateLimit";
import { appRoute, parseBody } from "@/server/api/route";
import { resolveClub, toClubCard } from "@/server/clubs/resolve";
import { searchPaths } from "@/server/paths/service";

const body = z
  .object({
    club_id: z.string().uuid().optional(),
    club_text: z.string().trim().min(1).max(120).optional(),
    limit: z.number().int().min(1).max(10).optional(),
  })
  .refine((v) => v.club_id || v.club_text, { message: "club_id or club_text is required" });

export const POST = appRoute(async ({ req, db, me }) => {
  rateLimit(`paths:${me.user.id}`, 30, 60_000);
  const input = await parseBody(req, body);
  let clubId = input.club_id;
  if (!clubId) {
    const resolved = await resolveClub(db, input.club_text!);
    if (!resolved.club) {
      throw new AppError("club_not_found", "We couldn't tell which club you meant.", {
        candidates: resolved.candidates.map(toClubCard),
      });
    }
    clubId = resolved.club.id;
  }
  return searchPaths(db, { requesterNetid: me.person.netid, clubId, channel: "app", limit: input.limit ?? 5 });
});
