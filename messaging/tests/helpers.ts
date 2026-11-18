import type Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "../src/config";
import type { ClaudeClient } from "../src/agent/handleMessage";
import type { Backend, PathResult } from "../src/types";

export const TEST_ENV = {
  ANTHROPIC_API_KEY: "test-key",
  CLAUDE_MODEL: "claude-opus-5-5",
  WEBHOOK_SECRET: "test-secret",
  BACKEND_MODE: "mock",
  DRY_RUN: "true",
  SIGNUP_URL: "https://example.com/signup",
  PORT: "3000",
  SENDBLUE_API_KEY_ID: "",
  SENDBLUE_API_SECRET: "",
  SENDBLUE_FROM_NUMBER: "+15551110000",
};

export function loadTestConfig(extra: Record<string, string> = {}) {
  return loadConfig({ ...TEST_ENV, ...extra });
}

type Body = Anthropic.Beta.MessageCreateParamsNonStreaming;

function message(content: unknown[], stopReason: string): Anthropic.Beta.BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Anthropic.Beta.BetaMessage;
}

export function claudeText(text: string): Anthropic.Beta.BetaMessage {
  return message([{ type: "text", text, citations: null }], "end_turn");
}

export function claudeToolUse(id: string, name: string, input: unknown): Anthropic.Beta.BetaMessage {
  return message([{ type: "tool_use", id, name, input }], "tool_use");
}

export function claudeRefusal(): Anthropic.Beta.BetaMessage {
  return message([], "refusal");
}

/** A Claude client whose replies come from `reply`. Records every request body. */
export function fakeClaude(reply: (body: Body, call: number) => Anthropic.Beta.BetaMessage | Promise<Anthropic.Beta.BetaMessage>) {
  const bodies: Body[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (body) => {
          // Snapshot: the session keeps appending to the same messages array.
          bodies.push(JSON.parse(JSON.stringify(body)) as Body);
          return reply(body, bodies.length);
        },
      },
    },
  };
  return { client, bodies };
}

/** Mock-backend paths for a seed user id. */
export async function pathsFor(backend: Backend, userId: string, clubId: string): Promise<PathResult[]> {
  const search = await backend.findPaths({ id: userId, name: "", phone: "", suggestible: true }, "", clubId);
  return search.paths;
}
