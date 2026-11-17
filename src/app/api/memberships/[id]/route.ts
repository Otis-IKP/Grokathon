import { z } from "zod";
import { appRoute, parseBody } from "@/server/api/route";
import { deleteMyMembership, updateMyMembership } from "@/server/memberships/service";

const year = z.number().int().min(1990).max(2100).nullable().optional();
const patch = z.object({
  role: z.enum(["member", "board", "alum"]).optional(),
  title: z.string().trim().max(120).nullable().optional(),
  start_year: year,
  end_year: year,
});

/** Owner only. */
export const PATCH = appRoute(async ({ req, db, me, params }) => {
  const input = await parseBody(req, patch);
  const m = await updateMyMembership(db, me.person.netid, params.id, {
    role: input.role,
    title: input.title,
    startYear: input.start_year,
    endYear: input.end_year,
  });
  return { id: m.id, status: m.status };
});

/** Owner only. A research-sourced membership is marked rejected so research does not add it again. */
export const DELETE = appRoute(async ({ db, me, params }) => {
  await deleteMyMembership(db, me.person.netid, params.id);
  return { ok: true };
});
