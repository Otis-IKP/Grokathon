import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Page, SectionTitle } from "@/components/app/Page";
import { PersonAvatar } from "@/components/app/PersonAvatar";
import { ClubSearch } from "@/components/home/ClubSearch";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { pageUser } from "@/server/auth/page";
import { friendCounts } from "@/server/friends/service";
import { listIntros } from "@/server/intros/service";
import { recentSearches } from "@/server/paths/service";

export default async function Home() {
  const { db, me } = await pageUser("/");
  const netid = me.person.netid;
  const [friends, recent, incoming] = await Promise.all([
    friendCounts(db, netid),
    recentSearches(db, netid),
    listIntros(db, netid, "incoming"),
  ]);
  const waiting = incoming.filter((i) => i.status === "sent");

  return (
    <Page title="Which club do you want in on?">
      <ClubSearch />

      {!me.user.onboardingDoneAt ? (
        <Link href="/onboarding" className="mt-5 flex min-h-14 items-center gap-3 rounded-2xl border bg-muted/50 px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Finish setting up</span>
            <span className="block text-sm text-muted-foreground">Link your phone, add your clubs and a few friends.</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      ) : null}

      {waiting.length > 0 ? (
        <>
          <SectionTitle>Waiting on you</SectionTitle>
          <ul className="divide-y rounded-2xl border">
            {waiting.map((i) => (
              <li key={i.id}>
                <Link href={`/intros/${i.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-muted">
                  <PersonAvatar person={i.requester} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{i.requester.name} is asking for an intro</span>
                    <span className="block truncate text-sm text-muted-foreground">{i.club.short_name ?? i.club.name}</span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {friends.friends < 5 ? (
        <div className="mt-5 rounded-2xl border p-4">
          <div className="font-medium">
            {friends.friends === 0 ? "Add friends to find a way in" : `You have ${friends.friends} ${friends.friends === 1 ? "friend" : "friends"} on NEPO`}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            NEPO can only route you through people you&apos;ve added. Five or more gives it something to work with.
          </p>
          <Link href="/friends?tab=find" className={cn(buttonVariants({ variant: "outline", size: "tap" }), "mt-3")}>
            Find friends
          </Link>
        </div>
      ) : null}

      <SectionTitle>Recent searches</SectionTitle>
      {recent.length === 0 ? (
        <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Nothing yet. Search for a club above to see who can get you in.
        </p>
      ) : (
        <ul className="divide-y rounded-2xl border">
          {recent.map((s) => (
            <li key={s.search_id}>
              <Link href={`/paths/${s.search_id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-muted">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.club.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {s.result_count === 0 ? "No path yet" : `${s.result_count} ${s.result_count === 1 ? "path" : "paths"}`}
                  </span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
