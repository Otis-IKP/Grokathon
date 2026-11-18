import { z } from "zod";
import { AppError } from "@/lib/errors";
import { botRoute, parseBody } from "@/server/api/route";
import { putBotState } from "@/server/bot/state";
import { botSchemas } from "@/server/bot/tools";

const MAX_STATE_BYTES = 400_000;
const body = z.object({ phone: botSchemas.whoami.shape.phone, state: z.record(z.string(), z.unknown()).nullable() });

/** Save (or with `state: null`, forget) the bot's state for one phone. */
export const POST = botRoute(async ({ req, db }) => {
  const { phone, state } = await parseBody(req, body);
  if (state && JSON.stringify(state).length > MAX_STATE_BYTES) {
    throw new AppError("invalid_request", "state is too large.");
  }
  await putBotState(db, phone, state);
  return { ok: true };
});
