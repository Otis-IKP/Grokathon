import OpenAI from "openai";
import { requireEnv } from "@/server/env";

let client: OpenAI | undefined;

/** xAI speaks the OpenAI Responses API at api.x.ai. */
export function xai(): OpenAI {
  client ??= new OpenAI({
    apiKey: requireEnv("XAI_API_KEY"),
    baseURL: "https://api.x.ai/v1",
    timeout: 180_000,
    maxRetries: 1,
  });
  return client;
}
