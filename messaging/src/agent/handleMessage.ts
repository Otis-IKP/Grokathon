import Anthropic from "@anthropic-ai/sdk";
import { getConfig } from "../config";
import { getBackend } from "../backend/Backend";
import { MockBackend } from "../backend/MockBackend";
import { IntroAlreadyAnsweredError } from "../types";
import { phoneLast4, normalizePhone } from "../util/phone";
import { sendText } from "../transport/sendblue";
import { buildSystemPrompt } from "./systemPrompt";
import { clearSession, getSession, trimHistory, type HistoryMessage, type Session } from "./session";
import { clearConnectorAsk, pendingConnectorAsk } from "./connectorAsks";
import { executeTool, toolDefinitions } from "./tools";

const MAX_MODEL_CALLS = 6;
const MAX_TOKENS = 16000;
const TANGLED = "Sorry, I got tangled up. Can you rephrase?";
const SNAG = "NEPO hit a snag on my end. Try again in a sec.";
const DECLINED = "I can't help with that one. Want to find a warm intro to a club instead?";
const RESET_RE = /^\s*(reset|start over)\s*[.!]?\s*$/i;
const ACCEPT_RE = /^\s*(yes|yep|yeah|y|ok|okay)\s*[.!]?\s*$/i;
const DECLINE_RE = /^\s*(no thanks|nope|nah|no)\s*[.!]?\s*$/i;
const CODE_RE = /^\s*(\d{6})\s*$/;

/**
 * Betas this request uses:
 * - server-side-fallback: if Claude's safety classifiers decline, the API reruns
 *   the request on Anthropic's recommended fallback model instead of refusing.
 * - thinking-binding-controls: trimHistory cuts old turns, so thinking blocks
 *   that no longer match their conversation are dropped instead of rejected.
 */
const BETAS: Anthropic.Beta.AnthropicBeta[] = ["server-side-fallback-2026-07-01", "thinking-binding-controls-2026-08-01"];
/** Models that accept `fallbacks: "default"`. Others (e.g. Haiku) run without it. */
const DEFAULT_FALLBACK_MODELS = new Set([
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-fable-5-2",
  "claude-fable-5-1",
  "claude-sonnet-5-5",
]);

type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming;
export type ClaudeClient = {
  beta: { messages: { create: (body: CreateParams) => Promise<Anthropic.Beta.BetaMessage> } };
};

const locks = new Map<string, Promise<void>>();
let clientOverride: ClaudeClient | null = null;
let clientCached: Anthropic | null = null;

export function setClaudeClientForTests(client: ClaudeClient | null): void {
  clientOverride = client;
  clientCached = null;
}

export async function handleMessage(phone: string, text: string): Promise<string[]> {
  let normalized: string;
  try {
    normalized = normalizePhone(phone);
  } catch {
    return ["That phone number didn't look right. Try the full number, including the country code."];
  }
  return withPhoneLock(normalized, async () => {
    try {
      return await handleLocked(normalized, text);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`NEPO error for ***${phoneLast4(normalized)}: ${message}`);
      return [SNAG];
    }
  });
}

async function handleLocked(phone: string, text: string): Promise<string[]> {
  const askedIntroId = pendingConnectorAsk(phone);
  const decision = ACCEPT_RE.test(text) ? "accept" : DECLINE_RE.test(text) ? "decline" : null;
  if (askedIntroId && decision) return answerAsConnector(askedIntroId, phone, decision);
  // Anything else from this phone ends the window for a YES/NO answer; the bot is about to reply.
  clearConnectorAsk(phone);

  const backend = getBackend();
  const user = backend instanceof MockBackend ? backend.ensureStudent(phone) : await backend.getUserByPhone(phone);
  if (!user) return handleUnlinkedPhone(phone, text);

  if (RESET_RE.test(text)) {
    clearSession(phone);
    return ["Fresh start. What club are you aiming for?"];
  }

  const session = getSession(phone, user.id, user.name);
  session.latestUserText = text;
  session.history.push({ role: "user", content: text });
  session.turn += 1;

  const bubbles = await runModel(session, user.name, user.college);
  session.history = trimHistory(session.history);
  session.lastActive = Date.now();
  return bubbles;
}

async function answerAsConnector(introId: string, phone: string, decision: "accept" | "decline"): Promise<string[]> {
  clearConnectorAsk(phone);
  let answer;
  try {
    answer = await getBackend().answerIntro(introId, phone, decision);
  } catch (error) {
    if (error instanceof IntroAlreadyAnsweredError) return ["Looks like you already answered that one. Thanks!"];
    throw error;
  }
  if (answer.requesterPhone) {
    const notice =
      decision === "accept"
        ? `${answer.connectorName} accepted your intro request for ${answer.clubName}! They'll reach out.`
        : `${answer.connectorName} can't make the intro right now. Want me to try your next-best path?`;
    await sendText(answer.requesterPhone, notice);
  }
  return [`Thanks, I've let ${answer.requesterName} know.`];
}

/** A phone with no NEPO account: link it with the app's 6-digit code, or point them to sign up. */
async function handleUnlinkedPhone(phone: string, text: string): Promise<string[]> {
  const signup = getConfig().SIGNUP_URL;
  const code = text.match(CODE_RE)?.[1];
  if (code) {
    const result = await getBackend().linkPhone(phone, code);
    if (result.ok) {
      const first = result.user.name.split(" ")[0] || "there";
      return [`You're linked, ${first}! What club are you aiming for?`];
    }
    return result.reason === "code_expired"
      ? ["That code has expired. Get a fresh one in the NEPO app and text it to me."]
      : ["That code didn't work. Get a fresh one in the NEPO app and text it to me."];
  }
  return [
    `Hey! I'm NEPO. I help you get warm intros to Yale clubs through people you already know. Sign up here first: ${signup}`,
    "Then text me the 6-digit code the app shows you to link this phone.",
  ];
}

async function runModel(session: Session, name: string, college?: string): Promise<string[]> {
  const config = getConfig();
  const client = getClaudeClient();
  const system = buildSystemPrompt({ id: session.userId, name, phone: "", suggestible: true, college });

  for (let call = 0; call < MAX_MODEL_CALLS; call += 1) {
    const response = await client.beta.messages.create({
      model: config.CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      betas: BETAS,
      ...(DEFAULT_FALLBACK_MODELS.has(config.CLAUDE_MODEL) ? { fallbacks: "default" as const } : {}),
      thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
      output_config: { effort: config.CLAUDE_EFFORT },
      system,
      tools: toolDefinitions,
      messages: session.history,
    });

    if (response.stop_reason === "refusal") return [DECLINED];
    if (response.stop_reason === "max_tokens") return [TANGLED];

    const content = echoableContent(response.content);
    const toolUses = content.filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use");
    session.history.push({ role: "assistant", content: content as Anthropic.Beta.BetaContentBlockParam[] });

    if (toolUses.length === 0) {
      const text = content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n\n");
      const bubbles = toBubbles(text);
      return bubbles.length > 0 ? bubbles : [TANGLED];
    }

    // All results go back in one user message, as the API expects for parallel tool calls.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      const result = await executeTool(toolUse.name, toolUse.input, session);
      const failed = typeof result === "object" && result !== null && "error" in result;
      results.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
        ...(failed ? { is_error: true } : {}),
      });
    }
    session.history.push({ role: "user", content: results } satisfies HistoryMessage);
  }

  return [TANGLED];
}

/**
 * After a fallback, thinking and tool_use blocks that come before the last
 * `fallback` block belong to the model that declined: they are not echoed back
 * and their tool calls are not run. The `fallback` block itself stays in place.
 */
export function echoableContent(content: Anthropic.Beta.BetaContentBlock[]): Anthropic.Beta.BetaContentBlock[] {
  const boundary = content.map((block) => block.type).lastIndexOf("fallback");
  if (boundary <= 0) return content;
  const dropped = new Set(["thinking", "redacted_thinking", "tool_use"]);
  return content.filter((block, index) => index >= boundary || !dropped.has(block.type));
}

export function toBubbles(raw: string): string[] {
  const stripped = raw
    .replace(/\*\*(.*?)\*\*/gs, "$1")
    .replace(/__(.*?)__/gs, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .trim();
  const parts = stripped
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 3) return parts;
  return [parts[0]!, parts[1]!, parts.slice(2).join("\n")];
}

function getClaudeClient(): ClaudeClient {
  if (clientOverride) return clientOverride;
  if (!clientCached) {
    clientCached = new Anthropic({ apiKey: getConfig().ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 2 });
  }
  return clientCached as unknown as ClaudeClient;
}

function withPhoneLock<T>(phone: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(phone) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  locks.set(
    phone,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}
