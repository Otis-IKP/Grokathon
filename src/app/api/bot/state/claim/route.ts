import { z } from "zod";
import { botRoute, parseBody } from "@/server/api/route";
import { claimOnce, releaseClaim } from "@/server/bot/state";

const body = z.object({ key: z.string().trim().min(1).max(200), release: z.boolean().optional() });

/**
 * Claim a key once across every bot instance: `claimed` is true only for the
 * first caller. Used so a webhook delivered twice is handled once.
 * `release: true` gives the key back after a failure so a retry can run.
 */
export const POST = botRoute(async ({ req, db }) => {
  const { key, release } = await parseBody(req, body);
  if (release) {
    await releaseClaim(db, key);
    return { claimed: false };
  }
  return { claimed: await claimOnce(db, key) };
});
