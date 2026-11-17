"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";

/** Delete account (privacy rule 12), behind one confirm step. */
export function DeleteAccount() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await api("/api/me", { method: "DELETE" });
      router.replace("/login");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <Button type="button" size="tap" variant="destructive" className="w-full" onClick={() => setConfirming(true)}>
        Delete account
      </Button>
    );
  }
  return (
    <div className="rounded-2xl border border-destructive/40 p-4" role="group" aria-label="Confirm account deletion">
      <p className="font-medium">Delete your NEPO account?</p>
      <p className="mt-1 text-sm text-muted-foreground">
        This removes your friends, the clubs you added, your linked phone and every intro you sent or received. It
        can&apos;t be undone. You stay hidden from NEPO afterwards; sign in again if you ever want to come back.
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button type="button" size="tap" variant="destructive" className="flex-1" disabled={pending} onClick={remove}>
          {pending ? "Deleting…" : "Delete everything"}
        </Button>
        <Button type="button" size="tap" variant="outline" className="flex-1" disabled={pending} onClick={() => setConfirming(false)}>
          Keep my account
        </Button>
      </div>
    </div>
  );
}
