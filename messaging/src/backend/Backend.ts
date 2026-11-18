import type { Backend } from "../types";

export type { Backend };

let active: Backend | null = null;

export function setBackend(backend: Backend): void {
  active = backend;
}

export function getBackend(): Backend {
  if (!active) throw new Error("Backend is not initialized");
  return active;
}

export class BackendError extends Error {
  readonly status: number;
  /** The app's stable error code (user_not_linked, invalid_state, ...), when it sent one. */
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "BackendError";
    this.status = status;
    this.code = code;
  }
}
