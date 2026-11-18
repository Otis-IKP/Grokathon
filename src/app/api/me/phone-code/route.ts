import { rateLimit } from "@/lib/rateLimit";
import { appRoute } from "@/server/api/route";
import { createPhoneCode } from "@/server/me/phone";

export const POST = appRoute(async ({ db, me }) => {
  await rateLimit(db, `phone-code:${me.user.id}`, 10, 10 * 60_000);
  return createPhoneCode(db, me.user.id);
});
