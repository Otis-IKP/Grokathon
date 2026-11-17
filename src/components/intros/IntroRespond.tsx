"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import type { IntroView } from "@/server/intros/service";

/** What a connector does next after saying yes. NEPO sends nothing itself. */
export function WhatNext({ intro }: { intro: Pick<IntroView, "requester" | "target" | "club"> }) {
  const who = intro.requester.first_name;
  return (
    <div className="rounded-xl bg-success-soft px-4 py-3 text-sm">
      <div className="font-medium text-success">You said yes. What next</div>
      <p className="mt-1">
        {intro.target
          ? `Start a group text with ${who} and ${intro.target.first_name} and introduce them, or reply to ${who} directly.`
          : `Reply to ${who} directly and find a time to talk about ${intro.club.short_name ?? intro.club.name}.`}
      </p>
    </div>
  );
}

/** Connector's Accept / Decline. One tap each; declining asks for no reason. */
export function IntroRespond({ intro }: { intro: IntroView }) {
  const router = useRouter();
  const [status, setStatus] = useState(intro.status);
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function respond(decision: "accept" | "decline") {
    setPending(decision);
    setError(null);
    try {
      const res = await api<{ intro: IntroView }>(`/api/intros/${intro.id}/respond`, { body: { decision } });
      setStatus(res.intro.status);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  }

  if (status === "accepted" || status === "completed") return <WhatNext intro={intro} />;
  if (status === "declined") {
    return (
      <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
        You passed on this one. {intro.requester.first_name} only sees &ldquo;not right now&rdquo;.
      </p>
    );
  }
  if (status !== "sent" && status !== "drafted") return null;

  return (
    <div>
      <div className="flex gap-2">
        <Button size="tap" className="flex-1" onClick={() => respond("accept")} disabled={pending !== null}>
          {pending === "accept" ? "Accepting…" : "Accept"}
        </Button>
        <Button size="tap" variant="outline" className="flex-1" onClick={() => respond("decline")} disabled={pending !== null}>
          {pending === "decline" ? "Declining…" : "Decline"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
