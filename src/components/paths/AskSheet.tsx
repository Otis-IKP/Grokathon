"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { PathResult } from "@/server/paths/findPaths";

type Tone = "casual" | "polite";

/**
 * Bottom sheet from a connector card: the drafted ask, editable, then either
 * "Copy and open Messages" (the requester sends it themselves) or "Send
 * through NEPO" (it lands in the connector's NEPO inbox).
 */
export function AskSheet({
  searchId,
  result,
  open,
  onOpenChange,
}: {
  searchId: string;
  result: PathResult;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const connector = result.connector;
  const [tone, setTone] = useState<Tone>("casual");
  const [message, setMessage] = useState("");
  const [drafting, setDrafting] = useState(true);
  const [sending, setSending] = useState<"sms" | "nepo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const draft = useCallback(
    async (t: Tone) => {
      setDrafting(true);
      setError(null);
      try {
        const res = await api<{ message: string }>("/api/intros/draft", {
          body: { search_id: searchId, connector_netid: connector.netid, tone: t },
        });
        setMessage(res.message);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setDrafting(false);
      }
    },
    [searchId, connector.netid],
  );

  // The sheet is mounted when it opens, so the first draft is requested once on mount.
  useEffect(() => {
    let cancelled = false;
    api<{ message: string }>("/api/intros/draft", {
      body: { search_id: searchId, connector_netid: connector.netid, tone: "casual" },
    })
      .then((res) => {
        if (!cancelled) setMessage(res.message);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setDrafting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [searchId, connector.netid]);

  function changeTone(t: Tone) {
    if (t === tone) return;
    setTone(t);
    void draft(t);
  }

  async function send(how: "sms" | "nepo") {
    const text = message.trim();
    if (!text) return;
    setSending(how);
    setError(null);
    try {
      const { intro } = await api<{ intro: { id: string } }>("/api/intros", {
        body: {
          search_id: searchId,
          connector_netid: connector.netid,
          target_netid: result.target?.person.netid ?? null,
          message: text,
        },
      });
      if (how === "sms") {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // Clipboard can be blocked; the message is still prefilled in Messages.
        }
        // iOS form of an sms: link with a body and no recipient.
        window.location.href = `sms:&body=${encodeURIComponent(text)}`;
      }
      await api(`/api/intros/${intro.id}`, { method: "PATCH", body: { action: "mark_sent" } });
      router.push(`/intros/${intro.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setSending(null);
    }
  }

  const busy = drafting || sending !== null;

  return (
    <Sheet open={open} onOpenChange={(o) => onOpenChange(o)}>
      <SheetContent side="bottom" className="mx-auto max-h-[92dvh] w-full max-w-[480px] overflow-y-auto rounded-t-2xl pb-safe">
        <SheetHeader className="pr-12">
          <SheetTitle>Ask {connector.first_name}</SheetTitle>
          <SheetDescription>{result.why}</SheetDescription>
        </SheetHeader>

        <div className="space-y-3 px-4 pb-4">
          <div role="group" aria-label="Tone" className="flex gap-2">
            {(["casual", "polite"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tone === t}
                disabled={busy}
                onClick={() => changeTone(t)}
                className={cn(
                  "h-11 flex-1 rounded-xl border text-sm font-medium capitalize disabled:opacity-50",
                  tone === t ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {t}
              </button>
            ))}
            <Button type="button" variant="outline" size="tap" onClick={() => draft(tone)} disabled={busy}>
              <RefreshCw className={cn(drafting && "animate-spin")} aria-hidden />
              Regenerate
            </Button>
          </div>

          <div className="relative">
            <Textarea
              aria-label={`Message to ${connector.first_name}`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1000}
              rows={5}
              disabled={drafting && !message}
              placeholder={drafting ? "Drafting…" : "Write your message"}
              className="min-h-32 rounded-xl p-3"
            />
            {drafting ? (
              <LoaderCircle className="absolute top-3 right-3 size-4 animate-spin text-muted-foreground" aria-label="Drafting" />
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button size="tap" className="w-full" onClick={() => send("sms")} disabled={busy || !message.trim()}>
            {sending === "sms" ? "Opening Messages…" : "Copy and open Messages"}
          </Button>
          <Button
            size="tap"
            variant="outline"
            className="w-full"
            onClick={() => send("nepo")}
            disabled={busy || !message.trim() || !connector.is_user}
          >
            {sending === "nepo" ? "Sending…" : "Send through NEPO"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {connector.is_user
              ? `Through NEPO, the request appears in ${connector.first_name}'s inbox. The app doesn't text anyone; they answer when they next open NEPO.`
              : `${connector.first_name} isn't on NEPO yet, so send it from your own phone.`}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
