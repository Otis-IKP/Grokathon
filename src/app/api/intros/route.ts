import { z } from "zod";
import { appRoute, parseBody } from "@/server/api/route";
import { createIntro, listIntros } from "@/server/intros/service";

export const GET = appRoute(async ({ db, me, url }) => {
  const box = url.searchParams.get("box") === "outgoing" ? "outgoing" : "incoming";
  return { box, intros: await listIntros(db, me.person.netid, box) };
});

const body = z.object({
  search_id: z.string().uuid(),
  connector_netid: z.string().trim().min(1).max(40),
  target_netid: z.string().trim().max(40).nullable().optional(),
  message: z.string().trim().min(1).max(1000),
});

/** Creates the intro in `drafted`. It reaches the connector's inbox once marked sent. */
export const POST = appRoute(async ({ req, db, me }) => {
  const input = await parseBody(req, body);
  return {
    intro: await createIntro(db, {
      requesterNetid: me.person.netid,
      searchId: input.search_id,
      connectorNetid: input.connector_netid,
      targetNetid: input.target_netid,
      message: input.message,
      channel: "app",
    }),
  };
});
