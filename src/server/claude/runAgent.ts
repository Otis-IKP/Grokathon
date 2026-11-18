import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { agentRuns } from "@/server/db/schema";
import { env } from "@/server/env";
import { sha256 } from "@/server/privacy/redact";
import { claude } from "./client";

export type AgentSpec<T> = {
  name: string;
  /** Defaults to CLAUDE_MODEL. */
  model?: string;
  /** From agents/prompts/*.md. */
  system: string;
  /** Task input, as tagged text. */
  user: string;
  /** Include Claude's server-side web search and web fetch tools. */
  webSearch: boolean;
  /** The single custom function the agent must call to finish. */
  submit: { name: string; description: string; schema: z.ZodType<T> };
  maxTurns?: number;
  /** Stored in agent_runs.input instead of the raw user text (e.g. a hash for PDF text). */
  logInput?: unknown;
  /** MOCK_EXTERNAL only: fixture file name tried before the input hash. */
  fixtureKey?: string;
  /** MOCK_EXTERNAL only: builds an output when no fixture file matches, before default.json. */
  mock?: () => T;
};

export type AgentResult<T> = { output: T; citations: string[] };

export class AgentError extends Error {}

type Block = Anthropic.Beta.BetaContentBlock;

/** Models that accept `fallbacks: "default"`; others run without a refusal fallback. */
const DEFAULT_FALLBACK_MODELS = new Set([
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-fable-5-2",
  "claude-fable-5-1",
  "claude-sonnet-5-5",
]);
const BETAS: Anthropic.Beta.AnthropicBeta[] = ["server-side-fallback-2026-07-01"];
const MAX_TOKENS = 16_000;
/**
 * One agent run stops here, however many turns it has left. The job queue
 * treats a job as dead after 20 minutes (STUCK_AFTER_MS), so this stays well under.
 */
export const AGENT_DEADLINE_MS = 12 * 60 * 1000;
/** A paused server-tool turn is resumed, but not forever. */
const MAX_PAUSES = 4;

/**
 * URLs of pages Claude actually retrieved in this response: web search hits,
 * fetched pages, and citations attached to its text. An evidence URL counts
 * only if it is in this set (claude/evidence.ts).
 */
export function collectCitations(content: readonly unknown[]): string[] {
  const urls = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && value) urls.add(value);
  };
  for (const raw of content) {
    const block = raw as { type?: string; content?: unknown; citations?: unknown };
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      // On failure `content` is an error object, not a list.
      for (const hit of block.content) add((hit as { url?: unknown }).url);
    } else if (block.type === "web_fetch_tool_result") {
      add((block.content as { url?: unknown } | null)?.url);
    } else if (block.type === "text" && Array.isArray(block.citations)) {
      for (const cite of block.citations) add((cite as { url?: unknown }).url);
    }
  }
  return [...urls];
}

/**
 * After a refusal fallback, tool calls made before the last `fallback` block
 * belong to the model that declined and are ignored.
 */
function findSubmit(content: Block[], name: string): Anthropic.Beta.BetaToolUseBlock | undefined {
  const boundary = content.map((b) => b.type as string).lastIndexOf("fallback");
  return content
    .slice(boundary + 1)
    .find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === name);
}

function fixtureDir(name: string): string {
  return path.join(process.cwd(), "tests/fixtures/claude", name);
}

function readFixture<T>(file: string): AgentResult<T> | null {
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { output: T; citations?: string[] };
  return { output: raw.output, citations: raw.citations ?? [] };
}

function runMock<T>(spec: AgentSpec<T>): AgentResult<T> {
  const dir = fixtureDir(spec.name);
  const hash = sha256(spec.user).slice(0, 16);
  const candidates = [spec.fixtureKey ? `${spec.fixtureKey}.json` : null, `${hash}.json`].filter(Boolean) as string[];
  for (const file of candidates) {
    const hit = readFixture<T>(path.join(dir, file));
    if (hit) return { output: spec.submit.schema.parse(hit.output), citations: hit.citations };
  }
  if (spec.mock) return { output: spec.submit.schema.parse(spec.mock()), citations: [] };
  const fallback = readFixture<T>(path.join(dir, "default.json"));
  if (fallback) return { output: spec.submit.schema.parse(fallback.output), citations: fallback.citations };
  throw new AgentError(`No fixture for agent ${spec.name} (looked in ${dir}).`);
}

async function runLive<T>(spec: AgentSpec<T>, model: string): Promise<AgentResult<T> & { raw: unknown }> {
  const inputSchema = z.toJSONSchema(spec.submit.schema) as Record<string, unknown>;
  delete inputSchema.$schema;
  const tools: Anthropic.Beta.BetaToolUnion[] = [];
  if (spec.webSearch) {
    tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 8 });
    tools.push({ type: "web_fetch_20260209", name: "web_fetch", max_uses: 6 });
  }
  tools.push({
    name: spec.submit.name,
    description: spec.submit.description,
    input_schema: inputSchema as Anthropic.Beta.BetaTool.InputSchema,
  });

  const maxTurns = spec.maxTurns ?? 3;
  const citations = new Set<string>();
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: spec.user }];
  let lastProblem = "The model did not call the submit function.";
  let raw: unknown = null;
  let pauses = 0;

  const deadline = Date.now() + AGENT_DEADLINE_MS;
  for (let turn = 0; turn < maxTurns; ) {
    if (Date.now() > deadline) throw new AgentError(`${spec.name} ran out of time. ${lastProblem}`);
    // Streamed so a long web-research turn cannot hit an HTTP idle timeout.
    const res = await claude()
      .beta.messages.stream({
        model,
        max_tokens: MAX_TOKENS,
        betas: BETAS,
        ...(DEFAULT_FALLBACK_MODELS.has(model) ? { fallbacks: "default" as const } : {}),
        system: spec.system,
        tools,
        messages,
      })
      .finalMessage();
    raw = res.content;
    for (const url of collectCitations(res.content)) citations.add(url);

    if (res.stop_reason === "refusal") {
      throw new AgentError(`${spec.name}: the model declined this request${res.stop_details?.category ? ` (${res.stop_details.category})` : ""}.`);
    }
    messages.push({ role: "assistant", content: res.content as Anthropic.Beta.BetaContentBlockParam[] });

    // A server tool (web search) paused the turn: send it back unchanged to resume.
    if (res.stop_reason === "pause_turn" && pauses < MAX_PAUSES) {
      pauses += 1;
      continue;
    }
    turn += 1;

    const call = findSubmit(res.content, spec.submit.name);
    if (call) {
      const parsed = spec.submit.schema.safeParse(call.input);
      if (parsed.success) return { output: parsed.data, citations: [...citations], raw };
      lastProblem = `Arguments to ${spec.submit.name} failed validation: ${z.prettifyError(parsed.error)}`;
      // Every tool_use in the turn needs a result, in one user message.
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = res.content
        .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
        .map((b) => ({
          type: "tool_result",
          tool_use_id: b.id,
          is_error: true,
          content:
            b.id === call.id
              ? `${lastProblem}\nCall ${spec.submit.name} again with corrected arguments.`
              : "Ignored. Call the submit function once.",
        }));
      messages.push({ role: "user", content: results });
    } else {
      lastProblem =
        res.stop_reason === "max_tokens"
          ? "The model ran out of output tokens before calling the submit function."
          : "The model answered in prose instead of calling the submit function.";
      const pending: Anthropic.Beta.BetaToolResultBlockParam[] = res.content
        .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
        .map((b) => ({ type: "tool_result", tool_use_id: b.id, is_error: true, content: "Unknown tool." }));
      messages.push({
        role: "user",
        content: [
          ...pending,
          {
            type: "text",
            text: `You must finish by calling the ${spec.submit.name} function with your result. Do not answer in prose.`,
          },
        ],
      });
    }
  }
  throw new AgentError(`${spec.name} gave no valid result after ${maxTurns} turns. ${lastProblem}`);
}

/**
 * Every agent goes through here so that tool handling, validation, logging
 * and mocking live in one place (section 7.3). One agent_runs row per call.
 * Callers apply the evidence integrity check (claude/evidence.ts) to the result.
 */
export async function runAgent<T>(db: Db, spec: AgentSpec<T>, ctx: { jobId?: string } = {}): Promise<AgentResult<T>> {
  const mock = env().MOCK_EXTERNAL;
  const model = mock ? "mock" : (spec.model ?? env().CLAUDE_MODEL);
  const started = Date.now();
  const logInput = (spec.logInput ?? { user: spec.user }) as object;
  try {
    const result = mock ? { ...runMock(spec), raw: null } : await runLive(spec, model);
    await db.insert(agentRuns).values({
      jobId: ctx.jobId ?? null,
      agent: spec.name,
      model,
      input: logInput,
      output: result.output as object,
      citations: result.citations,
      durationMs: Date.now() - started,
    });
    return { output: result.output, citations: result.citations };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.insert(agentRuns).values({
      jobId: ctx.jobId ?? null,
      agent: spec.name,
      model,
      input: logInput,
      durationMs: Date.now() - started,
      error: message.slice(0, 2000),
    });
    // No silent fallbacks: the failure propagates to the job or the request.
    throw err instanceof AgentError ? err : new AgentError(`${spec.name} failed: ${message}`);
  }
}
