import { z } from "zod";
import { rateLimit } from "@/lib/rateLimit";
import { appRoute, parseBody } from "@/server/api/route";
import { submitLinkedinUrl } from "@/server/linkedin/service";

const body = z.object({ url: z.string().trim().min(8).max(300) });

export const POST = appRoute(async ({ req, db, me }) => {
  rateLimit(`linkedin:${me.user.id}`, 6, 10 * 60_000);
  const { url } = await parseBody(req, body);
  return submitLinkedinUrl(db, me.user, url);
});
