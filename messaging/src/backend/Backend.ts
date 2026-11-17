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

  constructor(status: number, message: string) {
    super(message);
    this.name = "BackendError";
    this.status = status;
  }
}
