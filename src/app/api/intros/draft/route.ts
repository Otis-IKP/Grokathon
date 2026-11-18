import { z } from "zod";
import { rateLimit } from "@/lib/rateLimit";
import { appRoute, parseBody } from "@/server/api/route";
import { draftIntro } from "@/server/intros/service";

const body = z.object({
  search_id: z.string().uuid(),
  connector_netid: z.string().trim().min(1).max(40),
  tone: z.enum(["casual", "polite"]).optional(),
  note: z.string().trim().max(300).optional(),
});

export const POST = appRoute(async ({ req, db, me }) => {
  await rateLimit(db, `draft:${me.user.id}`, 20, 60_000);
  const input = await parseBody(req, body);
  return draftIntro(db, {
    requesterNetid: me.person.netid,
    searchId: input.search_id,
    connectorNetid: input.connector_netid,
    tone: input.tone,
    note: input.note,
  });
});
