import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, DRAFT_LINK_TTL_MS } from "../src/app";
import { MockBackend } from "../src/backend/MockBackend";
import { setClaudeClientForTests } from "../src/agent/handleMessage";
import { resetSessionsForTests } from "../src/agent/session";
import { resetSendblueForTests, setOutboundObserver } from "../src/transport/sendblue";
import { claudeText, fakeClaude, loadTestConfig } from "./helpers";

describe("bot HTTP routes", () => {
  let server: Server;
  let base = "";
  let backend: MockBackend;
  const sent: string[] = [];

  beforeEach(async () => {
    loadTestConfig({ BACKEND_API_SECRET: "bot-secret" });
    resetSessionsForTests();
    resetSendblueForTests();
    sent.length = 0;
    setOutboundObserver((to, content) => sent.push(`${to} ${content}`));
    setClaudeClientForTests(fakeClaude(() => claudeText("Which club?")).client);
    backend = new MockBackend();
    server = createApp({ backend }).listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    vi.useRealTimers();
    setClaudeClientForTests(null);
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  async function draft() {
    return backend.createIntro({
      requesterId: "maya",
      requesterPhone: "+15550000001",
      searchId: "search_test",
      connectorId: "jordan",
      clubId: "ysig",
      message: "Hey Jordan",
    });
  }

  it("stops the draft link once the intro is sent", async () => {
    const intro = await draft();
    expect((await fetch(`${base}/d/${intro.id}`, { redirect: "manual" })).status).toBe(302);
    await backend.markIntroSent(intro);
    expect((await fetch(`${base}/d/${intro.id}`, { redirect: "manual" })).status).toBe(404);
  });

  it("stops the draft link after 24 hours", async () => {
    const intro = await draft();
    intro.createdAt = Date.now() - DRAFT_LINK_TTL_MS - 1000;
    expect((await fetch(`${base}/d/${intro.id}`, { redirect: "manual" })).status).toBe(404);
  });

  it("requires the secret on the web chat", async () => {
    const body = JSON.stringify({ phone: "+15550000001", text: "hi" });
    const headers = { "content-type": "application/json" };
    expect((await fetch(`${base}/chat`, { method: "POST", headers, body })).status).toBe(401);
    expect((await fetch(`${base}/chat?secret=wrong`, { method: "POST", headers, body })).status).toBe(401);
    const ok = await fetch(`${base}/chat?secret=test-secret`, { method: "POST", headers, body });
    expect(await ok.json()).toEqual({ replies: ["Which club?"] });
  });

  it("texts the requester when the app reports an answer, and checks the app's secret", async () => {
    const event = {
      event: "intro.responded",
      intro_id: "i1",
      decision: "accept",
      requester_phone: "+15550000001",
      connector_first_name: "Jordan",
      club_name: "YSIG",
    };
    const post = (auth: string) =>
      fetch(`${base}/webhooks/app`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: auth },
        body: JSON.stringify(event),
      });
    expect((await post("Bearer wrong")).status).toBe(401);
    expect(sent).toEqual([]);
    expect((await post("Bearer bot-secret")).status).toBe(200);
    await vi.waitFor(() => expect(sent).toEqual(["+15550000001 Jordan accepted your intro request for YSIG! They'll reach out."]));
  });
});
