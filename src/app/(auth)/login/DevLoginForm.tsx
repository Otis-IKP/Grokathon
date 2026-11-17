"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";

/** Local development only (DEV_LOGIN_ENABLED=1): sign in as any NetID without CAS. */
export function DevLoginForm({ next }: { next: string }) {
  const [netid, setNetid] = useState("demo_maya");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await api<{ redirect: string }>("/api/auth/dev-login", { body: { netid, next } });
      window.location.href = res.redirect;
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-2xl border border-dashed p-4">
      <Label htmlFor="dev-netid" className="text-xs text-muted-foreground">
        Development sign-in (skips CAS)
      </Label>
      <div className="flex gap-2">
        <Input
          id="dev-netid"
          name="netid"
          value={netid}
          onChange={(e) => setNetid(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="h-11"
          placeholder="NetID"
        />
        <Button type="submit" variant="outline" size="tap" disabled={pending || !netid.trim()}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
