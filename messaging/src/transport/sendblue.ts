import type { Express } from "express";
import { getConfig } from "../config";
import { normalizePhone } from "../util/phone";
import { clearConnectorAsk, recordConnectorAsk, resetConnectorAsksForTests } from "../agent/connectorAsks";

const SEND_GAP_MS = 1100;

export interface SendblueInbound {
  from_number?: string;
  content?: string;
  to_number?: string;
  group_id?: string | null;
  date_sent?: string;
  is_outbound?: boolean | string;
}

type MessageHandler = (phone: string, text: string) => Promise<string[]>;
type OutboundObserver = (to: string, content: string) => void;

let chain: Promise<void> = Promise.resolve();
let lastSentAt = 0;
let observer: OutboundObserver | null = null;
let webhookTail: Promise<void> = Promise.resolve();
const seenWebhookKeys = new Map<string, true>();

export function setOutboundObserver(next: OutboundObserver | null): void {
  observer = next;
}

export function resetSendblueForTests(): void {
  chain = Promise.resolve();
  lastSentAt = 0;
  observer = null;
  webhookTail = Promise.resolve();
  seenWebhookKeys.clear();
  resetConnectorAsksForTests();
}

export function webhookDrained(): Promise<void> {
  return webhookTail;
}

/**
 * Queue a text. Pass `askIntroId` when the text is an intro request to a
 * connector; any other text to that phone ends the window for a YES/NO answer.
 */
export async function sendText(to: string, content: string, options: { askIntroId?: string } = {}): Promise<void> {
  if (options.askIntroId) recordConnectorAsk(to, options.askIntroId);
  else clearConnectorAsk(to);
  const run = chain.then(async () => {
    const config = getConfig();
    if (!config.DRY_RUN && lastSentAt > 0) {
      const wait = SEND_GAP_MS - (Date.now() - lastSentAt);
      if (wait > 0) await delay(wait);
    }
    if (config.DRY_RUN) {
      console.log(`[dry-run] text to ${to}: ${content}`);
      observer?.(to, content);
      return;
    }
    await postWithOneRetry(to, content);
    lastSentAt = Date.now();
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function mountSendblue(app: Express, handle: MessageHandler): void {
  app.post("/webhooks/sendblue", (req, res) => {
    const secret = typeof req.query.secret === "string" ? req.query.secret : "";
    if (secret !== getConfig().WEBHOOK_SECRET) {
      res.status(401).json({ error: "bad secret" });
      return;
    }
    const body = (req.body ?? {}) as SendblueInbound;
    res.status(200).json({ ok: true });
    const job = processSendbluePayload(body, handle).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "webhook failed";
      console.error(`sendblue webhook failed: ${message}`);
    });
    webhookTail = webhookTail.then(
      () => job.then(() => undefined),
      () => job.then(() => undefined),
    );
  });
}

export async function processSendbluePayload(body: SendblueInbound, handle: MessageHandler): Promise<void> {
  if (body.is_outbound === true || body.is_outbound === "true") return;
  if (body.group_id) return;
  const content = body.content ?? "";
  if (!content.trim()) return;
  const from = body.from_number ?? "";
  if (!from) return;
  const config = getConfig();
  if (config.SENDBLUE_FROM_NUMBER && samePhone(from, config.SENDBLUE_FROM_NUMBER)) return;
  const key = `${from}|${body.date_sent ?? ""}|${content}`;
  if (!remember(key)) return;
  const replies = await handle(from, content);
  for (const reply of replies) {
    await sendText(from, reply);
  }
}

function remember(key: string): boolean {
  if (seenWebhookKeys.has(key)) return false;
  seenWebhookKeys.set(key, true);
  while (seenWebhookKeys.size > 500) {
    const oldest = seenWebhookKeys.keys().next().value;
    if (oldest === undefined) break;
    seenWebhookKeys.delete(oldest);
  }
  return true;
}

function samePhone(a: string, b: string): boolean {
  try {
    return normalizePhone(a) === normalizePhone(b);
  } catch {
    return a === b;
  }
}

class SendblueHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function postWithOneRetry(to: string, content: string): Promise<void> {
  try {
    await postOnce(to, content);
  } catch (error) {
    if (!isRetryable(error)) throw error;
    await postOnce(to, content);
  }
}

async function postOnce(to: string, content: string): Promise<void> {
  const config = getConfig();
  let response: Response;
  try {
    response = await fetch("https://api.sendblue.co/api/send-message", {
      method: "POST",
      headers: {
        "sb-api-key-id": config.SENDBLUE_API_KEY_ID,
        "sb-api-secret-key": config.SENDBLUE_API_SECRET,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        number: to,
        from_number: config.SENDBLUE_FROM_NUMBER,
        content,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "network error";
    throw new Error(`sendblue network error: ${message}`);
  }
  if (!response.ok) {
    const text = await response.text();
    throw new SendblueHttpError(response.status, `sendblue ${response.status}: ${text.slice(0, 200)}`);
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof SendblueHttpError) return error.status >= 500;
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
