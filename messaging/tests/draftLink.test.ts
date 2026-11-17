import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { setBackend } from "../src/backend/Backend";
import { MockBackend } from "../src/backend/MockBackend";
import { getSession, resetSessionsForTests } from "../src/agent/session";
import { executeTool } from "../src/agent/tools";
import { createApp } from "../src/app";
import { resetSendblueForTests } from "../src/transport/sendblue";
import { loadTestConfig } from "./helpers";

const baseEnv = {
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
};

describe("draft link", () => {
  const backend = new MockBackend();

  beforeEach(() => {
    resetSessionsForTests();
    resetSendblueForTests();
    setBackend(backend);
  });

  async function saveDraft() {
    const session = getSession("+15550000001", "maya");
    session.allowedConnectorIds = ["jordan"];
    session.turn = 1;
    return executeTool(
      "save_intro_draft",
      {
        connectorId: "jordan",
        clubId: "ysig",
        message: "Hey Jordan, coffee?",
      },
      session,
    );
  }

  it("returns a raw sms link when PUBLIC_BASE_URL is unset", async () => {
    loadTestConfig();
    const result = (await saveDraft()) as { smsLink: string };
    expect(result.smsLink.startsWith("sms:+15550000002&body=")).toBe(true);
  });

  it("returns an https link when PUBLIC_BASE_URL is set", async () => {
    loadConfig({ ...baseEnv, PUBLIC_BASE_URL: "https://demo.example/" });
    const result = (await saveDraft()) as { introId: string; smsLink: string };
    expect(result.smsLink).toBe(`https://demo.example/d/${result.introId}`);
  });

  it("redirects a known draft and 404s an unknown one", async () => {
    loadTestConfig();
    const intro = await backend.createIntro({
      requesterId: "maya",
      connectorId: "jordan",
      clubId: "ysig",
      message: "Hey Jordan, coffee?",
    });
    const app = createApp({ backend });
    const server: Server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const missing = await fetch(`http://127.0.0.1:${port}/d/intro_missing`);
      expect(missing.status).toBe(404);
      expect(await missing.text()).toBe("Draft not found");

      const found = await fetch(`http://127.0.0.1:${port}/d/${intro.id}`, { redirect: "manual" });
      expect(found.status).toBe(302);
      expect(found.headers.get("location")).toBe(
        "sms:+15550000002&body=Hey%20Jordan%2C%20coffee%3F",
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});