import { appRoute } from "@/server/api/route";
import { unlinkPhone } from "@/server/me/phone";

export const DELETE = appRoute(async ({ db, me }) => {
  await unlinkPhone(db, me.user.id);
  return { ok: true };
});
