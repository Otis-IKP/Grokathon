"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";
import { PersonRow, personMeta, type PersonCardLike } from "@/components/app/PersonAvatar";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { AddFriendButton, type FriendState } from "./AddFriendButton";
import { CopyInviteButton } from "./CopyInviteButton";

type Result = { person: PersonCardLike; friendship: FriendState };

/**
 * Yale directory search with an Add button per result. Used on /friends
 * (Find tab) and in onboarding step 4.
 */
export function DirectorySearch({
  onAdded,
  autoFocus = false,
}: {
  /** Called after a request is created or accepted. */
  onAdded?: () => void;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invites, setInvites] = useState<Record<string, string>>({});
  const latest = useRef(0);

  useEffect(() => {
    const term = q.trim();
    const run = ++latest.current;
    if (term.length < 2) return;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api<{ results: Result[] }>(`/api/directory/search?q=${encodeURIComponent(term)}`);
        if (run !== latest.current) return;
        setResults(res.results);
        setError(null);
        setSearched(true);
      } catch (err) {
        if (run === latest.current) setError(errorMessage(err));
      } finally {
        if (run === latest.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const term = q.trim();
  const active = term.length >= 2;

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          aria-label="Search the Yale directory by name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search Yale by name"
          autoFocus={autoFocus}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          className="h-11 rounded-xl pr-9 pl-9"
        />
        {loading ? (
          <LoaderCircle className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-label="Searching" />
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-2 px-1 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {active && results.length > 0 ? (
        <ul className="mt-2 divide-y">
          {results.map((r) => (
            <li key={r.person.netid}>
              <PersonRow
                person={r.person}
                detail={[personMeta(r.person), r.person.is_user ? null : "Not on NEPO yet"].filter(Boolean).join(" · ")}
                action={
                  <AddFriendButton
                    person={r.person}
                    initial={r.friendship}
                    onChange={(_state, inviteUrl) => {
                      if (inviteUrl) setInvites((m) => ({ ...m, [r.person.netid]: inviteUrl }));
                      onAdded?.();
                    }}
                  />
                }
              />
              {invites[r.person.netid] ? (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    {r.person.first_name} isn&apos;t on NEPO yet. Send them your invite link so they can accept.
                  </span>
                  <CopyInviteButton url={invites[r.person.netid]} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {active && searched && !loading && results.length === 0 && !error ? (
        <p className="mt-2 px-1 text-sm text-muted-foreground">
          No one at Yale matches “{term}”. Try their full first and last name.
        </p>
      ) : null}
      {!active ? (
        <p className="mt-2 px-1 text-sm text-muted-foreground">Type at least two letters of a name.</p>
      ) : null}
    </div>
  );
}
