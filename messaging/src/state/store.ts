import { createHash } from "node:crypto";
import { exportAsks, importAsks, type ConnectorAsk } from "../agent/connectorAsks";
import { exportSession, importSession, type Session } from "../agent/session";
import { normalizePhone } from "../util/phone";

/**
 * Everything the bot has to remember about a phone between two texts: the
 * conversation, the draft waiting for "send", and intro requests waiting for a
 * YES or NO. With a store set (http mode: the NEPO app's database), it is read
 * before a phone is handled and written back after, so any server instance can
 * take the next text and a restart loses nothing. Without one (mock mode,
 * tests) the same data simply stays in this process.
 */
export interface PhoneState {
  session?: Session;
  asks?: ConnectorAsk[];
  /** The bot's next text to this phone talks about a waiting request and must not close the window. */
  held?: boolean;
}

export interface StateStore {
  loadState(phone: string): Promise<PhoneState | null>;
  /** `null` forgets the phone. */
  saveState(phone: string, state: PhoneState | null): Promise<void>;
  /** True only for the first caller with this key, across every instance. */
  claim(key: string): Promise<boolean>;
  release(key: string): Promise<void>;
}

let store: StateStore | null = null;
/** Phones being handled right now in this process. Their in-memory state is newer than the store's. */
const active = new Set<string>();
const localClaims = new Set<string>();
const LOCAL_CLAIMS_CAP = 1000;

export function setStateStore(next: StateStore | null): void {
  store = next;
}

export function resetStateForTests(): void {
  store = null;
  active.clear();
  localClaims.clear();
}

function keyOf(phone: string): string {
  try {
    return normalizePhone(phone);
  } catch {
    return phone;
  }
}

function snapshot(phone: string): PhoneState | null {
  const session = exportSession(phone);
  const { asks, held } = exportAsks(phone);
  if (!session && asks.length === 0) return null;
  return { ...(session ? { session } : {}), ...(asks.length > 0 ? { asks, ...(held ? { held: true } : {}) } : {}) };
}

/** Replace what this process remembers about a phone with what the store holds. */
async function hydrate(phone: string): Promise<void> {
  if (!store) return;
  const state = await store.loadState(phone);
  importSession(phone, state?.session);
  importAsks(phone, state?.asks ?? [], state?.held === true);
}

async function persist(phone: string): Promise<void> {
  if (!store) return;
  try {
    await store.saveState(phone, snapshot(phone));
  } catch (error) {
    // The reply still goes out. The next text starts from the last state that was saved.
    const message = error instanceof Error ? error.message : "save failed";
    console.error(`could not save bot state: ${message}`);
  }
}

/**
 * Handle one inbound text for a phone: load its state, run, save it. Callers
 * hold the per-phone lock, so one process never interleaves two texts.
 */
export async function withPhoneState<T>(phone: string, fn: () => Promise<T>): Promise<T> {
  const key = keyOf(phone);
  await hydrate(key);
  active.add(key);
  try {
    return await fn();
  } finally {
    active.delete(key);
    await persist(key);
  }
}

/**
 * Change the YES/NO window of a phone that is not the one being handled (the
 * connector who was just texted, or the requester who was just notified).
 * Loads it first so requests queued by another instance are kept, and saves
 * only if something changed.
 */
export async function updateAsks(phone: string, change: () => void): Promise<void> {
  const key = keyOf(phone);
  if (!store || active.has(key)) {
    // No store, or this phone's own turn will save when it ends.
    change();
    return;
  }
  await hydrate(key);
  const before = JSON.stringify(exportAsks(key));
  change();
  if (JSON.stringify(exportAsks(key)) !== before) await persist(key);
}

/** Forget a phone everywhere ("reset"). */
export async function forgetPhone(phone: string): Promise<void> {
  const key = keyOf(phone);
  importSession(key, undefined);
  if (store && !active.has(key)) await persist(key);
}

/**
 * True the first time a key is seen. Shared across instances when a store is
 * set, so a webhook delivered twice is handled once wherever it lands.
 * Keys can contain a phone number or message text, so only a hash leaves the process.
 */
export async function claimOnce(key: string): Promise<boolean> {
  const hashed = createHash("sha256").update(key).digest("hex").slice(0, 40);
  if (localClaims.has(hashed)) return false;
  localClaims.add(hashed);
  while (localClaims.size > LOCAL_CLAIMS_CAP) {
    const oldest = localClaims.values().next().value;
    if (oldest === undefined) break;
    localClaims.delete(oldest);
  }
  if (!store) return true;
  try {
    return await store.claim(hashed);
  } catch {
    // The app is unreachable: this instance still handles the message once.
    return true;
  }
}

export async function releaseClaim(key: string): Promise<void> {
  const hashed = createHash("sha256").update(key).digest("hex").slice(0, 40);
  localClaims.delete(hashed);
  if (store) await store.release(hashed).catch(() => undefined);
}
