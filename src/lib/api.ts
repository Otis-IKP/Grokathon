"use client";

/** Thrown by `api()` for any non-2xx response. `code` is one of the stable codes in lib/errors.ts. */
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public issues?: unknown,
  ) {
    super(message);
  }
}

/** Fetch the App API. JSON in and out; a FormData body is sent as multipart. */
export async function api<T = unknown>(
  path: string,
  opts: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  const res = await fetch(path, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers: opts.body !== undefined && !isForm ? { "Content-Type": "application/json" } : undefined,
    body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
    signal: opts.signal,
    cache: "no-store",
  });
  if (res.status === 401 && typeof window !== "undefined") {
    // The session expired: a full navigation, so the server-side sign-in redirect runs.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // empty or non-JSON body
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; issues?: unknown } } | null)?.error;
    throw new ApiError(err?.code ?? "internal_error", err?.message ?? "Something went wrong.", res.status, err?.issues);
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}
