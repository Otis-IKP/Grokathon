"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Copies an invite link for the user to send themselves. NEPO never contacts anyone. */
export function CopyInviteButton({ url, label = "Copy invite link" }: { url: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2500);
  }

  return (
    <Button type="button" variant="outline" size="tap" onClick={copy} aria-live="polite">
      {state === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
      {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : label}
    </Button>
  );
}

/** Invite link for a non-user: signing in through it shows them the pending request. */
export function inviteUrlFor(myNetid: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/login?ref=${encodeURIComponent(myNetid)}`;
}
