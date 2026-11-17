import "dotenv/config";
import { loadConfig, type Config } from "./config";
import { createApp } from "./app";

const invokedDirectly = process.argv[1]?.includes("index.ts") || process.argv[1]?.includes("index.js");

if (invokedDirectly) {
  start().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

async function start(): Promise<void> {
  const config = loadConfig();
  await logAvailableModels(config);
  const app = createApp();
  app.listen(config.PORT, () => {
    console.log(`NEPO listening on ${config.PORT} (backend=${config.BACKEND_MODE}, dryRun=${config.DRY_RUN})`);
  });
}

async function logAvailableModels(config: Config): Promise<void> {
  try {
    const response = await fetch("https://api.x.ai/v1/models", {
      headers: { Authorization: `Bearer ${config.XAI_API_KEY}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.warn(`Could not list models (HTTP ${response.status}). Continuing with ${config.GROK_MODEL}.`);
      return;
    }
    const body = (await response.json()) as { data?: Array<{ id?: string }> };
    const ids = (body.data ?? []).map((model) => model.id).filter((id): id is string => Boolean(id));
    console.log(`Available models: ${ids.join(", ") || "(none listed)"}`);
    if (!ids.includes(config.GROK_MODEL)) {
      console.warn(`GROK_MODEL=${config.GROK_MODEL} is not in the model list.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    console.warn(`Could not list models: ${message}. Continuing with ${config.GROK_MODEL}.`);
  }
}
