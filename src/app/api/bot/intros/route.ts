import { AppError } from "@/lib/errors";
import { botRoute, parseBody } from "@/server/api/route";
import { botSchemas } from "@/server/bot/tools";
import { createIntro } from "@/server/intros/service";
import { userForPhone } from "@/server/me/phone";


/** Record the intro the user decided to send. The backend never sends it. */
export const POST = botRoute(async ({ req, db }) => {
  const input = await parseBody(req, botSchemas.create_intro);
  const user = await userForPhone(db, input.phone);
  const intro = await createIntro(db, {
    requesterNetid: user.netid,
    searchId: input.search_id,
    connectorNetid: input.connector_netid,
    targetNetid: input.target_netid,
    message: input.message,
    channel: "bot",
  });
  return { intro_id: intro.id, status: "drafted", response_url: intro.response_url };
});

/**
 * Listing moved to `POST /api/bot/intros/list` (phone in the body). A phone in
 * a query string ends up in access logs (privacy rule 11), so this is refused.
 */
export const GET = botRoute(async () => {
  throw new AppError("invalid_request", "Use POST /api/bot/intros/list with the phone in the body.");
});
