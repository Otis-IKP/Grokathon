import Link from "next/link";
import { PersonAvatar } from "@/components/app/PersonAvatar";
import { cn } from "@/lib/utils";
import type { IntroView } from "@/server/intros/service";
import { IntroRespond } from "./IntroRespond";

const STATUS_STYLE: Record<string, string> = {
  accepted: "bg-success-soft text-success",
  completed: "bg-success-soft text-success",
  sent: "bg-warning-soft text-warning",
};

export function IntroStatus({ intro }: { intro: Pick<IntroView, "status" | "status_label"> }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap",
        STATUS_STYLE[intro.status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {intro.status_label}
    </span>
  );
}

/** One sentence saying what is being asked. */
export function askLine(intro: IntroView): string {
  const club = intro.club.short_name ?? intro.club.name;
  return intro.target ? `An intro to ${intro.target.name} in ${club}` : `A chat about ${club}`;
}

export function MessageBubble({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("rounded-2xl bg-muted px-4 py-3 text-[0.95rem] leading-relaxed whitespace-pre-wrap", className)}>{children}</p>;
}

/** Incoming request: who is asking, which club, the message, Accept and Decline. */
export function IncomingIntroCard({ intro, linkToDetail = true }: { intro: IntroView; linkToDetail?: boolean }) {
  return (
    <div className="rounded-2xl border p-4">
      <div className="flex items-center gap-3">
        <PersonAvatar person={intro.requester} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{intro.requester.name}</div>
          <div className="truncate text-sm text-muted-foreground">{askLine(intro)}</div>
        </div>
        {intro.status !== "sent" && intro.status !== "drafted" ? <IntroStatus intro={intro} /> : null}
      </div>
      <MessageBubble className="mt-3">{intro.message}</MessageBubble>
      <div className="mt-3">
        <IntroRespond intro={intro} />
      </div>
      {linkToDetail ? (
        <Link href={`/intros/${intro.id}`} className="mt-1 flex min-h-11 items-center justify-center text-sm text-muted-foreground underline underline-offset-4">
          Details
        </Link>
      ) : null}
    </div>
  );
}

export function OutgoingIntroCard({ intro }: { intro: IntroView }) {
  return (
    <Link href={`/intros/${intro.id}`} className="block rounded-2xl border p-4 hover:bg-muted/50">
      <div className="flex items-center gap-3">
        <PersonAvatar person={intro.connector} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">You asked {intro.connector.name}</div>
          <div className="truncate text-sm text-muted-foreground">{askLine(intro)}</div>
        </div>
        <IntroStatus intro={intro} />
      </div>
      <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{intro.message}</p>
    </Link>
  );
}
