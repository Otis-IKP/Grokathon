import { z } from "zod";
import { botRoute, parseBody } from "@/server/api/route";
import { getBotState } from "@/server/bot/state";
import { botSchemas } from "@/server/bot/tools";

const body = z.object({ phone: botSchemas.whoami.shape.phone });

/** The bot's saved state for one phone, or null. The phone travels in the body, never in the URL. */
export const POST = botRoute(async ({ req, db }) => {
  const { phone } = await parseBody(req, body);
  return { state: await getBotState(db, phone) };
});
