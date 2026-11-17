"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";

/** "Find my way in" runs a path search; "I'm in this club" self-reports a membership. */
export function ClubActions({ clubId, clubLabel, isMember }: { clubId: string; clubLabel: string; isMember: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<"find" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  async function find() {
    setPending("find");
    setError(null);
    try {
      const res = await api<{ search_id: string }>("/api/paths", { body: { club_id: clubId } });
      router.push(`/paths/${res.search_id}`);
    } catch (err) {
      setError(errorMessage(err));
      setPending(null);
    }
  }

  async function join() {
    setPending("join");
    setError(null);
    try {
      await api("/api/memberships", { body: { club_id: clubId } });
      setJoined(true);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  }

  if (isMember || joined) {
    return (
      <p className="rounded-xl bg-muted px-4 py-3 text-sm">
        You&apos;re in {clubLabel}. Friends looking for a way in may be pointed to you. Manage your clubs under Me.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Button size="tap" className="w-full" onClick={find} disabled={pending !== null}>
        {pending === "find" ? "Looking…" : "Find my way in"}
      </Button>
      <Button size="tap" variant="outline" className="w-full" onClick={join} disabled={pending !== null}>
        {pending === "join" ? "Adding…" : "I'm in this club"}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
