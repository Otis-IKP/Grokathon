import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig, type Config } from "./config";
import { createApp } from "./app";

const invokedDirectly = process.argv[1]?.includes("index.ts") || process.argv[1]?.includes("index.js");

const config = loadConfigOrExit();
const app = createApp();

// Vercel imports this module and serves the default export as one function.
// Locally (`npm run dev` / `npm start`) the module is run directly and listens on PORT.
export default app;

if (invokedDirectly) {
  void checkModel(config).finally(() => {
    app.listen(config.PORT, () => {
      console.log(`NEPO listening on ${config.PORT} (backend=${config.BACKEND_MODE}, dryRun=${config.DRY_RUN})`);
    });
  });
}

function loadConfigOrExit(): Config {
  try {
    return loadConfig();
  } catch (error) {
    if (!invokedDirectly) throw error;
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/** Confirm the key works and the model exists, so a typo shows up at startup rather than on the first text. */
async function checkModel(config: Config): Promise<void> {
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, timeout: 8000, maxRetries: 0 });
  try {
    const model = await client.models.retrieve(config.CLAUDE_MODEL);
    console.log(`Using ${model.display_name} (${model.id}), effort ${config.CLAUDE_EFFORT}.`);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      console.warn("ANTHROPIC_API_KEY was rejected. Every text will fail until it is fixed.");
    } else if (error instanceof Anthropic.NotFoundError) {
      console.warn(`CLAUDE_MODEL=${config.CLAUDE_MODEL} was not found.`);
    } else {
      const message = error instanceof Error ? error.message : "request failed";
      console.warn(`Could not check the model: ${message}. Continuing with ${config.CLAUDE_MODEL}.`);
    }
  }
}
