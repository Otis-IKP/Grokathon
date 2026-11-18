import { AppError } from "@/lib/errors";
import { botRoute } from "@/server/api/route";
import { getIntroForRequester } from "@/server/intros/service";
import { userForPhone } from "@/server/me/phone";

/** `GET /api/bot/intros/{id}?phone=`: one of the requester's intros, for the bot's draft link and send step. */
export const GET = botRoute(async ({ db, url, params }) => {
  const phone = url.searchParams.get("phone");
  if (!phone) throw new AppError("invalid_request", "phone is required.");
  const user = await userForPhone(db, phone);
  const intro = await getIntroForRequester(db, params.id, user.netid);
  return {
    intro: {
      intro_id: intro.id,
      status: intro.status,
      message: intro.message,
      club: intro.club,
      connector: intro.connector,
      created_at: intro.created_at,
      response_url: intro.response_url,
    },
  };
});
