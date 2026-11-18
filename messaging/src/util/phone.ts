/**
 * Normalise a phone string to E.164.
 * 10-digit US numbers gain +1, and 11 digits starting with 1 gain the +.
 * Anything else must already be written as + followed by 8 to 15 digits.
 * Error messages never repeat the input, so a bad number can't end up in a log.
 */
export function normalizePhone(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Phone number is empty");
  }
  if (/[^\d\s()+.\-]/.test(trimmed) || trimmed.indexOf("+", 1) !== -1) {
    throw new Error("Phone number has characters that are not part of a number");
  }
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (hasPlus) {
    if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) {
      throw new Error("Phone number is not a valid international number");
    }
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  throw new Error("Phone number needs 10 digits, or a + and the country code");
}

export function phoneLast4(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-4).padStart(4, "*");
}
