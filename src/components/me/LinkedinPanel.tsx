"use client";

import { useEffect, useRef, useState } from "react";
import { CircleCheck, FileUp, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import type { LinkedinState } from "./types";

const POLL_MS = 2000;
const MAX_POLLS = 60;

/**
 * LinkedIn: URL first, PDF fallback (section 7.1). After a URL or PDF is
 * submitted this polls GET /api/linkedin/status and shows: reading → found N
 * clubs, or "upload the PDF instead", or the "is this you?" confirmation
 * when the PDF's name does not match.
 */
export function LinkedinPanel({ initial, onChanged }: { initial: LinkedinState; onChanged?: () => void }) {
  const [state, setState] = useState<LinkedinState>(initial);
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState<"url" | "pdf" | "confirm" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [showPdf, setShowPdf] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  });

  const reading = state.status === "reading";

  useEffect(() => {
    if (!reading) return;
    let polls = 0;
    const timer = setInterval(async () => {
      polls++;
      try {
        const next = await api<LinkedinState>("/api/linkedin/status");
        if (next.status !== "reading") {
          setState(next);
          onChangedRef.current?.();
          return;
        }
      } catch {
        // keep polling
      }
      if (polls >= MAX_POLLS) {
        clearInterval(timer);
        setTimedOut(true);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [reading]);

  async function submitUrl(e: React.FormEvent) {
    e.preventDefault();
    setPending("url");
    setError(null);
    setTimedOut(false);
    try {
      await api("/api/linkedin/url", { body: { url } });
      setState({ status: "reading", found: [], needs_confirmation: false, profile_name: null, reason: null });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  }

  async function uploadPdf(file: File | undefined) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("That PDF is larger than 5 MB.");
      return;
    }
    setPending("pdf");
    setError(null);
    setTimedOut(false);
    try {
      const form = new FormData();
      form.append("file", file);
      await api("/api/linkedin/pdf", { body: form });
      setState({ status: "reading", found: [], needs_confirmation: false, profile_name: null, reason: null });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function confirm(yes: boolean) {
    setPending("confirm");
    setError(null);
    try {
      const res = await api<{ status: LinkedinState["status"]; found: LinkedinState["found"] }>("/api/linkedin/confirm", {
        body: { confirm: yes },
      });
      setState({ status: res.status, found: res.found, needs_confirmation: false, profile_name: null, reason: null });
      onChangedRef.current?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  }

  const clubs = state.found.filter((f) => f.kind === "yale_club");
  const wantsPdf = showPdf || state.status === "needs_pdf" || (state.status === "mismatch" && !state.needs_confirmation);

  return (
    <div className="space-y-3">
      {reading ? (
        <div className="flex items-center gap-3 rounded-xl bg-muted px-4 py-3" aria-live="polite">
          <LoaderCircle className="size-5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
          <div>
            <div className="font-medium">Reading your profile…</div>
            <div className="text-sm text-muted-foreground">
              {timedOut ? "This is taking longer than usual. You can carry on; your clubs will appear when it finishes." : "Usually under a minute."}
            </div>
          </div>
        </div>
      ) : null}

      {state.status === "ok" ? (
        <div className="rounded-xl bg-success-soft px-4 py-3 text-success" aria-live="polite">
          <div className="flex items-center gap-2 font-medium">
            <CircleCheck className="size-5 shrink-0" aria-hidden />
            {clubs.length === 0
              ? "Read your profile, but found no Yale clubs on it"
              : `Found ${clubs.length} ${clubs.length === 1 ? "club" : "clubs"}`}
          </div>
          {clubs.length > 0 ? (
            <ul className="mt-1 list-disc pl-9 text-sm">
              {clubs.map((c, i) => (
                <li key={`${c.org_name}-${i}`}>
                  {c.club_name ?? c.org_name}
                  {c.role_title ? `, ${c.role_title}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 pl-7 text-sm">Add your clubs yourself below.</p>
          )}
        </div>
      ) : null}

      {state.needs_confirmation ? (
        <div className="rounded-2xl border p-4" role="group" aria-label="Confirm this profile is yours">
          <p className="font-medium">
            This PDF looks like it belongs to {state.profile_name || "someone else"}. Is that you?
          </p>
          <p className="mt-1 text-sm text-muted-foreground">Nothing from it is saved unless you say yes.</p>
          <div className="mt-3 flex gap-2">
            <Button size="tap" className="flex-1" disabled={pending !== null} onClick={() => confirm(true)}>
              {pending === "confirm" ? "Saving…" : "Yes, that's me"}
            </Button>
            <Button size="tap" variant="outline" className="flex-1" disabled={pending !== null} onClick={() => confirm(false)}>
              No, discard it
            </Button>
          </div>
        </div>
      ) : null}

      {state.status === "needs_pdf" ? (
        <p role="status" className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">
          LinkedIn wouldn&apos;t let us read your profile. Upload the PDF instead.
        </p>
      ) : null}
      {state.status === "mismatch" && !state.needs_confirmation ? (
        <p role="status" className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">
          That profile doesn&apos;t look like yours, so nothing was saved. Check the URL, or upload the PDF of your own
          profile.
        </p>
      ) : null}
      {state.status === "failed" ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          We couldn&apos;t finish reading your profile. Try again, or upload the PDF.
        </p>
      ) : null}

      {!reading && !state.needs_confirmation ? (
        <>
          <form onSubmit={submitUrl} className="space-y-2">
            <Label htmlFor="linkedin-url">
              {state.status === "ok" ? "Read it again" : "Paste your LinkedIn URL"}
            </Label>
            <div className="flex gap-2">
              <Input
                id="linkedin-url"
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="linkedin.com/in/your-name"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="h-11"
              />
              <Button type="submit" size="tap" disabled={pending !== null || url.trim().length < 8}>
                {pending === "url" ? "Sending…" : "Read"}
              </Button>
            </div>
          </form>

          {wantsPdf ? (
            <div className="rounded-2xl border p-4">
              <p className="font-medium">Upload your profile as a PDF</p>
              <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm text-muted-foreground">
                <li>Open your own profile on LinkedIn.</li>
                <li>Choose More, then Save to PDF.</li>
                <li>Upload that file here.</li>
              </ol>
              <input
                ref={fileRef}
                id="linkedin-pdf"
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                onChange={(e) => uploadPdf(e.target.files?.[0])}
              />
              <Button
                type="button"
                size="tap"
                variant="outline"
                className="mt-3 w-full"
                disabled={pending !== null}
                onClick={() => fileRef.current?.click()}
              >
                <FileUp aria-hidden />
                {pending === "pdf" ? "Uploading…" : "Choose PDF"}
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                The file is read once and discarded. Only the organisations and roles on it are kept. 5 MB at most.
              </p>
            </div>
          ) : (
            <Button type="button" variant="link" className="h-11 px-0" onClick={() => setShowPdf(true)}>
              Upload a LinkedIn PDF instead
            </Button>
          )}
        </>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
