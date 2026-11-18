import { z } from "zod";

const PLACEHOLDER_SIGNUP_URL = "https://example.com/signup";

const envSchema = z
  .object({
    ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
    CLAUDE_MODEL: z.string().min(1).default("claude-opus-5-5"),
    /** Thinking depth. Low keeps text replies quick; raise it if tool use gets sloppy. */
    CLAUDE_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("low"),
    SENDBLUE_API_KEY_ID: z.string().optional().default(""),
    SENDBLUE_API_SECRET: z.string().optional().default(""),
    SENDBLUE_FROM_NUMBER: z.string().optional().default(""),
    WEBHOOK_SECRET: z.string().min(1, "WEBHOOK_SECRET is required"),
    BACKEND_MODE: z.enum(["mock", "http"]).default("mock"),
    BACKEND_URL: z.string().optional().default(""),
    /** The app's BOT_API_SECRET. Sent on every Bot API call and checked on the app's webhook. */
    BACKEND_API_SECRET: z.string().optional().default(""),
    SIGNUP_URL: z.string().min(1).default(PLACEHOLDER_SIGNUP_URL),
    PUBLIC_BASE_URL: z
      .string()
      .optional()
      .default("")
      .transform((value) => value.trim().replace(/\/+$/, "")),
    PORT: z.coerce.number().int().positive().default(3001),
    DRY_RUN: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  })
  .superRefine((value, ctx) => {
    if (!value.DRY_RUN) {
      for (const key of ["SENDBLUE_API_KEY_ID", "SENDBLUE_API_SECRET", "SENDBLUE_FROM_NUMBER"] as const) {
        if (!value[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when DRY_RUN=false`,
          });
        }
      }
    }
    if (value.BACKEND_MODE === "http") {
      const required = [
        ["BACKEND_URL", value.BACKEND_URL],
        ["BACKEND_API_SECRET", value.BACKEND_API_SECRET],
      ] as const;
      for (const [key, current] of required) {
        if (!current) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required when BACKEND_MODE=http` });
        }
      }
      if (value.SIGNUP_URL === PLACEHOLDER_SIGNUP_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SIGNUP_URL"],
          message: "SIGNUP_URL must be the NEPO app's sign-in page when BACKEND_MODE=http",
        });
      }
    }
  });

export type Config = z.infer<typeof envSchema>;

let current: Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${details}`);
  }
  current = parsed.data;
  return current;
}

export function getConfig(): Config {
  if (!current) {
    throw new Error("Config is not loaded. Call loadConfig() at startup.");
  }
  return current;
}

/** Test hook so a file can swap config without touching process.env. */
export function setConfigForTests(config: Config): void {
  current = config;
}
