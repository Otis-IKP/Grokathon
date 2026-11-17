import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Page, SectionTitle } from "@/components/app/Page";
import { PersonRow } from "@/components/app/PersonAvatar";
import { IntroStatus, MessageBubble, askLine } from "@/components/intros/IntroParts";
import { IntroRespond } from "@/components/intros/IntroRespond";
import { RequesterActions } from "@/components/intros/RequesterActions";
import { AppError } from "@/lib/errors";
import { pageUser } from "@/server/auth/page";
import { getIntro, type IntroEventView } from "@/server/intros/service";

export const metadata: Metadata = { title: "Intro" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EVENT_LABELS: Record<string, string> = {
  created: "Drafted",
  edited: "Message edited",
  sent: "Sent",
  viewed: "Opened",
  accepted: "Accepted",
  declined: "Answered: not right now",
  completed: "Marked done",
  cancelled: "Cancelled",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function Timeline({ events }: { events: IntroEventView[] }) {
  return (
    <ol className="space-y-3 border-l pl-4">
      {events.map((e, i) => (
        <li key={i} className="relative">
          <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full bg-primary" aria-hidden />
          <div className="text-sm font-medium">
            {EVENT_LABELS[e.type] ?? e.type}
            {e.actor === "you" ? " by you" : ""}
          </div>
          <div className="text-xs text-muted-foreground">{when(e.at)}</div>
        </li>
      ))}
    </ol>
  );
}

export default async function IntroPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, me } = await pageUser(`/intros/${id}`);
  if (!UUID.test(id)) notFound();
  let data;
  try {
    data = await getIntro(db, id, me.person.netid);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  const { intro, events } = data;
  const asRequester = intro.role === "requester";
  const other = asRequester ? intro.connector : intro.requester;

  return (
    <Page
      title={asRequester ? `You asked ${other.first_name}` : `${other.first_name} asked you`}
      back={asRequester ? "/intros?box=outgoing" : "/intros"}
      subtitle={askLine(intro)}
      action={
        <div className="py-2.5">
          <IntroStatus intro={intro} />
        </div>
      }
    >
      <MessageBubble>{intro.message}</MessageBubble>
      {asRequester && intro.status === "declined" ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {other.first_name} can&apos;t help with this one right now. Try another path into{" "}
          <Link href={`/clubs/${intro.club.slug}`} className="underline underline-offset-4">
            {intro.club.short_name ?? intro.club.name}
          </Link>
          .
        </p>
      ) : null}
      {intro.connector_note ? (
        <p className="mt-3 text-sm">
          <span className="text-muted-foreground">Note from {intro.connector.first_name}: </span>
          {intro.connector_note}
        </p>
      ) : null}

      <div className="mt-4">{asRequester ? <RequesterActions intro={intro} /> : <IntroRespond intro={intro} />}</div>

      <SectionTitle>People</SectionTitle>
      <div className="divide-y rounded-2xl border px-4">
        <PersonRow person={intro.requester} detail="Asking" />
        <PersonRow person={intro.connector} detail="Asked to help" />
        {intro.target ? <PersonRow person={intro.target} detail={`In ${intro.club.short_name ?? intro.club.name}`} /> : null}
      </div>

      <SectionTitle>Club</SectionTitle>
      <Link href={`/clubs/${intro.club.slug}`} className="flex min-h-14 items-center rounded-2xl border px-4 font-medium hover:bg-muted">
        {intro.club.name}
      </Link>

      <SectionTitle>Timeline</SectionTitle>
      {events.length === 0 ? <p className="text-sm text-muted-foreground">Nothing has happened yet.</p> : <Timeline events={events} />}
    </Page>
  );
}
