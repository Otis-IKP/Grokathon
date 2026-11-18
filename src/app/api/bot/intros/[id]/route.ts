import { AppError } from "@/lib/errors";
import { botRoute } from "@/server/api/route";

/**
 * Reading an intro moved to `POST /api/bot/intros/{id}/read`, which takes the
 * phone in the body. A phone in a query string ends up in access logs
 * (privacy rule 11), so the old form is refused rather than served.
 */
export const GET = botRoute(async () => {
  throw new AppError("invalid_request", "Use POST /api/bot/intros/{id}/read with the phone in the body.");
});
