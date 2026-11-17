"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PersonRow, personMeta, type PersonCardLike } from "@/components/app/PersonAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";

export type UnmatchedName = {
  id: string;
  full_name: string;
  role_title: string | null;
  source_url: string | null;
  club: { name: string; short_name: string | null };
};

/** Directory picker for one roster name: search, then pick the person it refers to. */
function Picker({ row, onDone }: { row: UnmatchedName; onDone: () => void }) {
  const [q, setQ] = useState(row.full_name);
  const [results, setResults] = useState<PersonCardLike[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const term = q.trim();
    const run = ++latest.current;
    if (term.length < 2) return;
    const timer = setTimeout(async () => {
      try {
        const res = await api<{ results: { person: PersonCardLike }[] }>(
          `/api/directory/search?q=${encodeURIComponent(term)}`,
        );
        if (run === latest.current) {
          setResults(res.results.map((r) => r.person));
          setError(null);
        }
      } catch (err) {
        if (run === latest.current) setError(errorMessage(err));
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  async function resolve(netid: string | null) {
    setBusy(netid ?? "dismiss");
    setError(null);
    try {
      await api(`/api/admin/roster-names/${row.id}/resolve`, { body: { netid } });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <Input
        type="search"
        aria-label={`Search the directory for ${row.full_name}`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoComplete="off"
        className="h-11"
      />
      {results === null ? (
        <p className="text-sm text-muted-foreground">Searching the directory…</p>
      ) : results.length === 0 ? (
        <p className="text-sm text-muted-foreground">No directory match. Try a different spelling, or dismiss the name.</p>
      ) : (
        <ul className="divide-y">
          {results.slice(0, 6).map((p) => (
            <li key={p.netid}>
              <PersonRow
                person={p}
                detail={[personMeta(p), p.netid].filter(Boolean).join(" · ")}
                action={
                  <Button size="tap" variant="outline" disabled={busy !== null} onClick={() => resolve(p.netid)}>
                    {busy === p.netid ? "Saving…" : "This is them"}
                  </Button>
                }
              />
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button size="tap" variant="ghost" className="-ml-3 text-muted-foreground" disabled={busy !== null} onClick={() => resolve(null)}>
        {busy === "dismiss" ? "Dismissing…" : "Not a Yale student: dismiss"}
      </Button>
    </div>
  );
}

/** Roster names that matched nobody, or more than one person. An admin picks the right one. */
export function RosterNamesPanel({ names }: { names: UnmatchedName[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);

  if (names.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
        No unmatched names. When a roster lists someone the directory can&apos;t place, or two students share the name,
        it shows up here. Running the directory sync first keeps this list short.
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-2xl border">
      {names.map((n) => (
        <li key={n.id} className="px-4 py-3">
          <div className="font-medium">{n.full_name}</div>
          <div className="text-sm text-muted-foreground">
            {[n.role_title, n.club.short_name ?? n.club.name].filter(Boolean).join(" · ")}
          </div>
          {n.source_url ? (
            <a
              href={n.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center text-sm break-all text-primary underline underline-offset-4"
            >
              Roster page
            </a>
          ) : null}
          {open === n.id ? (
            <Picker
              row={n}
              onDone={() => {
                setOpen(null);
                router.refresh();
              }}
            />
          ) : (
            <div>
              <Button size="tap" variant="outline" onClick={() => setOpen(n.id)}>
                Find in directory
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
