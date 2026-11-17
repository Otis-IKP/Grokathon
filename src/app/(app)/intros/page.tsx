import type { Metadata } from "next";
import Link from "next/link";
import { Inbox, Send } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { Page } from "@/components/app/Page";
import { IncomingIntroCard, OutgoingIntroCard } from "@/components/intros/IntroParts";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { pageUser } from "@/server/auth/page";
import { listIntros } from "@/server/intros/service";

export const metadata: Metadata = { title: "Intros" };

export default async function IntrosPage({ searchParams }: { searchParams: Promise<{ box?: string }> }) {
  const { box: rawBox } = await searchParams;
  const box = rawBox === "outgoing" ? "outgoing" : "incoming";
  const { db, me } = await pageUser(`/intros${box === "outgoing" ? "?box=outgoing" : ""}`);
  const intros = await listIntros(db, me.person.netid, box);

  return (
    <Page title="Intros">
      <nav aria-label="Intro boxes" className="flex rounded-xl bg-muted p-1">
        {(
          [
            ["incoming", "Incoming", "/intros"],
            ["outgoing", "Outgoing", "/intros?box=outgoing"],
          ] as const
        ).map(([key, label, href]) => (
          <Link
            key={key}
            href={href}
            aria-current={box === key ? "page" : undefined}
            className={cn(
              "flex h-10 flex-1 items-center justify-center rounded-lg text-sm font-medium",
              box === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      <div className="mt-4 space-y-3">
        {intros.length === 0 && box === "incoming" ? (
          <EmptyState icon={<Inbox />} title="No one has asked you yet">
            When a friend asks you for an intro through NEPO, it shows up here. You can always say no.
          </EmptyState>
        ) : null}
        {intros.length === 0 && box === "outgoing" ? (
          <EmptyState
            icon={<Send />}
            title="You haven't asked anyone yet"
            action={
              <Link href="/" className={cn(buttonVariants({ size: "tap" }))}>
                Pick a club
              </Link>
            }
          >
            Search for a club, choose a friend who can help, and NEPO drafts the ask.
          </EmptyState>
        ) : null}
        {intros.map((intro) =>
          box === "incoming" ? <IncomingIntroCard key={intro.id} intro={intro} /> : <OutgoingIntroCard key={intro.id} intro={intro} />,
        )}
      </div>
    </Page>
  );
}
