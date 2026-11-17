"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { StatusBadge } from "@/components/app/StatusBadge";
import { ClubTypeahead } from "@/components/clubs/ClubTypeahead";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import type { MyMembership } from "./types";

const ROLES = [
  { value: "member", label: "Member" },
  { value: "board", label: "Board" },
  { value: "alum", label: "Former member" },
] as const;
type Role = (typeof ROLES)[number]["value"];

const SOURCE_LABEL: Record<string, string> = {
  self_report: "You added this",
  linkedin_pdf: "From your LinkedIn PDF",
  linkedin_url: "From your LinkedIn profile",
  public_roster: "From the club's public roster",
  web_research: "From public sources",
  seed: "Demo data",
};

function roleLabel(m: MyMembership): string {
  return m.title?.trim() || ROLES.find((r) => r.value === m.role)?.label || m.role;
}

/**
 * The owner's clubs with status badges and evidence links; add (known clubs
 * or a new name), edit role and title, remove. Re-fetches while a new claim
 * is still being checked so the badge updates by itself.
 */
export function MyClubs({
  initial,
  refreshKey = 0,
  compact = false,
}: {
  initial: MyMembership[];
  /** Bump to make the list reload (e.g. after LinkedIn finishes). */
  refreshKey?: number;
  /** Onboarding: no edit controls, just the list and add. */
  compact?: boolean;
}) {
  const [items, setItems] = useState<MyMembership[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ role: Role; title: string }>({ role: "member", title: "" });
  const [checks, setChecks] = useState(0);

  const reload = useCallback(async () => {
    try {
      const res = await api<{ memberships: MyMembership[] }>("/api/memberships");
      setItems(res.memberships);
    } catch {
      // The list on screen stays; the next action will surface a real error.
    }
  }, []);

  useEffect(() => {
    if (refreshKey === 0) return;
    const t = setTimeout(() => {
      setChecks(0);
      void reload();
    }, 0);
    return () => clearTimeout(t);
  }, [refreshKey, reload]);

  // A claim that has never been checked is being validated right now: look again shortly.
  const unchecked = items.some((m) => m.status === "claimed" && !m.last_checked_at);
  useEffect(() => {
    if (!unchecked || checks >= 8) return;
    const t = setTimeout(async () => {
      await reload();
      setChecks((n) => n + 1);
    }, 3000);
    return () => clearTimeout(t);
  }, [unchecked, checks, reload]);

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      setChecks(0);
      await reload();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const add = (body: { club_id?: string; club_name?: string }) =>
    act("add", () => api("/api/memberships", { body: { ...body, role: "member" } }));

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
          No clubs yet. Search below to add the ones you&apos;re in, so friends can find their way in through you.
        </p>
      ) : (
        <ul className="divide-y rounded-2xl border">
          {items.map((m) => (
            <li key={m.id} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{m.club.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {roleLabel(m)}
                    {compact ? "" : ` · ${SOURCE_LABEL[m.source] ?? m.source}`}
                  </div>
                </div>
                <StatusBadge status={m.status} className="mt-0.5" />
              </div>

              {m.status === "claimed" && !m.last_checked_at ? (
                <p className="mt-1 text-xs text-muted-foreground">Checking public sources…</p>
              ) : null}
              {m.status === "disputed" ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  The club&apos;s current roster doesn&apos;t list you, so this isn&apos;t shown to anyone else.
                </p>
              ) : null}

              {m.evidence.length > 0 ? (
                <ul className="mt-1">
                  {m.evidence.map((e) => (
                    <li key={e.url}>
                      <a
                        href={e.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-primary underline underline-offset-4"
                      >
                        <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                        <span className="break-all">Source: {new URL(e.url).hostname.replace(/^www\./, "")}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}

              {!compact && editing === m.id ? (
                <form
                  className="mt-2 space-y-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const ok = await act(`save:${m.id}`, () =>
                      api(`/api/memberships/${m.id}`, {
                        method: "PATCH",
                        body: { role: draft.role, title: draft.title.trim() || null },
                      }),
                    );
                    if (ok) setEditing(null);
                  }}
                >
                  <div>
                    <Label htmlFor={`role-${m.id}`}>Role</Label>
                    <select
                      id={`role-${m.id}`}
                      value={draft.role}
                      onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value as Role }))}
                      className="mt-1 h-11 w-full rounded-lg border border-input bg-transparent px-3"
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor={`title-${m.id}`}>Title (optional)</Label>
                    <Input
                      id={`title-${m.id}`}
                      value={draft.title}
                      onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                      placeholder="Analyst, Managing Editor…"
                      maxLength={120}
                      className="mt-1 h-11"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" size="tap" disabled={busy !== null}>
                      {busy === `save:${m.id}` ? "Saving…" : "Save"}
                    </Button>
                    <Button type="button" size="tap" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : removing === m.id ? (
                <div className="mt-2 flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-sm">Remove {m.club.short_name ?? m.club.name} from your clubs?</span>
                  <Button
                    size="tap"
                    variant="destructive"
                    disabled={busy !== null}
                    onClick={async () => {
                      await act(`remove:${m.id}`, () => api(`/api/memberships/${m.id}`, { method: "DELETE" }));
                      setRemoving(null);
                    }}
                  >
                    {busy === `remove:${m.id}` ? "Removing…" : "Remove"}
                  </Button>
                  <Button size="tap" variant="ghost" onClick={() => setRemoving(null)}>
                    Keep
                  </Button>
                </div>
              ) : (
                <div className="mt-1 flex gap-1">
                  {!compact ? (
                    <Button
                      size="tap"
                      variant="ghost"
                      className="-ml-3 text-muted-foreground"
                      aria-label={`Edit ${m.club.name}`}
                      onClick={() => {
                        setDraft({ role: (m.role as Role) ?? "member", title: m.title ?? "" });
                        setEditing(m.id);
                      }}
                    >
                      Edit
                    </Button>
                  ) : null}
                  <Button
                    size="tap"
                    variant="ghost"
                    className={compact ? "-ml-3 text-muted-foreground" : "text-muted-foreground"}
                    aria-label={`Remove ${m.club.name}`}
                    onClick={() => setRemoving(m.id)}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div>
        <ClubTypeahead
          label="Add a club you're in"
          placeholder="Add a club you're in"
          allowUnknown
          disabled={busy === "add"}
          onSelect={(club) => add({ club_id: club.id })}
          onCreate={(name) => add({ club_name: name })}
        />
        {busy === "add" ? <p className="mt-2 px-1 text-sm text-muted-foreground">Adding…</p> : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
