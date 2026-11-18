import Anthropic from "@anthropic-ai/sdk";
import { requireEnv } from "@/server/env";

let client: Anthropic | undefined;

/** How long one agent request may run. Web research can take a few minutes. */
export const AGENT_REQUEST_TIMEOUT_MS = 240_000;

/** The Anthropic client for the research agents. */
export function claude(): Anthropic {
  client ??= new Anthropic({
    apiKey: requireEnv("ANTHROPIC_API_KEY"),
    timeout: AGENT_REQUEST_TIMEOUT_MS,
    maxRetries: 1,
  });
  return client;
}
