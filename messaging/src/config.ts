import { z } from "zod";

const envSchema = z
  .object({
    XAI_API_KEY: z.string().min(1, "XAI_API_KEY is required"),
    GROK_MODEL: z.string().min(1).default("grok-4.7"),
    SENDBLUE_API_KEY_ID: z.string().optional().default(""),
    SENDBLUE_API_SECRET: z.string().optional().default(""),
    SENDBLUE_FROM_NUMBER: z.string().optional().default(""),
    WEBHOOK_SECRET: z.string().min(1, "WEBHOOK_SECRET is required"),
    BACKEND_MODE: z.enum(["mock", "http"]).default("mock"),
    BACKEND_URL: z.string().optional().default(""),
    SIGNUP_URL: z.string().min(1).default("https://example.com/signup"),
    PUBLIC_BASE_URL: z
      .string()
      .optional()
      .default("")
      .transform((value) => value.trim().replace(/\/+$/, "")),
    PORT: z.coerce.number().int().positive().default(3000),
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
    if (value.BACKEND_MODE === "http" && !value.BACKEND_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BACKEND_URL"],
        message: "BACKEND_URL is required when BACKEND_MODE=http",
      });
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
