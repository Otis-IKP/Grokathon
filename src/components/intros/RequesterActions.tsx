"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import type { IntroView } from "@/server/intros/service";

type Action = "mark_sent" | "cancel" | "complete";

/** Requester's controls: edit while drafted, mark sent, cancel, mark done once accepted. */
export function RequesterActions({ intro }: { intro: IntroView }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState(intro.message);
  const [pending, setPending] = useState<Action | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(kind: Action | "save", body: unknown) {
    setPending(kind);
    setError(null);
    try {
      await api(`/api/intros/${intro.id}`, { method: "PATCH", body });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null;
  const { status } = intro;
  if (!["drafted", "sent", "accepted"].includes(status)) return null;

  return (
    <div className="space-y-2">
      {editing ? (
        <div className="space-y-2">
          <Textarea
            aria-label="Message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={1000}
            className="min-h-32 rounded-xl p-3"
          />
          <div className="flex gap-2">
            <Button size="tap" className="flex-1" disabled={busy || !message.trim()} onClick={() => patch("save", { message })}>
              {pending === "save" ? "Saving…" : "Save"}
            </Button>
            <Button
              size="tap"
              variant="outline"
              className="flex-1"
              disabled={busy}
              onClick={() => {
                setMessage(intro.message);
                setEditing(false);
              }}
            >
              Discard changes
            </Button>
          </div>
        </div>
      ) : null}

      {status === "drafted" && !editing ? (
        <>
          <Button size="tap" className="w-full" disabled={busy} onClick={() => patch("mark_sent", { action: "mark_sent" })}>
            {pending === "mark_sent" ? "Marking…" : "I sent it"}
          </Button>
          <Button size="tap" variant="outline" className="w-full" disabled={busy} onClick={() => setEditing(true)}>
            Edit message
          </Button>
        </>
      ) : null}

      {status === "accepted" ? (
        <Button size="tap" className="w-full" disabled={busy} onClick={() => patch("complete", { action: "complete" })}>
          {pending === "complete" ? "Marking…" : "Mark as done"}
        </Button>
      ) : null}

      {(status === "drafted" || status === "sent") && !editing ? (
        <Button size="tap" variant="ghost" className="w-full text-destructive" disabled={busy} onClick={() => patch("cancel", { action: "cancel" })}>
          {pending === "cancel" ? "Cancelling…" : "Cancel this request"}
        </Button>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
