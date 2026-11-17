import { z } from "zod";
import { adminRoute, parseBody } from "@/server/api/route";
import { resolveRosterName } from "@/server/admin/service";

const body = z.object({ netid: z.string().trim().min(1).max(40).nullable() });

/** Attach a roster name to a directory person, or dismiss it with `netid: null`. */
export const POST = adminRoute(async ({ req, db, params }) => {
  const { netid } = await parseBody(req, body);
  return resolveRosterName(db, params.id, netid);
});
