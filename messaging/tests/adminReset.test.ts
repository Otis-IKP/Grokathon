import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { MockBackend } from "../src/backend/MockBackend";
import { getSession, resetSessionsForTests } from "../src/agent/session";
import { loadTestConfig } from "./helpers";

describe("POST /admin/reset", () => {
  let server: Server;
  let port = 0;
  let backend: MockBackend;

  beforeEach(async () => {
    loadTestConfig();
    resetSessionsForTests();
    backend = new MockBackend();
    const app = createApp({ backend });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("rejects a wrong secret and clears sessions and intros for the right one", async () => {
    const intro = await backend.createIntro({
      requesterId: "maya",
      requesterPhone: "+15550000001",
      searchId: "search_test",
      connectorId: "jordan",
      clubId: "ysig",
      message: "Hey Jordan",
    });
    const session = getSession("+15550000001", "maya");
    session.pendingIntroId = intro.id;
    session.turn = 2;

    const denied = await fetch(`http://127.0.0.1:${port}/admin/reset?secret=nope`, { method: "POST" });
    expect(denied.status).toBe(401);
    expect(await backend.getIntro(intro.id)).not.toBeNull();
    expect(getSession("+15550000001", "maya").pendingIntroId).toBe(intro.id);

    const ok = await fetch(`http://127.0.0.1:${port}/admin/reset?secret=test-secret`, { method: "POST" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(await backend.getIntro(intro.id)).toBeNull();
    const fresh = getSession("+15550000001", "maya");
    expect(fresh.pendingIntroId).toBeUndefined();
    expect(fresh.turn).toBe(0);
    expect(fresh.history).toEqual([]);
  });
});