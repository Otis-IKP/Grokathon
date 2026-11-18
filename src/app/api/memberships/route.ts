import { z } from "zod";
import { rateLimit } from "@/lib/rateLimit";
import { appRoute, parseBody } from "@/server/api/route";
import { createSelfReport, listMyMemberships } from "@/server/memberships/service";

export const GET = appRoute(async ({ db, me }) => ({ memberships: await listMyMemberships(db, me.person.netid) }));

const year = z.number().int().min(1990).max(2100).nullable().optional();
const body = z
  .object({
    club_id: z.string().uuid().optional(),
    club_name: z.string().trim().min(2).max(120).optional(),
    role: z.enum(["member", "board", "alum"]).default("member"),
    title: z.string().trim().max(120).nullable().optional(),
    start_year: year,
    end_year: year,
  })
  .refine((v) => v.club_id || v.club_name, { message: "club_id or club_name is required" });

/** "I'm in this club": creates a self-reported claim and queues validation. */
export const POST = appRoute(async ({ req, db, me }) => {
  const input = await parseBody(req, body);
  // Each claim queues a validation, and a new club name creates a listed club and a crawl.
  await rateLimit(db, `memberships:add:${me.user.id}`, 30, 60 * 60_000);
  if (!input.club_id) await rateLimit(db, `memberships:new-club:${me.user.id}`, 5, 60 * 60_000);
  const m = await createSelfReport(db, me.person.netid, {
    clubId: input.club_id,
    clubName: input.club_name,
    role: input.role,
    title: input.title ?? null,
    startYear: input.start_year ?? null,
    endYear: input.end_year ?? null,
  });
  return { id: m.id, status: m.status, club_id: m.clubId };
});
