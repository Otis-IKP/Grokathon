import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { Page } from "@/components/app/Page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { pageUser } from "@/server/auth/page";
import { CLUB_CATEGORIES, listClubs } from "@/server/clubs/service";

export const metadata: Metadata = { title: "Clubs" };

export default async function ClubsPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  const params = await searchParams;
  const { db, me } = await pageUser("/clubs");
  const q = params.q?.trim().slice(0, 80) || undefined;
  const category = (CLUB_CATEGORIES as readonly string[]).includes(params.category ?? "") ? params.category : undefined;
  const clubs = await listClubs(db, me.viewer, { q, category });
  const href = (cat?: string) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (cat) sp.set("category", cat);
    const s = sp.toString();
    return s ? `/clubs?${s}` : "/clubs";
  };

  return (
    <Page title="Clubs">
      <form action="/clubs" role="search" className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" name="q" defaultValue={q ?? ""} aria-label="Search clubs" placeholder="Search clubs" className="h-11 rounded-xl pl-9" />
        </div>
        {category ? <input type="hidden" name="category" value={category} /> : null}
        <Button type="submit" size="tap" variant="outline">
          Search
        </Button>
      </form>

      <nav aria-label="Categories" className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
        {[undefined, ...CLUB_CATEGORIES].map((cat) => {
          const active = cat === category;
          return (
            <Link
              key={cat ?? "all"}
              href={href(cat)}
              aria-current={active ? "true" : undefined}
              className={cn(
                "flex h-11 shrink-0 items-center rounded-full border px-4 text-sm font-medium capitalize",
                active ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {cat ?? "All"}
            </Link>
          );
        })}
      </nav>

      {clubs.length === 0 ? (
        <EmptyState title="No clubs match" className="mt-4" action={<Link href="/clubs" className="font-medium text-primary underline underline-offset-4">Show all clubs</Link>}>
          Try the full name or initials. If you&apos;re in a club that isn&apos;t listed, add it from Me and it will show up here.
        </EmptyState>
      ) : (
        <ul className="mt-4 divide-y rounded-2xl border">
          {clubs.map((c) => (
            <li key={c.id}>
              <Link href={`/clubs/${c.slug}`} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-muted">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {[c.short_name !== c.name ? c.short_name : null, c.category, `${c.member_count} known ${c.member_count === 1 ? "member" : "members"}`]
                      .filter(Boolean)
                      .join(" · ")}
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
