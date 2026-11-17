import { appRoute } from "@/server/api/route";
import { listClubs } from "@/server/clubs/service";

export const GET = appRoute(async ({ db, me, url }) => ({
  clubs: await listClubs(db, me.viewer, {
    q: url.searchParams.get("q")?.slice(0, 80) ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
  }),
}));
