import { z } from "zod";
import { botRoute, parseBody } from "@/server/api/route";
import { botSchemas } from "@/server/bot/tools";
import { respondToIntroByText } from "@/server/intros/service";
import { userForPhone } from "@/server/me/phone";

const body = z.object({ phone: botSchemas.whoami.shape.phone, decision: z.enum(["accept", "decline"]) });

/**
 * The connector answered YES/NO by text. `phone` is the connector's own linked
 * phone. Already answered (here or in the app) → 409 invalid_state.
 */
export const POST = botRoute(async ({ req, db, params }) => {
  const { phone, decision } = await parseBody(req, body);
  const connector = await userForPhone(db, phone);
  return respondToIntroByText(db, params.id, connector.netid, decision);
});
