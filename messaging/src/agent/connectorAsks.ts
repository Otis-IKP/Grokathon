import { normalizePhone } from "../util/phone";

/**
 * A connector's YES or NO counts as an answer to an intro only when the last
 * thing the bot texted that phone was the intro request. Any later text to
 * the same phone (a normal reply, a notification) clears it, so "yes" to the
 * bot's own question never accepts an intro by accident.
 *
 * In memory: after a restart a connector answers in the app via the link in
 * the request text instead.
 */
const asks = new Map<string, string>();

function key(phone: string): string {
  try {
    return normalizePhone(phone);
  } catch {
    return phone;
  }
}

export function recordConnectorAsk(phone: string, introId: string): void {
  asks.set(key(phone), introId);
}

export function clearConnectorAsk(phone: string): void {
  asks.delete(key(phone));
}

export function pendingConnectorAsk(phone: string): string | undefined {
  return asks.get(key(phone));
}

export function resetConnectorAsksForTests(): void {
  asks.clear();
}
