"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LoaderCircle, Share2 } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { PersonAvatar, personMeta } from "@/components/app/PersonAvatar";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { EmptyReason, PathResult } from "@/server/paths/findPaths";
import type { PathSearchResponse } from "@/server/paths/service";
import { AskSheet } from "./AskSheet";

const POLL_MS = 5000;
const POLL_FOR_MS = 60_000;

function emptyState(reason: EmptyReason | null, club: PathSearchResponse["club"]) {
  const label = club.short_name ?? club.name;
  const link = (href: string, text: string) => (
    <Link href={href} className={cn(buttonVariants({ size: "tap" }))}>
      {text}
    </Link>
  );
  switch (reason) {
    case "no_friends":
      return {
        title: "Add friends first",
        body: "NEPO finds a way in through people you know. Add a few friends and search again.",
        action: link("/friends?tab=find", "Find friends"),
      };
    case "no_known_members":
      return {
        title: `We don't have ${label}'s roster yet`,
        body: "NEPO is looking for a public member list. Check back in a minute, or ask a friend in the club to add it on NEPO.",
        action: link(`/clubs/${club.slug}`, `Open ${label}`),
      };
    case "already_member":
      return {
        title: `You're already in ${label}`,
        body: "Friends looking for a way in may be pointed to you. Try another club.",
        action: link("/", "Search another club"),
      };
    default:
      return {
        title: `None of your friends are connected to ${label} yet`,
        body: "Add more friends, especially ones in clubs, and NEPO will look again.",
        action: link("/friends?tab=find", "Find friends"),
      };
  }
}

function ConnectorCard({ result, onAsk }: { result: PathResult; onAsk: () => void }) {
  const c = result.connector;
  const status = result.link.type === "member" ? result.link.status : result.target?.status;
  const evidence = result.link.type === "member" ? result.link.evidence_url : null;
  return (
    <li className="rounded-2xl border p-4">
      <div className="flex items-center gap-3">
        <PersonAvatar person={c} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{c.name}</div>
          <div className="truncate text-sm text-muted-foreground">
            {[personMeta(c), result.hops === 1 ? "In the club" : "Knows a member"].filter(Boolean).join(" · ")}
          </div>
        </div>
        {status ? <StatusBadge status={status} evidenceUrl={evidence} /> : null}
      </div>
      <p className="mt-3 text-[0.95rem] leading-relaxed">{result.why}</p>
      <Button size="tap" className="mt-3 w-full" onClick={onAsk}>
        Ask {c.first_name}
      </Button>
    </li>
  );
}

/** Ranked connector cards, with polling while research is still running. */
export function PathResults({ initial }: { initial: PathSearchResponse }) {
  const [data, setData] = useState(initial);
  const [polling, setPolling] = useState(initial.pending_research);
  const [asking, setAsking] = useState<PathResult | null>(null);
  const [share, setShare] = useState<{ state: "idle" | "pending" | "copied" | "error"; text?: string }>({ state: "idle" });

  useEffect(() => {
    if (!polling) return;
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - startedAt > POLL_FOR_MS) {
        setPolling(false);
        return;
      }
      try {
        const next = await api<PathSearchResponse>(`/api/paths/${initial.search_id}`);
        setData(next);
        if (!next.pending_research) setPolling(false);
      } catch {
        setPolling(false);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [polling, initial.search_id]);

  async function shareGraph() {
    setShare({ state: "pending" });
    try {
      const res = await api<{ share_token: string }>(`/api/paths/${data.search_id}/share`, { method: "POST" });
      const url = `${window.location.origin}/api/public/graph/${res.share_token}`;
      try {
        await navigator.clipboard.writeText(url);
        setShare({ state: "copied", text: "Link copied. It works for 24 hours." });
      } catch {
        setShare({ state: "copied", text: url });
      }
    } catch (err) {
      setShare({ state: "error", text: errorMessage(err) });
    }
  }

  const empty = data.results.length === 0 ? emptyState(data.empty_reason, data.club) : null;

  return (
    <div>
      {empty ? (
        <EmptyState title={empty.title} action={empty.action}>
          {empty.body}
        </EmptyState>
      ) : (
        <ol className="space-y-3">
          {data.results.map((r) => (
            <ConnectorCard key={r.connector.netid} result={r} onAsk={() => setAsking(r)} />
          ))}
        </ol>
      )}

      {polling ? (
        <p className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          Still looking for more connections…
        </p>
      ) : null}

      {data.results.length > 0 ? (
        <div className="mt-4 text-center">
          <Button variant="ghost" size="tap" onClick={shareGraph} disabled={share.state === "pending"}>
            <Share2 aria-hidden />
            {share.state === "pending" ? "Creating link…" : "Share this path"}
          </Button>
          {share.text ? (
            <p role={share.state === "error" ? "alert" : "status"} className={cn("mt-1 text-sm break-all", share.state === "error" ? "text-destructive" : "text-muted-foreground")}>
              {share.text}
            </p>
          ) : null}
        </div>
      ) : null}

      {asking ? (
        <AskSheet
          key={asking.connector.netid}
          searchId={data.search_id}
          result={asking}
          open
          onOpenChange={(open) => {
            if (!open) setAsking(null);
          }}
        />
      ) : null}
    </div>
  );
}
