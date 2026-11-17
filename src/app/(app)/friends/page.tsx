import type { Metadata } from "next";
import { Page } from "@/components/app/Page";
import { FriendsTabs } from "@/components/friends/FriendsTabs";
import { pageUser } from "@/server/auth/page";
import { listFriends } from "@/server/friends/service";

export const metadata: Metadata = { title: "Friends" };

export default async function FriendsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { db, me } = await pageUser("/friends");
  const { tab } = await searchParams;
  const { friends, incoming, outgoing } = await listFriends(db, me.viewer);
  const initialTab =
    tab === "find" || tab === "requests" || tab === "friends" ? tab : incoming.length > 0 ? "requests" : "friends";
  return (
    <Page title="Friends" subtitle="Only you can see who you've added.">
      <FriendsTabs
        myNetid={me.person.netid}
        friends={friends}
        incoming={incoming}
        outgoing={outgoing}
        initialTab={initialTab}
      />
    </Page>
  );
}
