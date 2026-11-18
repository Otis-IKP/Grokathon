import { z } from "zod";

const flag = z
  .string()
  .optional()
  .transform((v) => v === "1" || v === "true");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: optionalString,
  APP_URL: z
    .string()
    .default("http://localhost:3000")
    .transform((v) => v.replace(/\/+$/, "")),
  SESSION_SECRET: optionalString,
  YALIES_API_KEY: optionalString,
  YALIES_BASE_URL: z
    .string()
    .default("https://api.yalies.io/v2")
    .transform((v) => v.replace(/\/+$/, "")),
  ANTHROPIC_API_KEY: optionalString,
  CLAUDE_MODEL: z.string().default("claude-opus-5-5"),
  CLAUDE_MODEL_FAST: optionalString,
  BOT_API_SECRET: optionalString,
  BOT_PHONE_DISPLAY: z.string().default("+1 645 243 7121"),
  ADMIN_NETIDS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  CRON_SECRET: optionalString,
  WEBSITE_ORIGIN: optionalString,
  BOT_WEBHOOK_URL: optionalString,
  MOCK_EXTERNAL: flag,
  DEV_LOGIN_ENABLED: flag,
  // A blank or invalid value falls back to the default instead of failing every request.
  ENRICH_MAX_JOBS_PER_HOUR: z.coerce.number().int().positive().catch(120),
  ENRICH_PERSON_TTL_DAYS: z.coerce.number().positive().catch(30),
  ENRICH_CLUB_TTL_DAYS: z.coerce.number().positive().catch(14),
});

/** Values from .env.example and the docs. Fine locally, never acceptable on a public deployment. */
const EXAMPLE_SECRETS = new Set([
  "change-me-change-me-change-me-change-me",
  "dev-bot-secret",
  "dev-cron-secret",
  "e2e-bot-secret",
  "e2e-cron-secret",
]);

/**
 * A production deployment must not run on the example configuration: anyone
 * who has read this repository would know the session, bot and cron secrets.
 * Checked when NODE_ENV=production, except while `next build` collects pages.
 */
function assertProductionConfig(e: z.infer<typeof schema>): void {
  if (e.NODE_ENV !== "production" || process.env.NEXT_PHASE === "phase-production-build") return;
  const problems: string[] = [];
  const secrets = [
    ["SESSION_SECRET", e.SESSION_SECRET, 32],
    ["BOT_API_SECRET", e.BOT_API_SECRET, 12],
    ["CRON_SECRET", e.CRON_SECRET, 12],
  ] as const;
  for (const [name, value, min] of secrets) {
    if (!value) problems.push(`${name} is not set`);
    else if (EXAMPLE_SECRETS.has(value)) problems.push(`${name} is still the example value`);
    else if (value.length < min) problems.push(`${name} must be at least ${min} characters`);
  }
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(e.APP_URL);
  if (!e.APP_URL.startsWith("https://") && !local) {
    problems.push("APP_URL must be the https origin of the app (the session cookie and Yale CAS depend on it)");
  }
  if (problems.length > 0) throw new Error(`Unsafe production configuration: ${problems.join("; ")}.`);
}

export type Env = z.infer<typeof schema> & { CLAUDE_MODEL_FAST_RESOLVED: string };

/** Parsed on every call so tests can change process.env between cases. */
export function env(): Env {
  const parsed = schema.parse(process.env);
  assertProductionConfig(parsed);
  return {
    ...parsed,
    // Dev login can never be on in production, whatever the variable says.
    DEV_LOGIN_ENABLED: parsed.DEV_LOGIN_ENABLED && parsed.NODE_ENV !== "production",
    CLAUDE_MODEL_FAST_RESOLVED: parsed.CLAUDE_MODEL_FAST ?? parsed.CLAUDE_MODEL,
  };
}

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env()[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`${String(key)} is not set. See .env.example.`);
  }
  return value as NonNullable<Env[K]>;
}
