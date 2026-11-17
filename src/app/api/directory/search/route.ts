import { rateLimit } from "@/lib/rateLimit";
import { appRoute } from "@/server/api/route";
import { friendStates } from "@/server/friends/service";
import { searchDirectory } from "@/server/people/service";

/** Find Yale people to add. Rate limit: 30 per minute per user. */
export const GET = appRoute(async ({ db, me, url }) => {
  rateLimit(`directory:${me.user.id}`, 30, 60_000);
  const q = (url.searchParams.get("q") ?? "").slice(0, 80);
  const people = await searchDirectory(db, me.viewer, q, 20);
  const states = await friendStates(
    db,
    me.person.netid,
    people.map((p) => p.netid),
  );
  return { results: people.map((person) => ({ person, friendship: states.get(person.netid) ?? "none" })) };
});
