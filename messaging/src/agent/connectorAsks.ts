import { normalizePhone } from "../util/phone";

export interface ConnectorAsk {
  introId: string;
  /** Who asked, so the connector can be told whose request is still waiting. */
  requesterName?: string;
}

/**
 * A connector's YES or NO counts as an answer to an intro only when the last
 * thing the bot texted that phone was an intro request. Any later text to
 * the same phone (a normal reply, a notification) clears it, so "yes" to the
 * bot's own question never accepts an intro by accident.
 *
 * Several students can ask the same connector. Their requests wait in a queue
 * and a YES or NO answers the oldest one.
 *
 * Held in memory here and saved per phone through state/store.ts, so in http
 * mode the window survives a restart and is the same on every instance.
 */
const asks = new Map<string, ConnectorAsk[]>();
/** Phones whose next bot text names the request still waiting, so that text must not clear the queue. */
const held = new Set<string>();

function key(phone: string): string {
  try {
    return normalizePhone(phone);
  } catch {
    return phone;
  }
}

/** Call only once the request text has actually gone out. */
export function recordConnectorAsk(phone: string, introId: string, requesterName?: string): void {
  const k = key(phone);
  const queue = asks.get(k) ?? [];
  if (!queue.some((ask) => ask.introId === introId)) queue.push({ introId, requesterName });
  asks.set(k, queue);
  held.delete(k);
}

/** Ends the YES/NO window for every request waiting on this phone. */
export function clearConnectorAsk(phone: string): void {
  const k = key(phone);
  asks.delete(k);
  held.delete(k);
}

/** The oldest request waiting on this phone. */
export function pendingConnectorAsk(phone: string): ConnectorAsk | undefined {
  return asks.get(key(phone))?.[0];
}

/** Every request waiting on this phone, oldest first. */
export function pendingConnectorAsks(phone: string): ConnectorAsk[] {
  return [...(asks.get(key(phone)) ?? [])];
}

/** Drop one request (it was answered) and leave the rest waiting. */
export function removeConnectorAsk(phone: string, introId: string): void {
  const k = key(phone);
  const rest = (asks.get(k) ?? []).filter((ask) => ask.introId !== introId);
  if (rest.length > 0) asks.set(k, rest);
  else asks.delete(k);
}

/** The bot's next text to this phone talks about the waiting request, so it keeps the window open. */
export function holdConnectorAsks(phone: string): void {
  const k = key(phone);
  if (asks.has(k)) held.add(k);
}

/** A text that is not an intro request went out to this phone. */
export function noteOtherTextSent(phone: string): void {
  const k = key(phone);
  if (held.delete(k)) return;
  asks.delete(k);
}

/** This phone's waiting requests, for saving. */
export function exportAsks(phone: string): { asks: ConnectorAsk[]; held: boolean } {
  const k = key(phone);
  return { asks: [...(asks.get(k) ?? [])], held: held.has(k) };
}

/** Replace this phone's waiting requests with saved ones. */
export function importAsks(phone: string, saved: ConnectorAsk[], isHeld: boolean): void {
  const k = key(phone);
  const valid = Array.isArray(saved) ? saved.filter((ask) => ask && typeof ask.introId === "string") : [];
  if (valid.length > 0) asks.set(k, valid);
  else asks.delete(k);
  if (isHeld && valid.length > 0) held.add(k);
  else held.delete(k);
}

export function resetConnectorAsksForTests(): void {
  asks.clear();
  held.clear();
}
