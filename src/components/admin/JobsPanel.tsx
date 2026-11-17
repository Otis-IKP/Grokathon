"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";

export type AdminJob = {
  id: string;
  type: string;
  status: string;
  attempts: number;
  payload_keys: string[];
  dedupe_key: string | null;
  error: string | null;
  result: unknown;
  run_after: string;
  finished_at: string | null;
  created_at: string;
};

type AgentRun = {
  id: string;
  agent: string;
  model: string;
  input: unknown;
  output: unknown;
  citations: unknown;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
};

const STATUS_STYLE: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-warning-soft text-warning",
  done: "bg-success-soft text-success",
  failed: "bg-destructive/10 text-destructive",
};

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-2 font-mono text-xs break-words whitespace-pre-wrap">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Job queue: status counts, retry, and each job's agent runs (prompt input, output, citations). */
export function JobsPanel({ counts, jobs, filter }: { counts: Record<string, number>; jobs: AdminJob[]; filter: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, AgentRun[] | "loading" | { error: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(id: string) {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    if (Array.isArray(runs[id])) return;
    setRuns((r) => ({ ...r, [id]: "loading" }));
    try {
      const res = await api<{ runs: AgentRun[] }>(`/api/admin/agent-runs?job_id=${id}`);
      setRuns((r) => ({ ...r, [id]: res.runs }));
    } catch (err) {
      setRuns((r) => ({ ...r, [id]: { error: errorMessage(err) } }));
    }
  }

  async function retry(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/api/admin/jobs/${id}/retry`, { method: "POST" });
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {["queued", "running", "done", "failed"].map((s) => (
          <a
            key={s}
            href={filter === s ? "/admin" : `/admin?status=${s}`}
            aria-current={filter === s ? "true" : undefined}
            className={`inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium ${STATUS_STYLE[s]} ${filter === s ? "ring-2 ring-ring" : ""}`}
          >
            <span className="capitalize">{s}</span>
            <span className="tabular-nums">{counts[s] ?? 0}</span>
          </a>
        ))}
        <Button size="tap" variant="outline" onClick={() => router.refresh()}>
          Refresh
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {jobs.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
          {filter
            ? `No ${filter} jobs.`
            : "No jobs yet. They are created when someone adds a club, pastes a LinkedIn URL, runs a path search, or when you crawl a club below."}
        </p>
      ) : (
        <ul className="mt-3 divide-y rounded-2xl border">
          {jobs.map((j) => {
            const jobRuns = runs[j.id];
            return (
              <li key={j.id} className="px-4 py-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium break-all">{j.type}</div>
                    <div className="text-xs break-all text-muted-foreground">
                      {when(j.created_at)} · attempt {j.attempts}
                      {j.dedupe_key ? ` · ${j.dedupe_key}` : ""}
                    </div>
                  </div>
                  <span className={`inline-flex h-6 items-center rounded-full px-2 text-xs font-medium ${STATUS_STYLE[j.status] ?? ""}`}>
                    {j.status}
                  </span>
                </div>
                {j.error ? <p className="mt-1 text-sm break-words text-destructive">{j.error}</p> : null}
                <div className="mt-1 flex gap-1">
                  <Button
                    size="tap"
                    variant="ghost"
                    className="-ml-3"
                    aria-expanded={open === j.id}
                    onClick={() => toggle(j.id)}
                  >
                    {open === j.id ? "Hide details" : "Agent runs"}
                  </Button>
                  {j.status !== "running" ? (
                    <Button size="tap" variant="ghost" disabled={busy !== null} onClick={() => retry(j.id)}>
                      {busy === j.id ? "Queueing…" : j.status === "queued" ? "Run now" : "Retry"}
                    </Button>
                  ) : null}
                </div>
                {open === j.id ? (
                  <div className="mt-2 space-y-3 text-sm">
                    <div>
                      <div className="mb-1 text-xs font-medium text-muted-foreground">Result</div>
                      <Json value={j.result ?? null} />
                    </div>
                    {jobRuns === "loading" || jobRuns === undefined ? (
                      <p className="text-muted-foreground">Loading agent runs…</p>
                    ) : !Array.isArray(jobRuns) ? (
                      <p role="alert" className="text-destructive">
                        {jobRuns.error}
                      </p>
                    ) : jobRuns.length === 0 ? (
                      <p className="text-muted-foreground">This job has not called an agent yet.</p>
                    ) : (
                      jobRuns.map((r) => (
                        <Fragment key={r.id}>
                          <div className="rounded-xl border p-3">
                            <div className="font-medium">
                              {r.agent} <span className="font-normal text-muted-foreground">· {r.model}</span>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {when(r.created_at)}
                              {r.duration_ms != null ? ` · ${(r.duration_ms / 1000).toFixed(1)} s` : ""}
                            </div>
                            {r.error ? <p className="mt-1 break-words text-destructive">{r.error}</p> : null}
                            <div className="mt-2 mb-1 text-xs font-medium text-muted-foreground">Input</div>
                            <Json value={r.input} />
                            <div className="mt-2 mb-1 text-xs font-medium text-muted-foreground">Output</div>
                            <Json value={r.output} />
                            <div className="mt-2 mb-1 text-xs font-medium text-muted-foreground">Citations</div>
                            <Json value={r.citations ?? []} />
                          </div>
                        </Fragment>
                      ))
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
