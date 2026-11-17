import type { Metadata } from "next";
import { ClubsPanel } from "@/components/admin/ClubsPanel";
import { JobsPanel } from "@/components/admin/JobsPanel";
import { RosterNamesPanel } from "@/components/admin/RosterNamesPanel";
import { Page, SectionTitle } from "@/components/app/Page";
import { listJobs, listUnmatchedNames, listUnreviewedClubs } from "@/server/admin/service";
import { pageAdmin } from "@/server/auth/page";

export const metadata: Metadata = { title: "Admin" };

const STATUSES = ["queued", "running", "done", "failed"];

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { db } = await pageAdmin("/admin");
  const { status } = await searchParams;
  const filter = status && STATUSES.includes(status) ? status : null;
  const [jobs, unreviewed, names] = await Promise.all([
    listJobs(db, { status: filter ?? undefined }),
    listUnreviewedClubs(db),
    listUnmatchedNames(db),
  ]);
  return (
    <Page title="Admin" back="/me">
      <SectionTitle className="mt-0">Job queue</SectionTitle>
      <JobsPanel counts={jobs.counts} jobs={jobs.jobs} filter={filter} />

      <SectionTitle>Clubs</SectionTitle>
      <ClubsPanel unreviewed={unreviewed} />

      <SectionTitle>Unmatched roster names</SectionTitle>
      <RosterNamesPanel names={names} />
    </Page>
  );
}
