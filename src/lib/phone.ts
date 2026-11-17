import { parsePhoneNumberFromString } from "libphonenumber-js";
import { AppError } from "./errors";

/** Normalise to E.164 (`+12035550100`), default region US. Throws `invalid_phone`. */
export function normalizePhone(input: string): string {
  const parsed = parsePhoneNumberFromString(input.trim(), "US");
  // isPossible rather than isValid: 555 numbers used in demos are possible but not assigned.
  if (!parsed || !parsed.isPossible()) throw new AppError("invalid_phone", "That phone number is not valid.");
  return parsed.number;
}

export function tryNormalizePhone(input: string): string | null {
  try {
    return normalizePhone(input);
  } catch {
    return null;
  }
}

/** `+12035550100` → `••• ••• 0100`. The full number is never shown back in the UI. */
export function maskPhone(e164: string): string {
  return `••• ••• ${e164.slice(-4)}`;
}
