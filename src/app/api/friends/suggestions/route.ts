import { appRoute } from "@/server/api/route";
import { friendSuggestions } from "@/server/friends/service";

/** "People you may know": members of my clubs, then my college and class year. */
export const GET = appRoute(async ({ db, me }) => ({
  suggestions: await friendSuggestions(db, me.viewer, me.person),
}));
