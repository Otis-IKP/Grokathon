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
  XAI_API_KEY: optionalString,
  XAI_MODEL: z.string().default("grok-4.7"),
  XAI_MODEL_FAST: optionalString,
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
  ENRICH_MAX_JOBS_PER_HOUR: z.coerce.number().int().positive().default(120),
  ENRICH_PERSON_TTL_DAYS: z.coerce.number().positive().default(30),
  ENRICH_CLUB_TTL_DAYS: z.coerce.number().positive().default(14),
});

export type Env = z.infer<typeof schema> & { XAI_MODEL_FAST_RESOLVED: string };

/** Parsed on every call so tests can change process.env between cases. */
export function env(): Env {
  const parsed = schema.parse(process.env);
  return {
    ...parsed,
    // Dev login can never be on in production, whatever the variable says.
    DEV_LOGIN_ENABLED: parsed.DEV_LOGIN_ENABLED && parsed.NODE_ENV !== "production",
    XAI_MODEL_FAST_RESOLVED: parsed.XAI_MODEL_FAST ?? parsed.XAI_MODEL,
  };
}

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env()[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`${String(key)} is not set. See .env.example.`);
  }
  return value as NonNullable<Env[K]>;
}
