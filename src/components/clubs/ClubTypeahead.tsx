"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export type ClubOption = {
  id: string;
  slug: string;
  name: string;
  short_name: string | null;
  category: string | null;
  member_count?: number;
};

/**
 * Club search box with a results list underneath. Used on Home ("Which club
 * do you want in on?"), in onboarding and on /me ("Add clubs yourself").
 * With `allowUnknown`, a name that matches nothing can be submitted as typed.
 */
export function ClubTypeahead({
  onSelect,
  onCreate,
  allowUnknown = false,
  placeholder = "Search clubs",
  autoFocus = false,
  large = false,
  disabled = false,
  label = "Search clubs",
}: {
  onSelect: (club: ClubOption) => void;
  /** Called with the typed name when `allowUnknown` and the user picks "Add …". */
  onCreate?: (name: string) => void;
  allowUnknown?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  large?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ClubOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const listId = useId();
  const latest = useRef(0);

  // Typing updates the query and the loading/reset state together; the
  // effect below only runs the debounced request.
  function onQueryChange(value: string) {
    setQ(value);
    if (value.trim().length < 2) {
      latest.current++;
      setResults([]);
      setSearched(false);
      setLoading(false);
    } else {
      setLoading(true);
    }
  }

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const run = ++latest.current;
    const timer = setTimeout(async () => {
      try {
        const res = await api<{ clubs: ClubOption[] }>(`/api/clubs?q=${encodeURIComponent(term)}`);
        if (run !== latest.current) return;
        setResults(res.clubs.slice(0, 8));
        setSearched(true);
      } catch {
        if (run === latest.current) setResults([]);
      } finally {
        if (run === latest.current) setLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  function reset() {
    onQueryChange("");
  }

  const term = q.trim();
  const exact = results.some(
    (c) => c.name.toLowerCase() === term.toLowerCase() || c.short_name?.toLowerCase() === term.toLowerCase(),
  );
  const showCreate = allowUnknown && onCreate && searched && term.length >= 2 && !exact;

  function pick(club: ClubOption) {
    reset();
    onSelect(club);
  }

  return (
    <div>
      <div className="relative">
        <Search
          className={cn(
            "pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground",
            large ? "size-5" : "size-4",
          )}
          aria-hidden
        />
        <Input
          type="search"
          role="combobox"
          aria-label={label}
          aria-expanded={results.length > 0 || Boolean(showCreate)}
          aria-controls={listId}
          aria-autocomplete="list"
          value={q}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          className={cn("pr-9", large ? "h-14 rounded-2xl pl-11 text-lg" : "h-11 rounded-xl pl-9")}
        />
        {loading ? (
          <LoaderCircle
            className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-label="Searching"
          />
        ) : null}
      </div>

      <ul id={listId} role="listbox" aria-label="Clubs" className={cn("mt-2 divide-y rounded-2xl border", results.length === 0 && !showCreate && "hidden")}>
        {results.map((club) => (
          <li key={club.id} role="option" aria-selected={false}>
            <button
              type="button"
              onClick={() => pick(club)}
              className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{club.name}</span>
                <span className="block truncate text-sm text-muted-foreground">
                  {[club.short_name !== club.name ? club.short_name : null, club.category].filter(Boolean).join(" · ")}
                </span>
              </span>
            </button>
          </li>
        ))}
        {showCreate ? (
          <li role="option" aria-selected={false}>
            <button
              type="button"
              onClick={() => {
                onCreate?.(term);
                reset();
              }}
              className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            >
              <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                Add “{term}” <span className="text-muted-foreground">as a new club</span>
              </span>
            </button>
          </li>
        ) : null}
      </ul>

      {searched && results.length === 0 && !showCreate && !loading ? (
        <p className="mt-2 px-1 text-sm text-muted-foreground">No club matches “{term}”. Try its full name or initials.</p>
      ) : null}
    </div>
  );
}
