import { loadConfig } from "../src/config";

export function loadTestConfig() {
  return loadConfig({
    XAI_API_KEY: "test-key",
    GROK_MODEL: "grok-4.7",
    WEBHOOK_SECRET: "test-secret",
    BACKEND_MODE: "mock",
    DRY_RUN: "true",
    SIGNUP_URL: "https://example.com/signup",
    PORT: "3000",
    SENDBLUE_API_KEY_ID: "",
    SENDBLUE_API_SECRET: "",
    SENDBLUE_FROM_NUMBER: "+15551110000",
  });
}
