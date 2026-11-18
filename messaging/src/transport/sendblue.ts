import type { Express } from "express";
import { getConfig } from "../config";
import { normalizePhone, phoneLast4 } from "../util/phone";
import { sameSecret } from "../util/secret";
import { settleWithin } from "../util/settle";
import { claimOnce, resetStateForTests, updateAsks } from "../state/store";
import { noteOtherTextSent, recordConnectorAsk, resetConnectorAsksForTests } from "../agent/connectorAsks";

const SEND_GAP_MS = 1100;
/**
 * How long the webhook waits for a message to be handled before it answers
 * anyway. A serverless host may freeze the function once the response is sent,
 * so the answer normally comes after the work.
 */
export const WEBHOOK_MAX_WAIT_MS = 25_000;

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
  resetStateForTests();
}

export function webhookDrained(): Promise<void> {
  return webhookTail;
}

/**
 * Queue a text. Pass `ask` when the text is an intro request to a connector;
 * any other text to that phone ends the window for a YES/NO answer. Either way
 * the window only changes once the text has gone out, so a failed send leaves
 * no request armed.
 */
export async function sendText(
  to: string,
  content: string,
  options: { ask?: { introId: string; requesterName?: string } } = {},
): Promise<void> {
  const run = chain.then(async () => {
    const config = getConfig();
    if (config.DRY_RUN) {
      // Dry-run is the local demo: the body is the output. The number is still masked.
      console.log(`[dry-run] text to ***${phoneLast4(to)}: ${content}`);
      observer?.(to, content);
    } else {
      if (lastSentAt > 0) {
        const wait = SEND_GAP_MS - (Date.now() - lastSentAt);
        if (wait > 0) await delay(wait);
      }
      await postWithOneRetry(to, content);
      lastSentAt = Date.now();
    }
    const ask = options.ask;
    // Saved per phone, so the YES/NO window is the same on whichever instance gets the reply.
    await updateAsks(to, () => {
      if (ask) recordConnectorAsk(to, ask.introId, ask.requesterName);
      else noteOtherTextSent(to);
    });
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * The webhook answers after the message is handled (or after `maxWaitMs`), so
 * a serverless function is not frozen mid-work. Sendblue retries are harmless:
 * a repeated payload is dropped by the dedupe in processSendbluePayload.
 */
export function mountSendblue(app: Express, handle: MessageHandler, options: { maxWaitMs?: number } = {}): void {
  const maxWaitMs = options.maxWaitMs ?? WEBHOOK_MAX_WAIT_MS;
  app.post("/webhooks/sendblue", async (req, res) => {
    const secret = typeof req.query.secret === "string" ? req.query.secret : "";
    if (!sameSecret(secret, getConfig().WEBHOOK_SECRET)) {
      res.status(401).json({ error: "bad secret" });
      return;
    }
    const body = (req.body ?? {}) as SendblueInbound;
    const job = processSendbluePayload(body, handle).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "webhook failed";
      console.error(`sendblue webhook failed: ${message}`);
    });
    webhookTail = webhookTail.then(
      () => job,
      () => job,
    );
    await settleWithin(job, maxWaitMs);
    res.status(200).json({ ok: true });
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
  // Claimed once across every instance, so a retried delivery is handled once wherever it lands.
  const key = `${from}|${body.date_sent ?? ""}|${content}`;
  if (!remember(key) || !(await claimOnce(`sendblue:${key}`))) return;
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
    const name = error instanceof Error ? error.name : "error";
    throw new Error(`sendblue network error (${name})`);
  }
  if (!response.ok) {
    // Status only: the response body can repeat the number or the message.
    throw new SendblueHttpError(response.status, `sendblue returned ${response.status}`);
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof SendblueHttpError) return error.status >= 500;
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
