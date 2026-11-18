import { AppError } from "@/lib/errors";
import { env } from "@/server/env";

const CAS_BASE = "https://secure.its.yale.edu/cas";

/**
 * Only same-origin relative paths: must start with `/` and not `//` or `/\`.
 * Control characters and backslashes are refused anywhere, because browsers
 * drop tabs and newlines from URLs and read `\` as `/`, which would turn
 * `/<tab>/evil.com` into `//evil.com`.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return "/";
  return next;
}

/**
 * The CAS `service` URL. It must be byte-identical between `login` and
 * `serviceValidate`, so it is built here and nowhere else. It never contains
 * the ticket.
 */
export function casServiceUrl(next: string): string {
  return `${env().APP_URL}/api/auth/cas/callback?next=${encodeURIComponent(safeNext(next))}`;
}

export function casLoginUrl(next: string): string {
  return `${CAS_BASE}/login?service=${encodeURIComponent(casServiceUrl(next))}`;
}

export function casLogoutUrl(): string {
  return `${CAS_BASE}/logout`;
}

/** Strict parse of the serviceValidate XML. The NetID only ever comes from here. */
export function parseCasResponse(xml: string): { ok: true; netid: string } | { ok: false; code: string } {
  const failure = xml.match(/<cas:authenticationFailure[^>]*code="([^"]*)"/);
  if (failure) return { ok: false, code: failure[1] || "UNKNOWN" };
  const success = xml.match(
    /<cas:authenticationSuccess>[\s\S]*?<cas:user>\s*([A-Za-z0-9_.-]{1,32})\s*<\/cas:user>[\s\S]*?<\/cas:authenticationSuccess>/,
  );
  if (success) return { ok: true, netid: success[1].toLowerCase() };
  return { ok: false, code: "MALFORMED_RESPONSE" };
}

export async function validateCasTicket(ticket: string, next: string): Promise<string> {
  const url = `${CAS_BASE}/serviceValidate?service=${encodeURIComponent(casServiceUrl(next))}&ticket=${encodeURIComponent(ticket)}`;
  let xml: string;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    xml = await res.text();
  } catch {
    throw new AppError("cas_failed", "Could not reach Yale CAS to check the sign-in.");
  }
  const parsed = parseCasResponse(xml);
  if (!parsed.ok) throw new AppError("cas_failed", `Yale CAS did not accept the sign-in (${parsed.code}).`);
  return parsed.netid;
}
