/**
 * Normalise a phone string to E.164.
 * 10-digit US numbers gain +1. Numbers that already include a country code keep it.
 */
export function normalizePhone(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Phone number is empty");
  }
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) {
    throw new Error(`Could not read a phone number from "${input}"`);
  }
  if (hasPlus) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

export function phoneLast4(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-4).padStart(4, "*");
}
