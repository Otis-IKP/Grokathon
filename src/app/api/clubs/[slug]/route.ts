import { appRoute } from "@/server/api/route";
import { clubDetailCard, getClubBySlug, listClubMembers } from "@/server/clubs/service";
import { findPaths } from "@/server/paths/findPaths";

export const GET = appRoute(async ({ db, me, params }) => {
  const club = await getClubBySlug(db, params.slug);
  const members = await listClubMembers(db, me.viewer, club.id);
  const paths = await findPaths(db, me.person.netid, club.id, 50);
  return {
    club: clubDetailCard(club),
    board: members.filter((m) => m.role === "board"),
    members: members.filter((m) => m.role !== "board"),
    i_am_member: paths.emptyReason === "already_member",
    my_paths_preview: {
      one_hop: paths.results.filter((r) => r.hops === 1).length,
      two_hop: paths.results.filter((r) => r.hops === 2).length,
    },
  };
});
