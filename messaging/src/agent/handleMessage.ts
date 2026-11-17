import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getConfig } from "../config";
import { getBackend } from "../backend/Backend";
import { MockBackend } from "../backend/MockBackend";
import { phoneLast4, normalizePhone } from "../util/phone";
import { sendText } from "../transport/sendblue";
import { buildSystemPrompt } from "./systemPrompt";
import { clearSession, getSession, trimHistory, type Session } from "./session";
import { executeTool, toolDefinitions } from "./tools";

const MAX_MODEL_CALLS = 6;
const TANGLED = "Sorry, I got tangled up. Can you rephrase?";
const SNAG = "NEPO hit a snag on my end. Try again in a sec.";
const RESET_RE = /^\s*(reset|start over)\s*[.!]?\s*$/i;
const ACCEPT_RE = /^\s*(yes|yep|yeah|y|ok|okay)\s*[.!]?\s*$/i;
const DECLINE_RE = /^\s*(no thanks|nope|nah|no)\s*[.!]?\s*$/i;

type GrokClient = {
  chat: {
    completions: {
      create: (body: {
        model: string;
        messages: ChatCompletionMessageParam[];
        tools: typeof toolDefinitions;
        tool_choice: "auto";
      }) => Promise<{
        choices: Array<{
          message: {
            content?: string | null;
            tool_calls?: Array<{
              id: string;
              type: "function";
              function: { name: string; arguments: string };
            }>;
          };
        }>;
      }>;
    };
  };
};

const locks = new Map<string, Promise<void>>();
let grokOverride: GrokClient | null = null;
let grokCached: OpenAI | null = null;

export function setGrokClientForTests(client: GrokClient | null): void {
  grokOverride = client;
  grokCached = null;
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
  const backend = getBackend();
  const direct = await backend.getUserByPhone(phone);
  if (direct) {
    const connectorReply = await maybeHandleConnectorReply(direct.id, direct.name, text);
    if (connectorReply) return connectorReply;
  }

  const user = backend instanceof MockBackend ? backend.ensureStudent(phone) : direct;
  if (!user) {
    return [
      `Hey! I'm NEPO. I help you get warm intros to Yale clubs through people you already know. Sign up here first: ${getConfig().SIGNUP_URL}`,
    ];
  }

  if (RESET_RE.test(text)) {
    clearSession(phone);
    return ["Fresh start. What club are you aiming for?"];
  }

  const session = getSession(phone, user.id);
  session.latestUserText = text;
  session.history.push({ role: "user", content: text });
  session.turn += 1;

  const bubbles = await runModel(session, user.name, user.college);
  session.history = trimHistory(session.history);
  session.lastActive = Date.now();
  return bubbles;
}

async function maybeHandleConnectorReply(userId: string, connectorName: string, text: string): Promise<string[] | null> {
  const accepted = ACCEPT_RE.test(text);
  const declined = DECLINE_RE.test(text);
  if (!accepted && !declined) return null;
  const backend = getBackend();
  const intro = await backend.findLatestSentIntroByConnector(userId);
  if (!intro) return null;
  const requester = await backend.getUser(intro.requesterId);
  const club = await backend.getClub(intro.clubId);
  const requesterPhone = intro.requesterPhone ?? (await backend.getUserPhone(intro.requesterId));
  if (!requester || !club || !requesterPhone) return null;
  if (accepted) {
    await backend.updateIntroStatus(intro.id, "accepted");
    await sendText(
      requesterPhone,
      `${connectorName} accepted your intro request for ${club.name}! They'll reach out.`,
    );
  } else {
    await backend.updateIntroStatus(intro.id, "declined");
    await sendText(
      requesterPhone,
      `${connectorName} can't make the intro right now. Want me to try your next-best path?`,
    );
  }
  return [`Thanks, I've let ${requester.name} know.`];
}

async function runModel(session: Session, name: string, college?: string): Promise<string[]> {
  const config = getConfig();
  const client = getGrokClient();
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt({ id: session.userId, name, phone: "", suggestible: true, college }) },
    ...session.history,
  ];

  for (let call = 0; call < MAX_MODEL_CALLS; call += 1) {
    const response = await client.chat.completions.create({
      model: config.GROK_MODEL,
      messages,
      tools: toolDefinitions,
      tool_choice: "auto",
    });
    const message = response.choices[0]?.message;
    if (!message) return [TANGLED];
    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      const text = message.content ?? "";
      const bubbles = toBubbles(text);
      session.history.push({ role: "assistant", content: bubbles.join("\n\n") });
      return bubbles.length > 0 ? bubbles : [TANGLED];
    }

    const assistantMessage: ChatCompletionMessageParam = {
      role: "assistant",
      content: message.content ?? null,
      tool_calls: toolCalls,
    };
    messages.push(assistantMessage);
    session.history.push(assistantMessage);

    for (const toolCall of toolCalls) {
      const result = await executeTool(toolCall.function.name, toolCall.function.arguments, session);
      const toolMessage: ChatCompletionMessageParam = {
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      };
      messages.push(toolMessage);
      session.history.push(toolMessage);
    }
  }

  return [TANGLED];
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

function getGrokClient(): GrokClient {
  if (grokOverride) return grokOverride;
  if (!grokCached) {
    const config = getConfig();
    grokCached = new OpenAI({ apiKey: config.XAI_API_KEY, baseURL: "https://api.x.ai/v1" });
  }
  return grokCached as unknown as GrokClient;
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
