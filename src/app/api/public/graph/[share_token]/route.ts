import { publicRoute } from "@/server/api/route";
import { env } from "@/server/env";
import { graphForToken } from "@/server/paths/service";

/** CORS for Arden's site only. Without WEBSITE_ORIGIN no cross-origin access is granted. */
function cors(req: Request): HeadersInit | undefined {
  const allowed = env().WEBSITE_ORIGIN;
  const origin = req.headers.get("origin");
  if (!allowed || !origin) return undefined;
  // The site is served on both the bare domain and www.
  const twin = allowed.includes("://www.") ? allowed.replace("://www.", "://") : allowed.replace("://", "://www.");
  if (origin !== allowed && origin !== twin) return undefined;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

/**
 * The one unauthenticated data endpoint: the graph for a single path search,
 * gated by a 24-hour share token the requester created. First names and last
 * initials only; no NetIDs.
 */
export const GET = publicRoute(async ({ db, params }) => graphForToken(db, params.share_token), { headers: cors });

export const OPTIONS = publicRoute(async () => new Response(null, { status: 204 }), { headers: cors });
