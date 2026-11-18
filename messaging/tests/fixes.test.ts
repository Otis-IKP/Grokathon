import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { setBackend } from "../src/backend/Backend";
import { HttpBackend } from "../src/backend/HttpBackend";
import { MockBackend } from "../src/backend/MockBackend";
import { handleMessage, setClaudeClientForTests } from "../src/agent/handleMessage";
import { pendingConnectorAsk, pendingConnectorAsks, recordConnectorAsk } from "../src/agent/connectorAsks";
import { getSession, resetSessionsForTests, type Session } from "../src/agent/session";
import { DRAFT_CONFIRM_TTL_MS, executeTool, isSendConfirmation } from "../src/agent/tools";
import { loadConfig } from "../src/config";
import { mountSendblue, resetSendblueForTests, sendText, setOutboundObserver, webhookDrained } from "../src/transport/sendblue";
import type { Backend, Intro } from "../src/types";
import { openRequesterPhone, sealRequesterPhone } from "../src/util/draftToken";
import { normalizePhone } from "../src/util/phone";
import { TEST_ENV, claudeRefusal, claudeText, claudeToolUse, fakeClaude, loadTestConfig } from "./helpers";

const MAYA = "+15550000001";
const JORDAN = "+15550000002";
const LIVE = { DRY_RUN: "false", ALLOW_MOCK_LIVE_SENDS: "true", SENDBLUE_API_KEY_ID: "id", SENDBLUE_API_SECRET: "secret" };

async function listen(app: express.Express): Promise<{ server: Server; base: string }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

/** A session whose draft to Jordan was saved on turn 1 and confirmed with `text` on turn 2. */
async function draftedSession(backend: Backend, text = "send"): Promise<{ session: Session; introId: string }> {
  setBackend(backend);
  const session = getSession(MAYA, "maya", "Maya Chen");
  session.turn = 1;
  await executeTool("find_paths", { clubId: "ysig" }, session);
  const saved = (await executeTool(
    "save_intro_draft",
    { connectorId: "jordan", clubId: "ysig", message: "Hey Jordan, coffee about YSIG?" },
    session,
  )) as { introId: string };
  session.turn = 2;
  session.latestUserText = text;
  return { session, introId: saved.introId };
}

beforeEach(() => {
  loadTestConfig();
  resetSessionsForTests();
  resetSendblueForTests();
  setClaudeClientForTests(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("connector asks", () => {
  it("does not arm an ask when the request text fails to send, and logs no response body", async () => {
    loadTestConfig(LIVE);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(`{"error":"bad number ${JORDAN}"}`, { status: 400 })),
    );
    const failure = await sendText(JORDAN, "Hey Jordan", { ask: { introId: "intro_1" } }).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("sendblue returned 400");
    expect(pendingConnectorAsk(JORDAN)).toBeUndefined();
  });

  it("arms the ask once the request text has gone out", async () => {
    loadTestConfig(LIVE);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    await sendText(JORDAN, "Hey Jordan", { ask: { introId: "intro_1", requesterName: "Maya Chen" } });
    expect(pendingConnectorAsk(JORDAN)).toEqual({ introId: "intro_1", requesterName: "Maya Chen" });
  });

  it("keeps the ask when a later, unrelated text to that phone fails", async () => {
    loadTestConfig(LIVE);
    recordConnectorAsk(JORDAN, "intro_1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 400 })),
    );
    await sendText(JORDAN, "hello").catch(() => undefined);
    expect(pendingConnectorAsk(JORDAN)?.introId).toBe("intro_1");
  });

  it("queues two requesters: YES answers the oldest and names both, then NO answers the next", async () => {
    const backend = new MockBackend();
    setBackend(backend);
    const sent: string[] = [];
    setOutboundObserver((to, content) => sent.push(`${to} ${content}`));
    const fake = fakeClaude(() => claudeText("should not run"));
    setClaudeClientForTests(fake.client);
    const make = async (requesterId: string, requesterPhone: string) => {
      const intro = await backend.createIntro({ requesterId, requesterPhone, searchId: "s", connectorId: "jordan", clubId: "ysig", message: "Hey" });
      await backend.markIntroSent(intro);
      return intro;
    };
    const first = await make("maya", MAYA);
    const second = await make("priya", "+15550000003");
    recordConnectorAsk(JORDAN, first.id, "Maya Chen");
    recordConnectorAsk(JORDAN, second.id, "Priya Shah");
    expect(pendingConnectorAsks(JORDAN).map((ask) => ask.introId)).toEqual([first.id, second.id]);

    const replies = await handleMessage(JORDAN, "YES");
    expect(replies).toEqual([
      "Thanks, I've let Maya Chen know. You have another intro request waiting, from Priya Shah. Reply YES or NO for that one.",
    ]);
    expect((await backend.getIntro(first.id))?.status).toBe("accepted");
    expect((await backend.getIntro(second.id))?.status).toBe("sent");

    // The transport texts that reply to Jordan; it must not close the window for the second request.
    for (const reply of replies) await sendText(JORDAN, reply);
    expect(await handleMessage(JORDAN, "no")).toEqual(["Thanks, I've let Priya Shah know."]);
    expect((await backend.getIntro(second.id))?.status).toBe("declined");
    expect(pendingConnectorAsk(JORDAN)).toBeUndefined();
    expect(fake.bodies).toHaveLength(0);
    expect(sent.filter((line) => line.startsWith(MAYA))).toHaveLength(1);
  });
});

describe("send_intro", () => {
  it("accepts only a whole-message confirmation", () => {
    for (const yes of ["send", "Send it", "yes", "yep", "yeah", "ok", "okay", "sure", "go ahead", "do it", "looks good", " Send it! ", "yes please", "send it, please.", "ok 👍", "looks good!!"]) {
      expect(isSendConfirmation(yes), yes).toBe(true);
    }
    for (const no of ["ok wait don't send yet", "yes but change the last line", "send it to Priya instead", "y", "go", "sender", "yes?", "don't send", "sounds good, tell me more", ""]) {
      expect(isSendConfirmation(no), no).toBe(false);
    }
  });

  it("refuses a conditional yes and leaves the draft unsent", async () => {
    const backend = new MockBackend();
    const { session, introId } = await draftedSession(backend, "yes but change the last line");
    expect(await executeTool("send_intro", { introId }, session)).toEqual({ error: "not confirmed: ask the user to reply 'send'" });
    expect((await backend.getIntro(introId))?.status).toBe("drafted");
  });

  it("cancels the pending draft when find_paths runs again", async () => {
    const { session, introId } = await draftedSession(new MockBackend());
    await executeTool("find_paths", { clubId: "ysig" }, session);
    expect(session.pendingIntroId).toBeUndefined();
    const result = (await executeTool("send_intro", { introId }, session)) as { error: string };
    expect(result.error).toContain("no draft waiting");
  });

  it("only sends the latest draft when a new one replaces it", async () => {
    const backend = new MockBackend();
    const { session, introId } = await draftedSession(backend);
    const newer = (await executeTool(
      "save_intro_draft",
      { connectorId: "jordan", clubId: "ysig", message: "Shorter: coffee?" },
      session,
    )) as { introId: string };
    session.turn = 3;
    expect(await executeTool("send_intro", { introId }, session)).toEqual({ error: "not confirmed: ask the user to reply 'send'" });
    expect(await executeTool("send_intro", { introId: newer.introId }, session)).toMatchObject({ ok: true, sent: true });
  });

  it("expires a draft that was saved more than 30 minutes ago", async () => {
    const backend = new MockBackend();
    const { session, introId } = await draftedSession(backend);
    session.pendingIntroAt = Date.now() - DRAFT_CONFIRM_TTL_MS - 1000;
    const result = (await executeTool("send_intro", { introId }, session)) as { error: string };
    expect(result.error).toContain("more than 30 minutes old");
    expect(session.pendingIntroId).toBeUndefined();
    expect((await backend.getIntro(introId))?.status).toBe("drafted");
  });

  it("sends one text even when marking the intro sent keeps failing, and says it was sent", async () => {
    class FlakyBackend extends MockBackend {
      markCalls = 0;
      override async markIntroSent(): Promise<void> {
        this.markCalls += 1;
        throw new Error("app is down");
      }
    }
    const backend = new FlakyBackend();
    const outbound: string[] = [];
    setOutboundObserver((to) => outbound.push(to));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { session, introId } = await draftedSession(backend);

    const result = await executeTool("send_intro", { introId }, session);
    expect(result).toMatchObject({ ok: true, sent: true, introId });
    expect((result as { note: string }).note).toContain("do not send it again");
    expect(backend.markCalls).toBe(2);
    expect(session.pendingIntroId).toBeUndefined();

    // The backend still says "drafted", and the student confirms again: no second text.
    session.turn = 3;
    expect(await executeTool("send_intro", { introId }, session)).toEqual({ error: "that intro was already sent" });
    expect(outbound).toEqual([JORDAN]);
  });

  it("retries marking the intro sent once and reports a clean success", async () => {
    class OnceFlaky extends MockBackend {
      markCalls = 0;
      override async markIntroSent(intro: Intro): Promise<void> {
        this.markCalls += 1;
        if (this.markCalls === 1) throw new Error("blip");
        return super.markIntroSent(intro);
      }
    }
    const backend = new OnceFlaky();
    const { session, introId } = await draftedSession(backend);
    expect(await executeTool("send_intro", { introId }, session)).toEqual({ ok: true, introId, sent: true });
    expect(backend.markCalls).toBe(2);
    expect((await backend.getIntro(introId))?.status).toBe("sent");
  });

  it("keeps the draft sendable when the text itself fails", async () => {
    loadTestConfig(LIVE);
    const backend = new MockBackend();
    const { session, introId } = await draftedSession(backend);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 400 })),
    );
    expect(await executeTool("send_intro", { introId }, session)).toEqual({ error: "sendblue returned 400" });
    expect(session.pendingIntroId).toBe(introId);
    expect(pendingConnectorAsk(JORDAN)).toBeUndefined();
  });
});

describe("model loop", () => {
  beforeEach(() => setBackend(new MockBackend()));

  it("drops a refused turn from history so it is not sent again", async () => {
    const fake = fakeClaude((_body, call) => (call === 1 ? claudeRefusal() : claudeText("Which club?")));
    setClaudeClientForTests(fake.client);
    expect(await handleMessage(MAYA, "something the model declines")).toEqual([
      "I can't help with that one. Want to find a warm intro to a club instead?",
    ]);
    expect(await handleMessage(MAYA, "ysig please")).toEqual(["Which club?"]);
    expect(fake.bodies[1]!.messages).toEqual([{ role: "user", content: "ysig please" }]);
  });

  it("drops the tool calls of a turn that ends in a refusal too", async () => {
    const fake = fakeClaude((_body, call) => {
      if (call === 1) return claudeToolUse("t1", "resolve_club", { text: "ysig" });
      if (call === 2) return claudeRefusal();
      return claudeText("Which club?");
    });
    setClaudeClientForTests(fake.client);
    await handleMessage(MAYA, "first");
    await handleMessage(MAYA, "second");
    expect(fake.bodies[2]!.messages).toEqual([{ role: "user", content: "second" }]);
  });

  it("makes the last model call without tools and reports a draft the tools saved", async () => {
    const fake = fakeClaude((_body, call) => {
      if (call === 1) return claudeToolUse("t1", "find_paths", { clubId: "ysig" });
      if (call === 2) {
        return claudeToolUse("t2", "save_intro_draft", { connectorId: "jordan", clubId: "ysig", message: "Hey Jordan" });
      }
      return claudeToolUse(`t${call}`, "resolve_club", { text: "ysig" });
    });
    setClaudeClientForTests(fake.client);
    const replies = await handleMessage(MAYA, "yes");
    expect(fake.bodies).toHaveLength(6);
    expect(fake.bodies[4]).not.toHaveProperty("tool_choice");
    expect(fake.bodies[5]!.tool_choice).toEqual({ type: "none" });
    expect(replies).toEqual(["I saved your draft. Reply 'send' and I'll text it for you, or tell me what to change."]);

    // The unrun tool call is not left in history without a result.
    const next = fakeClaude(() => claudeText("ok"));
    setClaudeClientForTests(next.client);
    await handleMessage(MAYA, "thanks");
    const history = next.bodies[0]!.messages;
    expect(JSON.stringify(history)).not.toContain('"id":"t6"');
    expect(history.at(-1)).toEqual({ role: "user", content: "thanks" });
  });

  it("uses the model's own words on the last call when it gives some", async () => {
    const fake = fakeClaude((_body, call) =>
      call < 6 ? claudeToolUse(`t${call}`, "resolve_club", { text: "ysig" }) : claudeText("Found YSIG. Want paths?"),
    );
    setClaudeClientForTests(fake.client);
    expect(await handleMessage(MAYA, "ysig")).toEqual(["Found YSIG. Want paths?"]);
  });
});

describe("logs", () => {
  it("masks the phone number in the dry-run log", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await sendText(JORDAN, "Hey Jordan");
    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toBe("[dry-run] text to ***0002: Hey Jordan");
    expect(line).not.toContain(JORDAN);
  });

  it("does not repeat a bad phone number in the error", () => {
    expect(() => normalizePhone("+1555000000199999999")).toThrowError(/^Phone number is not a valid international number$/);
  });
});

describe("config", () => {
  const base = { ...TEST_ENV, SENDBLUE_API_KEY_ID: "id", SENDBLUE_API_SECRET: "secret" };

  it("defaults DRY_RUN to true", () => {
    const { DRY_RUN: _unset, ...env } = TEST_ENV;
    expect(loadConfig(env).DRY_RUN).toBe(true);
  });

  it("refuses mock mode with live sends unless explicitly allowed", () => {
    expect(() => loadConfig({ ...base, DRY_RUN: "false" })).toThrow(/ALLOW_MOCK_LIVE_SENDS/);
    expect(loadConfig({ ...base, DRY_RUN: "false", ALLOW_MOCK_LIVE_SENDS: "true" }).DRY_RUN).toBe(false);
    expect(
      loadConfig({
        ...base,
        DRY_RUN: "false",
        BACKEND_MODE: "http",
        BACKEND_URL: "http://app.test",
        BACKEND_API_SECRET: "s",
        SIGNUP_URL: "https://app.test/login",
      }).BACKEND_MODE,
    ).toBe("http");
  });
});

describe("phone normalisation", () => {
  it("accepts US numbers and E.164", () => {
    expect(normalizePhone("(555) 000-0001")).toBe("+15550000001");
    expect(normalizePhone("1 555 000 0001")).toBe("+15550000001");
    expect(normalizePhone("+1 (555) 000-0001")).toBe("+15550000001");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("rejects anything that is not a plausible number", () => {
    for (const bad of ["", "12345", "+1234567", "+1234567890123456", "442079460958", "+0123456789", "call me", "555-000-0001 ext 5", "+1555+0000001"]) {
      expect(() => normalizePhone(bad), bad).toThrow();
    }
  });
});

describe("webhooks answer after the work", () => {
  it("has already texted the reply when the Sendblue webhook responds", async () => {
    const sent: string[] = [];
    setOutboundObserver((_to, content) => sent.push(content));
    setClaudeClientForTests(
      fakeClaude(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return claudeText("Which club?");
      }).client,
    );
    const { server, base } = await listen(createApp({ backend: new MockBackend() }));
    try {
      const response = await fetch(`${base}/webhooks/sendblue?secret=test-secret`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from_number: MAYA, content: "hi", date_sent: "2026-11-17T22:10:00Z" }),
      });
      expect(response.status).toBe(200);
      expect(sent).toEqual(["Which club?"]);
    } finally {
      await close(server);
    }
  });

  it("still answers when handling takes longer than the cap, and finishes the work", async () => {
    let finished = false;
    const app = express();
    app.use(express.json());
    mountSendblue(
      app,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        finished = true;
        return [];
      },
      { maxWaitMs: 20 },
    );
    const { server, base } = await listen(app);
    try {
      const response = await fetch(`${base}/webhooks/sendblue?secret=test-secret`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from_number: MAYA, content: "hi", date_sent: "2026-11-17T22:11:00Z" }),
      });
      expect(response.status).toBe(200);
      expect(finished).toBe(false);
      await webhookDrained();
      expect(finished).toBe(true);
    } finally {
      await close(server);
    }
  });
});

describe("/webhooks/app", () => {
  let server: Server;
  let base = "";
  const sent: string[] = [];
  const event = {
    event: "intro.responded",
    intro_id: "i1",
    decision: "accept",
    requester_phone: MAYA,
    connector_first_name: "Jordan",
    club_name: "YSIG",
  };
  const post = (body: unknown) =>
    fetch(`${base}/webhooks/app`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer bot-secret" },
      body: JSON.stringify(body),
    });

  beforeEach(async () => {
    loadTestConfig({ BACKEND_API_SECRET: "bot-secret" });
    sent.length = 0;
    setOutboundObserver((to, content) => sent.push(`${to} ${content}`));
    ({ server, base } = await listen(createApp({ backend: new MockBackend() })));
  });

  afterEach(() => close(server));

  it("texts once for repeated deliveries of the same intro and decision, before answering", async () => {
    const first = await post(event);
    expect(first.status).toBe(200);
    expect(sent).toHaveLength(1);
    const second = await post(event);
    expect(await second.json()).toEqual({ ok: true, duplicate: true });
    expect(sent).toHaveLength(1);
    expect((await post({ ...event, intro_id: "i2" })).status).toBe(200);
    expect(sent).toHaveLength(2);
  });

  it("rejects names that are too long to put in a text", async () => {
    expect((await post({ ...event, connector_first_name: "J".repeat(61) })).status).toBe(400);
    expect((await post({ ...event, club_name: "C".repeat(121) })).status).toBe(400);
    expect(sent).toEqual([]);
  });

  it("answers 502 and allows a retry when the text could not be sent", async () => {
    await close(server);
    loadTestConfig({ ...LIVE, BACKEND_API_SECRET: "bot-secret" });
    ({ server, base } = await listen(createApp({ backend: new MockBackend() })));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const realFetch = globalThis.fetch;
    let sendblueStatus = 400;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("https://api.sendblue.co/")) return new Response("{}", { status: sendblueStatus });
      return realFetch(input, init);
    });
    expect((await post(event)).status).toBe(502);
    sendblueStatus = 200;
    expect(await (await post(event)).json()).toEqual({ ok: true });
  });
});

describe("draft link without the in-memory cache", () => {
  it("seals the requester's phone to one intro", () => {
    const token = sealRequesterPhone("intro-1", MAYA, "test-secret");
    expect(token).not.toContain("555");
    expect(openRequesterPhone("intro-1", token, "test-secret")).toBe(MAYA);
    expect(openRequesterPhone("intro-2", token, "test-secret")).toBeNull();
    expect(openRequesterPhone("intro-1", token, "other-secret")).toBeNull();
    expect(openRequesterPhone("intro-1", "garbage", "test-secret")).toBeNull();
  });

  it("redirects on an instance that never saw the intro, using the app's existing routes", async () => {
    loadTestConfig({
      BACKEND_MODE: "http",
      BACKEND_URL: "http://app.test",
      BACKEND_API_SECRET: "bot-secret",
      SIGNUP_URL: "https://app.test/login",
      PUBLIC_BASE_URL: "https://demo.example/bot",
    });
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("http://app.test")) return realFetch(input, init);
      calls.push(`${init?.method ?? "GET"} ${url.slice("http://app.test".length)}`);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (url.endsWith("/api/bot/intros")) return json({ intro_id: "intro-9", response_url: null });
      if (url.includes("/connector-phone")) return json({ phone: JORDAN });
      if (url.endsWith("/api/bot/intros/intro-9/read") && JSON.parse(String(init?.body)).phone === MAYA) {
        const card = { netid: "j1", name: "Jordan Lee", first_name: "Jordan", college: null, year: null, is_user: true };
        return json({
          intro: {
            intro_id: "intro-9",
            status: "drafted",
            message: "Hey Jordan",
            club: { id: "c1", slug: "ysig", name: "YSIG", short_name: null, category: null },
            connector: card,
            created_at: new Date().toISOString(),
            response_url: null,
          },
        });
      }
      return json({ error: { code: "not_found", message: "no" } }, 404);
    });

    // Instance A saves the draft and hands out the link.
    setBackend(new HttpBackend("http://app.test", "bot-secret"));
    const session = getSession(MAYA, "m1", "Maya Chen");
    session.allowedConnectorIds = ["j1"];
    session.lastSearch = { searchId: "s1", clubId: "c1" };
    const saved = (await executeTool("save_intro_draft", { connectorId: "j1", clubId: "c1", message: "Hey Jordan" }, session)) as {
      smsLink: string;
    };
    expect(saved.smsLink.startsWith("https://demo.example/bot/d/intro-9?k=")).toBe(true);
    expect(saved.smsLink).not.toContain("555");

    // Instance B has a fresh backend with an empty cache.
    const { server, base } = await listen(createApp({ backend: new HttpBackend("http://app.test", "bot-secret") }));
    try {
      // Without a valid key this instance knows nothing about the intro.
      expect((await realFetch(`${base}/d/intro-9`, { redirect: "manual" })).status).toBe(404);
      expect((await realFetch(`${base}/d/intro-9?k=AAAA`, { redirect: "manual" })).status).toBe(404);
      const query = saved.smsLink.slice(saved.smsLink.indexOf("?"));
      const found = await realFetch(`${base}/d/intro-9${query}`, { redirect: "manual" });
      expect(found.status).toBe(302);
      expect(found.headers.get("location")).toBe(`sms:${JORDAN}&body=Hey%20Jordan`);
    } finally {
      await close(server);
    }
    expect(calls).toContain("POST /api/bot/intros/intro-9/read");
    // No phone number ever travels in a URL.
    expect(calls.join(" ")).not.toMatch(/phone=|%2B1|\+1\d/);
  });
});

describe("alum role", () => {
  it("passes alum through from the app instead of calling them a member", async () => {
    const card = (netid: string, name: string) => ({ netid, name, first_name: name, college: null, year: null, is_user: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              search_id: "s1",
              pending_research: false,
              empty_reason: null,
              results: [
                { score: 0.9, hops: 1, connector: card("a1", "Ada"), link: { type: "member", role: "alum", title: null }, target: null, why: "Ada was in YSIG." },
                {
                  score: 0.5,
                  hops: 2,
                  connector: card("b1", "Bo"),
                  link: { type: "knows_member", via: "friend" },
                  target: { person: card("c1", "Cy"), role: "alum", title: null },
                  why: "Bo knows Cy.",
                },
                { score: 0.4, hops: 1, connector: card("d1", "Di"), link: { type: "member", role: "treasurer", title: null }, target: null, why: "Di is in YSIG." },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const backend = new HttpBackend("http://app.test", "bot-secret");
    const search = await backend.findPaths({ id: "m1", name: "Maya", phone: MAYA, suggestible: true }, MAYA, "c1");
    expect(search.paths.map((path) => path.target?.role)).toEqual(["alum", "alum", "member"]);

    setBackend(backend);
    const session = getSession(MAYA, "m1", "Maya");
    const result = (await executeTool("find_paths", { clubId: "c1" }, session)) as { paths: { targetRole: string }[] };
    expect(result.paths[0]?.targetRole).toBe("alum");
  });
});
