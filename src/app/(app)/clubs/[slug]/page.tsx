import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { Page, SectionTitle } from "@/components/app/Page";
import { PersonRow, personMeta } from "@/components/app/PersonAvatar";
import { StatusBadge } from "@/components/app/StatusBadge";
import { ClubActions } from "@/components/clubs/ClubActions";
import { AppError } from "@/lib/errors";
import { pageUser } from "@/server/auth/page";
import { getClubBySlug, listClubMembers, type ClubMember } from "@/server/clubs/service";
import { findPaths } from "@/server/paths/findPaths";

function MemberList({ members }: { members: ClubMember[] }) {
  return (
    <ul className="divide-y rounded-2xl border px-4">
      {members.map((m) => (
        <li key={m.person.netid}>
          <PersonRow
            person={m.person}
            detail={[m.title ?? (m.role === "alum" ? "Alum" : null), personMeta(m.person)].filter(Boolean).join(" · ") || "Member"}
            action={<StatusBadge status={m.status} evidenceUrl={m.evidence_url} />}
          />
        </li>
      ))}
    </ul>
  );
}

export default async function ClubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { db, me } = await pageUser(`/clubs/${slug}`);
  let club;
  try {
    club = await getClubBySlug(db, slug);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  const [members, paths] = await Promise.all([
    listClubMembers(db, me.viewer, club.id),
    findPaths(db, me.person.netid, club.id, 50),
  ]);
  const board = members.filter((m) => m.role === "board");
  const rest = members.filter((m) => m.role !== "board");
  const isMember = paths.emptyReason === "already_member";
  const oneHop = paths.results.filter((r) => r.hops === 1).length;
  const twoHop = paths.results.filter((r) => r.hops === 2).length;
  const label = club.shortName?.trim() || club.name;

  return (
    <Page title={club.name} back="/clubs" subtitle={[club.shortName !== club.name ? club.shortName : null, club.category].filter(Boolean).join(" · ")}>
      {club.description ? <p className="text-[0.95rem] leading-relaxed">{club.description}</p> : null}
      {club.website ? (
        <a href={club.website} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary underline underline-offset-4">
          {club.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      ) : null}

      {!isMember ? (
        <p className="mt-3 rounded-xl bg-muted px-4 py-3 text-sm">
          {oneHop + twoHop === 0
            ? "None of your friends connect you to this club yet."
            : `${oneHop} ${oneHop === 1 ? "friend is" : "friends are"} in ${label}${twoHop > 0 ? `, and ${twoHop} more ${twoHop === 1 ? "knows" : "know"} someone who is` : ""}.`}
        </p>
      ) : null}

      <div className="mt-3">
        <ClubActions clubId={club.id} clubLabel={label} isMember={isMember} />
      </div>

      {members.length === 0 ? (
        <EmptyState title="No members known yet" className="mt-6">
          NEPO hasn&apos;t found a public roster for {label}. If you&apos;re a member, tap &ldquo;I&apos;m in this club&rdquo; so friends can find you.
        </EmptyState>
      ) : (
        <>
          {board.length > 0 ? (
            <>
              <SectionTitle>Board</SectionTitle>
              <MemberList members={board} />
            </>
          ) : null}
          {rest.length > 0 ? (
            <>
              <SectionTitle>Members</SectionTitle>
              <MemberList members={rest} />
            </>
          ) : null}
        </>
      )}
    </Page>
  );
}
