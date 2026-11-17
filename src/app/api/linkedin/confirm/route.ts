import { z } from "zod";
import { appRoute, parseBody } from "@/server/api/route";
import { confirmLinkedin } from "@/server/linkedin/service";

const body = z.object({ confirm: z.boolean() });

/** After a PDF name mismatch: true writes the held affiliations as claims, false discards them. */
export const POST = appRoute(async ({ req, db, me }) => {
  const { confirm } = await parseBody(req, body);
  return confirmLinkedin(db, me.user, confirm);
});
