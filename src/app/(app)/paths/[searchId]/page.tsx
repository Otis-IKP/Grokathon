import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Page } from "@/components/app/Page";
import { PathResults } from "@/components/paths/PathResults";
import { AppError } from "@/lib/errors";
import { pageUser } from "@/server/auth/page";
import { getSearch } from "@/server/paths/service";

export const metadata: Metadata = { title: "Your way in" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PathsPage({ params }: { params: Promise<{ searchId: string }> }) {
  const { searchId } = await params;
  const { db, me } = await pageUser(`/paths/${searchId}`);
  if (!UUID.test(searchId)) notFound();
  let search;
  try {
    search = await getSearch(db, me.person.netid, searchId);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  const n = search.results.length;
  return (
    <Page
      title={`Your way into ${search.club.short_name ?? search.club.name}`}
      back="/"
      subtitle={
        <>
          <Link href={`/clubs/${search.club.slug}`} className="underline underline-offset-4">
            {search.club.name}
          </Link>
          {n > 0 ? ` · ${n} ${n === 1 ? "person" : "people"} who can help, best first` : null}
        </>
      }
    >
      <PathResults initial={search} />
    </Page>
  );
}
