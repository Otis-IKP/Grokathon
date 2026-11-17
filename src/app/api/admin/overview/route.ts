import { adminRoute } from "@/server/api/route";
import { listUnmatchedNames, listUnreviewedClubs } from "@/server/admin/service";

/** Clubs awaiting review and roster names nobody could be matched to. */
export const GET = adminRoute(async ({ db }) => ({
  unreviewed_clubs: await listUnreviewedClubs(db),
  unmatched_names: await listUnmatchedNames(db),
}));
