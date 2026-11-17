"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, MessageSquare } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Me } from "./types";

type Code = { code: string; expires_at: string; bot_phone: string };

/**
 * Phone linking (section 6.3): shows a 6-digit code to text to the NEPO
 * number, then polls GET /api/me every 2 s until the bot has linked the phone.
 */
export function PhoneLink({
  linked: initialLinked,
  masked: initialMasked,
  verifiedAt: initialVerifiedAt,
  autoStart = false,
  onLinked,
}: {
  linked: boolean;
  masked: string | null;
  verifiedAt: string | null;
  /** Request a code as soon as the component mounts (onboarding). */
  autoStart?: boolean;
  onLinked?: () => void;
}) {
  const [linked, setLinked] = useState(initialLinked);
  const [masked, setMasked] = useState(initialMasked);
  const [verifiedAt, setVerifiedAt] = useState(initialVerifiedAt);
  const [code, setCode] = useState<Code | null>(null);
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState<"code" | "unlink" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const requestCode = useCallback(async () => {
    setPending("code");
    setError(null);
    setExpired(false);
    try {
      setCode(await api<Code>("/api/me/phone-code", { method: "POST" }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  }, []);

  useEffect(() => {
    if (!autoStart || initialLinked || started.current) return;
    started.current = true;
    void requestCode();
  }, [autoStart, initialLinked, requestCode]);

  // Poll while a code is showing; a changed verification time means this code was used.
  useEffect(() => {
    if (!code) return;
    const timer = setInterval(async () => {
      if (new Date(code.expires_at).getTime() < Date.now()) {
        setExpired(true);
        setCode(null);
        return;
      }
      try {
        const me = await api<Me>("/api/me");
        if (me.phone.linked && me.phone_verified_at !== verifiedAt) {
          setLinked(true);
          setMasked(me.phone.masked);
          setVerifiedAt(me.phone_verified_at);
          setCode(null);
          onLinked?.();
        }
      } catch {
        // Keep polling; a blip should not end the flow.
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [code, verifiedAt, onLinked]);

  async function unlink() {
    setPending("unlink");
    setError(null);
    try {
      await api("/api/me/phone", { method: "DELETE" });
      setLinked(false);
      setMasked(null);
      setVerifiedAt(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      {linked && !code ? (
        <div className="flex items-center gap-2 rounded-xl bg-success-soft px-4 py-3 text-success">
          <CircleCheck className="size-5 shrink-0" aria-hidden />
          <span className="font-medium">Phone linked{masked ? `: ${masked}` : ""}</span>
        </div>
      ) : null}

      {code ? (
        <div className="rounded-2xl border p-4 text-center" aria-live="polite">
          <p className="text-sm text-muted-foreground">Text this code to {code.bot_phone}</p>
          <p className="my-2 font-mono text-4xl font-semibold tracking-[0.2em]" aria-label={`Code ${code.code.split("").join(" ")}`}>
            {code.code}
          </p>
          <a
            href={`sms:${code.bot_phone.replace(/[^\d+]/g, "")}&body=${code.code}`}
            className={cn(buttonVariants({ size: "tap" }), "w-full")}
          >
            <MessageSquare aria-hidden />
            Text it
          </a>
          <p className="mt-3 text-sm text-muted-foreground">
            Waiting for your text… This screen moves on by itself. The code works for 10 minutes.
          </p>
        </div>
      ) : null}

      {expired ? (
        <p role="alert" className="text-sm text-destructive">
          That code expired. Get a new one.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {!code ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="tap" variant={linked ? "outline" : "default"} onClick={requestCode} disabled={pending !== null}>
            {pending === "code" ? "Getting a code…" : linked ? "Link a different phone" : "Get a code"}
          </Button>
          {linked ? (
            <Button type="button" size="tap" variant="ghost" className="text-muted-foreground" onClick={unlink} disabled={pending !== null}>
              {pending === "unlink" ? "Unlinking…" : "Unlink"}
            </Button>
          ) : null}
        </div>
      ) : (
        <Button type="button" size="tap" variant="ghost" className="text-muted-foreground" onClick={() => setCode(null)}>
          Cancel
        </Button>
      )}
    </div>
  );
}
