import Anthropic from "@anthropic-ai/sdk";
import { getConfig } from "../config";
import { getBackend } from "../backend/Backend";
import { MockBackend } from "../backend/MockBackend";
import { IntroAlreadyAnsweredError } from "../types";
import { phoneLast4, normalizePhone } from "../util/phone";
import { sendText } from "../transport/sendblue";
import { buildSystemPrompt } from "./systemPrompt";
import { clearSession, getSession, trimHistory, type HistoryMessage, type Session } from "./session";
import {
  clearConnectorAsk,
  holdConnectorAsks,
  pendingConnectorAsk,
  removeConnectorAsk,
  type ConnectorAsk,
} from "./connectorAsks";
import { executeTool, toolDefinitions } from "./tools";
import { forgetPhone, withPhoneState } from "../state/store";

const MAX_MODEL_CALLS = 6;
const MAX_TOKENS = 16000;
const TANGLED = "Sorry, I got tangled up. Can you rephrase?";
const SNAG = "NEPO hit a snag on my end. Try again in a sec.";
const DECLINED = "I can't help with that one. Want to find a warm intro to a club instead?";
const SENT_SUMMARY = "Your intro text went out. I'll let you know when they answer.";
const DRAFT_SUMMARY = "I saved your draft. Reply 'send' and I'll text it for you, or tell me what to change.";
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
      // Load this phone's saved state, handle the text, save it back (state/store.ts).
      return await withPhoneState(normalized, () => handleLocked(normalized, text));
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`NEPO error for ***${phoneLast4(normalized)}: ${message}`);
      return [SNAG];
    }
  });
}

async function handleLocked(phone: string, text: string): Promise<string[]> {
  const ask = pendingConnectorAsk(phone);
  const decision = ACCEPT_RE.test(text) ? "accept" : DECLINE_RE.test(text) ? "decline" : null;
  if (ask && decision) return answerAsConnector(ask, phone, decision);
  // Anything else from this phone ends the window for a YES/NO answer; the bot is about to reply.
  clearConnectorAsk(phone);

  const backend = getBackend();
  const user = backend instanceof MockBackend ? backend.ensureStudent(phone) : await backend.getUserByPhone(phone);
  if (!user) return handleUnlinkedPhone(phone, text);

  if (RESET_RE.test(text)) {
    clearSession(phone);
    await forgetPhone(phone);
    return ["Fresh start. What club are you aiming for?"];
  }

  const session = getSession(phone, user.id, user.name);
  session.latestUserText = text;
  const turnStart = session.history.length;
  session.history.push({ role: "user", content: text });
  session.turn += 1;

  const outcome = await runModel(session, user.name, user.college);
  // A refused turn would be refused again on every later request, so it is not kept.
  if (outcome.refused) session.history.length = Math.min(turnStart, session.history.length);
  session.history = trimHistory(session.history);
  session.lastActive = Date.now();
  return outcome.bubbles;
}

/**
 * A YES or NO answers the oldest request waiting on this phone. The reply names
 * whose request that was and, if another one is waiting, who it is from.
 */
async function answerAsConnector(ask: ConnectorAsk, phone: string, decision: "accept" | "decline"): Promise<string[]> {
  let reply: string;
  try {
    const answer = await getBackend().answerIntro(ask.introId, phone, decision);
    if (answer.requesterPhone) {
      const notice =
        decision === "accept"
          ? `${answer.connectorName} accepted your intro request for ${answer.clubName}! They'll reach out.`
          : `${answer.connectorName} can't make the intro right now. Want me to try your next-best path?`;
      // The answer is recorded either way; the requester also sees it in the app.
      await sendText(answer.requesterPhone, notice).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "send failed";
        console.error(`could not text the requester about an intro answer: ${message}`);
      });
    }
    reply = `Thanks, I've let ${answer.requesterName} know.`;
  } catch (error) {
    if (!(error instanceof IntroAlreadyAnsweredError)) {
      // Not answered: the bot's "try again" text keeps the request waiting.
      holdConnectorAsks(phone);
      throw error;
    }
    reply = "Looks like you already answered that one. Thanks!";
  }
  removeConnectorAsk(phone, ask.introId);
  const next = pendingConnectorAsk(phone);
  if (!next) return [reply];
  holdConnectorAsks(phone);
  const from = next.requesterName && next.requesterName !== "the student" ? `, from ${next.requesterName}` : "";
  return [`${reply} You have another intro request waiting${from}. Reply YES or NO for that one.`];
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

interface ModelOutcome {
  bubbles: string[];
  /** The whole chain declined this turn. */
  refused?: boolean;
}

/** What the tools actually did this turn, for a truthful reply when the model does not give one. */
interface TurnEffects {
  draftSaved: boolean;
  introSent: boolean;
}

function summarize(effects: TurnEffects): string | null {
  if (effects.introSent) return SENT_SUMMARY;
  if (effects.draftSaved) return DRAFT_SUMMARY;
  return null;
}

function noteEffect(effects: TurnEffects, tool: string, result: unknown): void {
  if (typeof result !== "object" || result === null || "error" in result) return;
  if (tool === "send_intro" && "sent" in result && result.sent === true) {
    effects.introSent = true;
    effects.draftSaved = false;
  }
  if (tool === "save_intro_draft" && "introId" in result) effects.draftSaved = true;
}

async function runModel(session: Session, name: string, college?: string): Promise<ModelOutcome> {
  const config = getConfig();
  const client = getClaudeClient();
  const system = buildSystemPrompt({ id: session.userId, name, phone: "", suggestible: true, college });
  const effects: TurnEffects = { draftSaved: false, introSent: false };

  for (let call = 0; call < MAX_MODEL_CALLS; call += 1) {
    // The last call may not use tools, so the turn always ends with a reply about what was done.
    const finalCall = call === MAX_MODEL_CALLS - 1;
    const response = await client.beta.messages.create({
      model: config.CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      betas: BETAS,
      ...(DEFAULT_FALLBACK_MODELS.has(config.CLAUDE_MODEL) ? { fallbacks: "default" as const } : {}),
      thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
      output_config: { effort: config.CLAUDE_EFFORT },
      system,
      tools: toolDefinitions,
      ...(finalCall ? { tool_choice: { type: "none" as const } } : {}),
      messages: session.history,
    });

    if (response.stop_reason === "refusal") return { bubbles: [summarize(effects) ?? DECLINED], refused: true };
    if (response.stop_reason === "max_tokens") return { bubbles: [summarize(effects) ?? TANGLED] };

    const content = echoableContent(response.content);
    const toolUses = content.filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use");
    // A tool call on the final call can't be run, and must not sit in history without a result.
    if (finalCall && toolUses.length > 0) break;
    session.history.push({ role: "assistant", content: content as Anthropic.Beta.BetaContentBlockParam[] });

    if (toolUses.length === 0) {
      const text = content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n\n");
      const bubbles = toBubbles(text);
      return { bubbles: bubbles.length > 0 ? bubbles : [summarize(effects) ?? TANGLED] };
    }

    // All results go back in one user message, as the API expects for parallel tool calls.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      const result = await executeTool(toolUse.name, toolUse.input, session);
      noteEffect(effects, toolUse.name, result);
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

  return { bubbles: [summarize(effects) ?? TANGLED] };
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
