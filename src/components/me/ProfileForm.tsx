"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";

/**
 * Preferred name, plus first and last name for people the Yale directory
 * does not list (`needsName`). Used on /me and in onboarding step 1.
 */
export function ProfileForm({
  preferredName,
  firstName,
  lastName,
  needsName,
  canEditLegalName = needsName,
  submitLabel = "Save",
  onSaved,
}: {
  preferredName: string | null;
  firstName: string;
  lastName: string;
  needsName: boolean;
  canEditLegalName?: boolean;
  submitLabel?: string;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [preferred, setPreferred] = useState(preferredName ?? "");
  const [first, setFirst] = useState(needsName ? "" : firstName);
  const [last, setLast] = useState(lastName);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      await api("/api/me", {
        method: "PATCH",
        body: {
          preferred_name: preferred.trim() || null,
          ...(canEditLegalName && first.trim() && last.trim() ? { first_name: first.trim(), last_name: last.trim() } : {}),
        },
      });
      setSaved(true);
      router.refresh();
      onSaved?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  const missingName = canEditLegalName && (!first.trim() || !last.trim());

  return (
    <form onSubmit={submit} className="space-y-3">
      {canEditLegalName ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="first-name">First name</Label>
            <Input
              id="first-name"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              autoComplete="given-name"
              maxLength={60}
              required
              className="mt-1 h-11"
            />
          </div>
          <div>
            <Label htmlFor="last-name">Last name</Label>
            <Input
              id="last-name"
              value={last}
              onChange={(e) => setLast(e.target.value)}
              autoComplete="family-name"
              maxLength={60}
              required
              className="mt-1 h-11"
            />
          </div>
        </div>
      ) : null}
      <div>
        <Label htmlFor="preferred-name">What friends call you (optional)</Label>
        <Input
          id="preferred-name"
          value={preferred}
          onChange={(e) => setPreferred(e.target.value)}
          placeholder={firstName && !needsName ? firstName : "Preferred first name"}
          autoComplete="nickname"
          maxLength={60}
          className="mt-1 h-11"
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" size="tap" disabled={pending || missingName}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        {saved && !onSaved ? (
          <span role="status" className="text-sm text-muted-foreground">
            Saved
          </span>
        ) : null}
      </div>
    </form>
  );
}
