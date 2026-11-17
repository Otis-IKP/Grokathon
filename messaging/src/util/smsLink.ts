/**
 * iOS Messages draft link. The spec's format is `sms:+1555&body=...`, not `?body=`.
 */
export function smsLink(phone: string, body: string): string {
  return `sms:${phone}&body=${encodeURIComponent(body)}`;
}
