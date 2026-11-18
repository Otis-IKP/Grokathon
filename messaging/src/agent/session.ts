import type Anthropic from "@anthropic-ai/sdk";

const IDLE_MS = 30 * 60 * 1000;
const HISTORY_CAP = 20;

export type HistoryMessage = Anthropic.Beta.BetaMessageParam;

export interface Session {
  userId: string;
  /** Display name for the requester, used when the bot texts a connector. */
  userName: string;
  /** Handset this conversation is happening on. Alias phones share a user id but not this number. */
  phone: string;
  history: HistoryMessage[];
  pendingIntroId?: string;
  /** Turn number that saved the current draft. send_intro must happen on a later turn. */
  pendingIntroTurn?: number;
  /** How many user messages this session has handled. Starts at 0. */
  turn: number;
  lastActive: number;
  /** Connector ids from the latest find_paths call. save_intro_draft may only use these. */
  allowedConnectorIds: string[];
  /** The latest find_paths search, which an intro has to be created from. */
  lastSearch?: { searchId: string; clubId: string };
  latestUserText: string;
}

const sessions = new Map<string, Session>();

export function getSession(phone: string, userId: string, userName = "the student"): Session {
  sweepIdleSessions();
  const existing = sessions.get(phone);
  if (existing && existing.userId === userId) {
    existing.lastActive = Date.now();
    existing.userName = userName;
    return existing;
  }
  const created: Session = {
    userId,
    userName,
    phone,
    history: [],
    turn: 0,
    lastActive: Date.now(),
    allowedConnectorIds: [],
    latestUserText: "",
  };
  sessions.set(phone, created);
  return created;
}

export function clearSession(phone: string): void {
  const session = sessions.get(phone);
  if (session) {
    session.pendingIntroId = undefined;
    session.pendingIntroTurn = undefined;
  }
  sessions.delete(phone);
}

export function clearAllSessions(): void {
  sessions.clear();
}

export function resetSessionsForTests(): void {
  clearAllSessions();
}

export function sweepIdleSessions(now = Date.now()): void {
  for (const [phone, session] of sessions) {
    if (now - session.lastActive > IDLE_MS) sessions.delete(phone);
  }
}

/** A message the student typed, as opposed to a user message that only carries tool results. */
function isStudentText(message: HistoryMessage | undefined): boolean {
  return message?.role === "user" && typeof message.content === "string";
}

/**
 * Keep roughly the last 20 messages, cutting only at a message the student
 * typed so a tool result is never separated from the tool call that produced
 * it. Cutting from the front leaves earlier thinking blocks out of the
 * request; the Claude request sets prefix_mismatch_behavior: "drop_block", so
 * the API drops any block that no longer matches instead of rejecting the call.
 */
export function trimHistory(history: HistoryMessage[], cap = HISTORY_CAP): HistoryMessage[] {
  if (history.length <= cap) return history;
  let start = history.length - cap;
  while (start < history.length && !isStudentText(history[start])) start += 1;
  if (start >= history.length) {
    // No student message in the window: keep from the most recent one.
    start = history.length - 1;
    while (start > 0 && !isStudentText(history[start])) start -= 1;
  }
  return history.slice(start);
}
