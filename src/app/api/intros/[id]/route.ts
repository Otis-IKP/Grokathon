import { z } from "zod";
import { appRoute, parseBody } from "@/server/api/route";
import { editIntroMessage, getIntro, introAction } from "@/server/intros/service";

/** Requester or connector only. */
export const GET = appRoute(async ({ db, me, params }) => getIntro(db, params.id, me.person.netid));

const patch = z
  .object({
    message: z.string().trim().min(1).max(1000).optional(),
    action: z.enum(["mark_sent", "cancel", "complete"]).optional(),
  })
  .refine((v) => v.message || v.action, { message: "message or action is required" });

/** Requester: edit the message while drafted; mark_sent, cancel or complete. */
export const PATCH = appRoute(async ({ req, db, me, params }) => {
  const input = await parseBody(req, patch);
  let intro;
  if (input.message) intro = await editIntroMessage(db, params.id, me.person.netid, input.message);
  if (input.action) intro = await introAction(db, params.id, me.person.netid, input.action);
  return { intro };
});
