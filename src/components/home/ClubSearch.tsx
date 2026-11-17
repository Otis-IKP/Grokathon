"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { ClubTypeahead, type ClubOption } from "@/components/clubs/ClubTypeahead";
import { api, errorMessage } from "@/lib/api";

/** Home search: pick a club, run a path search, go to its results. */
export function ClubSearch() {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search(club: ClubOption) {
    setPending(club.short_name ?? club.name);
    setError(null);
    try {
      const res = await api<{ search_id: string }>("/api/paths", { body: { club_id: club.id } });
      router.push(`/paths/${res.search_id}`);
    } catch (err) {
      setError(errorMessage(err));
      setPending(null);
    }
  }

  return (
    <div>
      <ClubTypeahead large onSelect={search} disabled={pending !== null} placeholder="YSIG, the Dramat, YDN…" label="Which club do you want in on?" />
      {pending ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          Finding your way into {pending}…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
