import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const IDLE_MS = 30 * 60 * 1000;
const HISTORY_CAP = 20;

export interface Session {
  userId: string;
  history: ChatCompletionMessageParam[];
  pendingIntroId?: string;
  /** Turn number that saved the current draft. send_intro must happen on a later turn. */
  pendingIntroTurn?: number;
  /** How many user messages this session has handled. Starts at 0. */
  turn: number;
  lastActive: number;
  /** Connector ids from the latest find_paths call. save_intro_draft may only use these. */
  allowedConnectorIds: string[];
  latestUserText: string;
}

const sessions = new Map<string, Session>();

export function getSession(phone: string, userId: string): Session {
  sweepIdleSessions();
  const existing = sessions.get(phone);
  if (existing && existing.userId === userId) {
    existing.lastActive = Date.now();
    return existing;
  }
  const created: Session = {
    userId,
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

/**
 * Keep the last 20 messages. If that cut would separate a tool result from the
 * assistant tool call that produced it, include the tool call too.
 */
export function trimHistory(history: ChatCompletionMessageParam[], cap = HISTORY_CAP): ChatCompletionMessageParam[] {
  if (history.length <= cap) return history;
  let start = history.length - cap;
  while (start > 0 && history[start]?.role === "tool") start -= 1;
  if (history[start]?.role === "tool") {
    while (start < history.length && history[start]?.role === "tool") start += 1;
  }
  return history.slice(start);
}
