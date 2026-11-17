"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClubTypeahead } from "@/components/clubs/ClubTypeahead";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";

export type ReviewClub = { id: string; slug: string; name: string; short_name: string | null; website: string | null };

/** Crawl one club or all, and review clubs that agents or users created. */
export function ClubsPanel({ unreviewed }: { unreviewed: ReviewClub[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function act(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const message = await fn();
      if (message) setNotice(message);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const crawl = (id: string, name: string) =>
    act(`crawl:${id}`, async () => {
      const res = await api<{ enqueued: boolean }>(`/api/admin/clubs/${id}/crawl`, { method: "POST" });
      return res.enqueued ? `Queued a roster crawl for ${name}.` : `A crawl for ${name} is already queued or running.`;
    });

  return (
    <div className="space-y-3">
      <div>
        <ClubTypeahead
          label="Crawl one club's roster"
          placeholder="Crawl one club's roster"
          disabled={busy !== null}
          onSelect={(club) => crawl(club.id, club.name)}
        />
      </div>
      <Button
        size="tap"
        variant="outline"
        className="w-full"
        disabled={busy !== null}
        onClick={() =>
          act("crawl-all", async () => {
            const res = await api<{ clubs: number; enqueued: number }>("/api/admin/clubs/crawl-all", { method: "POST" });
            return `Queued ${res.enqueued} of ${res.clubs} clubs. The rest were crawled recently.`;
          })
        }
      >
        {busy === "crawl-all" ? "Queueing…" : "Crawl all clubs"}
      </Button>
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <h3 className="pt-2 text-sm font-medium text-muted-foreground">Awaiting review</h3>
      {unreviewed.length === 0 ? (
        <p className="rounded-2xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
          Nothing to review. Clubs that a user or an agent names for the first time land here.
        </p>
      ) : (
        <ul className="divide-y rounded-2xl border">
          {unreviewed.map((c) => (
            <li key={c.id} className="px-4 py-3">
              <div className="font-medium">{c.name}</div>
              <div className="text-sm break-all text-muted-foreground">{c.website ?? "No website found yet"}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="tap"
                  disabled={busy !== null}
                  onClick={() =>
                    act(`approve:${c.id}`, async () => {
                      await api(`/api/admin/clubs/${c.id}`, { method: "PATCH", body: { status: "active" } });
                    })
                  }
                >
                  {busy === `approve:${c.id}` ? "Approving…" : "Approve"}
                </Button>
                <Button
                  size="tap"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() =>
                    act(`hide:${c.id}`, async () => {
                      await api(`/api/admin/clubs/${c.id}`, { method: "PATCH", body: { status: "hidden" } });
                    })
                  }
                >
                  {busy === `hide:${c.id}` ? "Hiding…" : "Hide"}
                </Button>
                <Button size="tap" variant="ghost" disabled={busy !== null} onClick={() => crawl(c.id, c.name)}>
                  {busy === `crawl:${c.id}` ? "Queueing…" : "Crawl"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
