import { createHash } from "node:crypto";

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Replace sensitive text with a hash so logs and agent_runs never hold it (privacy rules 9 and 11). */
export function hashedPlaceholder(text: string): { sha256: string; length: number } {
  return { sha256: sha256(text), length: text.length };
}

/** Mask anything that looks like a phone number before it reaches a log line. */
export function redactPhones(text: string): string {
  return text.replace(/\+?\d[\d\s().-]{8,}\d/g, "[phone]");
}
