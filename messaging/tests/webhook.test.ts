import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { MockBackend } from "../src/backend/MockBackend";
import { setClaudeClientForTests } from "../src/agent/handleMessage";
import { resetSessionsForTests } from "../src/agent/session";
import { resetSendblueForTests, setOutboundObserver, webhookDrained } from "../src/transport/sendblue";
import { claudeText, fakeClaude, loadTestConfig } from "./helpers";

describe("sendblue webhook", () => {
  let server: Server;
  let port = 0;
  let sent: string[] = [];

  beforeEach(async () => {
    loadTestConfig();
    resetSessionsForTests();
    resetSendblueForTests();
    sent = [];
    setOutboundObserver((_to, content) => {
      sent.push(content);
    });
    setClaudeClientForTests(fakeClaude(() => claudeText("Hey Jordan")).client);
    const app = createApp({ backend: new MockBackend() });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    setClaudeClientForTests(null);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  function post(secret: string, body: unknown) {
    return fetch(`http://127.0.0.1:${port}/webhooks/sendblue?secret=${secret}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("processes a duplicate payload once", async () => {
    const body = {
      from_number: "+15550000001",
      content: "hi",
      date_sent: "2026-11-17T22:00:00Z",
      group_id: null,
    };
    const first = await post("test-secret", body);
    const second = await post("test-secret", body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await webhookDrained();
    expect(sent).toEqual(["Hey Jordan"]);
  });

  it("returns 401 for a wrong secret", async () => {
    const response = await post("nope", { from_number: "+15550000001", content: "hi" });
    expect(response.status).toBe(401);
    await webhookDrained();
    expect(sent).toEqual([]);
  });

  it("ignores group messages and messages from the NEPO number", async () => {
    const group = await post("test-secret", {
      from_number: "+15550000001",
      content: "hi",
      group_id: "group-1",
      date_sent: "2026-11-17T22:01:00Z",
    });
    const own = await post("test-secret", {
      from_number: "+15551110000",
      content: "echo",
      date_sent: "2026-11-17T22:02:00Z",
    });
    expect(group.status).toBe(200);
    expect(own.status).toBe(200);
    await webhookDrained();
    expect(sent).toEqual([]);
  });
});
