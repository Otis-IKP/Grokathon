import { TabBar } from "@/components/app/TabBar";
import { pageUser } from "@/server/auth/page";
import { friendCounts } from "@/server/friends/service";
import { introCounts } from "@/server/intros/service";

/**
 * Authenticated shell. Everything under (app) requires a CAS session
 * (privacy rule 1): without one, `pageUser` redirects to /login.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { db, me } = await pageUser("/");
  const [friends, intros] = await Promise.all([
    friendCounts(db, me.person.netid),
    introCounts(db, me.person.netid),
  ]);
  return (
    <div className="mx-auto min-h-dvh w-full max-w-[480px] pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))]">
      <main>{children}</main>
      <TabBar badges={{ friends: friends.pending_requests, intros: intros.inbox }} />
    </div>
  );
}
