import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { agentRuns } from "@/server/db/schema";
import { env } from "@/server/env";
import { sha256 } from "@/server/privacy/redact";
import { xai } from "./client";

export type AgentSpec<T> = {
  name: string;
  /** Defaults to XAI_MODEL. */
  model?: string;
  /** From agents/prompts/*.md. */
  system: string;
  /** Task input, as tagged text. */
  user: string;
  /** Include the built-in `{ type: "web_search" }` tool. */
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

type OutputItem = {
  type?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  content?: { type?: string; text?: string; annotations?: { type?: string; url?: string }[] }[];
};
type RawResponse = { id?: string; output?: OutputItem[]; citations?: unknown };

/** Citation URLs: xAI's top-level `citations` plus `url_citation` annotations on message text. */
export function collectCitations(res: RawResponse): string[] {
  const urls = new Set<string>();
  if (Array.isArray(res.citations)) {
    for (const c of res.citations) {
      if (typeof c === "string") urls.add(c);
      else if (c && typeof c === "object" && typeof (c as { url?: unknown }).url === "string") {
        urls.add((c as { url: string }).url);
      }
    }
  }
  for (const item of res.output ?? []) {
    for (const part of item.content ?? []) {
      for (const a of part.annotations ?? []) {
        if (a.type === "url_citation" && a.url) urls.add(a.url);
      }
    }
  }
  return [...urls];
}

function fixtureDir(name: string): string {
  return path.join(process.cwd(), "tests/fixtures/xai", name);
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
  const parameters = z.toJSONSchema(spec.submit.schema) as Record<string, unknown>;
  delete parameters.$schema;
  const tools: unknown[] = [];
  if (spec.webSearch) tools.push({ type: "web_search" });
  tools.push({ type: "function", name: spec.submit.name, description: spec.submit.description, parameters });

  const maxTurns = spec.maxTurns ?? 3;
  const citations = new Set<string>();
  let previousId: string | undefined;
  let input: unknown = [
    { role: "system", content: spec.system },
    { role: "user", content: spec.user },
  ];
  let lastProblem = "The model did not call the submit function.";
  let raw: unknown = null;

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = (await xai().responses.create({
      model,
      input,
      tools,
      ...(previousId ? { previous_response_id: previousId } : {}),
    } as never)) as unknown as RawResponse;
    raw = res.output ?? null;
    for (const url of collectCitations(res)) citations.add(url);
    previousId = res.id;

    const call = (res.output ?? []).find((o) => o.type === "function_call" && o.name === spec.submit.name);
    if (call) {
      let args: unknown;
      try {
        args = JSON.parse(call.arguments ?? "{}");
      } catch {
        args = undefined;
      }
      const parsed = spec.submit.schema.safeParse(args);
      if (parsed.success) return { output: parsed.data, citations: [...citations], raw };
      lastProblem = `Arguments to ${spec.submit.name} failed validation: ${z.prettifyError(parsed.error)}`;
      input = [
        {
          type: "function_call_output",
          call_id: call.call_id,
          output: `${lastProblem}\nCall ${spec.submit.name} again with corrected arguments.`,
        },
      ];
    } else {
      lastProblem = "The model answered in prose instead of calling the submit function.";
      input = [
        {
          role: "user",
          content: `You must finish by calling the ${spec.submit.name} function with your result. Do not answer in prose.`,
        },
      ];
    }
  }
  throw new AgentError(`${spec.name} gave no valid result after ${maxTurns} turns. ${lastProblem}`);
}

/**
 * Every agent goes through here so that tool handling, validation, logging
 * and mocking live in one place (section 7.3). One agent_runs row per call.
 * Callers apply the evidence integrity check (xai/evidence.ts) to the result.
 */
export async function runAgent<T>(db: Db, spec: AgentSpec<T>, ctx: { jobId?: string } = {}): Promise<AgentResult<T>> {
  const mock = env().MOCK_EXTERNAL;
  const model = mock ? "mock" : (spec.model ?? env().XAI_MODEL);
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
