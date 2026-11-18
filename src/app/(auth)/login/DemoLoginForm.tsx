"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";

/** Shown only while DEMO_LOGIN_CODE is set: sign in as one of the seeded demo students with the demo code. */
export function DemoLoginForm({ next, accounts }: { next: string; accounts: { netid: string; name: string }[] }) {
  const [netid, setNetid] = useState(accounts[0]?.netid ?? "");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await api<{ redirect: string }>("/api/auth/demo-login", { body: { netid, code, next } });
      window.location.href = res.redirect;
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border p-4">
      <div>
        <p className="text-sm font-medium">Demo sign-in</p>
        <p className="text-xs text-muted-foreground">Try NEPO as a sample student. No Yale account needed.</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="demo-account" className="text-xs text-muted-foreground">
          Sample student
        </Label>
        <select
          id="demo-account"
          name="netid"
          value={netid}
          onChange={(e) => setNetid(e.target.value)}
          className="h-11 w-full rounded-lg border bg-background px-3 text-base"
        >
          {accounts.map((a) => (
            <option key={a.netid} value={a.netid}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="demo-code" className="text-xs text-muted-foreground">
          Demo code
        </Label>
        <div className="flex gap-2">
          <Input
            id="demo-code"
            name="code"
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            className="h-11"
          />
          <Button type="submit" variant="outline" size="tap" disabled={pending || !code.trim() || !netid}>
            {pending ? "Signing in…" : "Enter demo"}
          </Button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
