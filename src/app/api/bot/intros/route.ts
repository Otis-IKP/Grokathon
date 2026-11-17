import { AppError } from "@/lib/errors";
import { botRoute, parseBody } from "@/server/api/route";
import { botSchemas } from "@/server/bot/tools";
import { createIntro, recentIntrosForRequester } from "@/server/intros/service";
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

/** `GET /api/bot/intros?phone=`: the user's recent intros, for "did Jordan reply?". */
export const GET = botRoute(async ({ db, url }) => {
  const phone = url.searchParams.get("phone");
  if (!phone) throw new AppError("invalid_request", "phone is required.");
  const user = await userForPhone(db, phone);
  const intros = await recentIntrosForRequester(db, user.netid);
  return {
    intros: intros.map((i) => ({
      intro_id: i.id,
      status: i.status,
      status_label: i.status_label,
      club: i.club,
      connector: i.connector,
      target: i.target,
      message: i.message,
      created_at: i.created_at,
      sent_at: i.sent_at,
      responded_at: i.responded_at,
    })),
  };
});
