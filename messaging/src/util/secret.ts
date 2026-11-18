import { timingSafeEqual } from "node:crypto";

/** Compare two secrets without leaking, through timing, how much of the guess was right. */
export function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
