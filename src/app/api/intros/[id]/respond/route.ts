import { z } from "zod";
import { appRoute, parseBody } from "@/server/api/route";
import { respondToIntro } from "@/server/intros/service";

const body = z.object({ decision: z.enum(["accept", "decline"]), note: z.string().trim().max(500).optional() });

/** Connector only. Declining needs no reason. */
export const POST = appRoute(async ({ req, db, me, params }) => {
  const { decision, note } = await parseBody(req, body);
  return { intro: await respondToIntro(db, params.id, me.person.netid, decision, note) };
});
