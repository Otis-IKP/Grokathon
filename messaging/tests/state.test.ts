import { beforeEach, describe, expect, it } from "vitest";
import { setBackend } from "../src/backend/Backend";
import { MockBackend } from "../src/backend/MockBackend";
import { handleMessage, setClaudeClientForTests } from "../src/agent/handleMessage";
import { resetConnectorAsksForTests } from "../src/agent/connectorAsks";
import { resetSessionsForTests } from "../src/agent/session";
import { claimOnce, releaseClaim, setStateStore, type PhoneState, type StateStore } from "../src/state/store";
import { processSendbluePayload, resetSendblueForTests, setOutboundObserver } from "../src/transport/sendblue";
import { claudeText, claudeToolUse, fakeClaude, loadTestConfig } from "./helpers";

const MAYA = "+15550000001";
const JORDAN = "+15550000002";

/** Stands in for the app's bot_state and bot_claims tables. Values cross a JSON boundary, as over HTTP. */
function fakeStore() {
  const states = new Map<string, string>();
  const claims = new Set<string>();
  const store: StateStore = {
    loadState: async (phone) => (states.has(phone) ? (JSON.parse(states.get(phone)!) as PhoneState) : null),
    saveState: async (phone, state) => {
      if (state === null) states.delete(phone);
      else states.set(phone, JSON.stringify(state));
    },
    claim: async (key) => {
      if (claims.has(key)) return false;
      claims.add(key);
      return true;
    },
    release: async (key) => {
      claims.delete(key);
    },
  };
  return { store, states, claims };
}

/** Everything a process holds in memory is gone, as on a restart or on another server instance. */
function anotherInstance() {
  resetSessionsForTests();
  resetConnectorAsksForTests();
}

function draftThenSend() {
  let step = 0;
  return fakeClaude((body) => {
    const messages = JSON.stringify(body.messages);
    const introId = messages.match(/intro_[0-9a-f-]{36}/i)?.[0];
    if (!messages.includes('"content":"send"')) {
      step += 1;
      if (step === 1) return claudeToolUse("t1", "find_paths", { clubId: "ysig" });
      if (step === 2) return claudeToolUse("t2", "save_intro_draft", { connectorId: "jordan", clubId: "ysig", message: "Hey Jordan, coffee about YSIG?" });
      return claudeText("Here's the draft. Reply send and I'll text Jordan.");
    }
    if (!messages.includes('\\"ok\\":true')) return claudeToolUse("t3", "send_intro", { introId });
    return claudeText("Sent it to Jordan.");
  });
}

describe("bot state kept outside the process", () => {
  let sent: { to: string; content: string }[];
  let kept: ReturnType<typeof fakeStore>;

  beforeEach(() => {
    loadTestConfig();
    resetSessionsForTests();
    resetSendblueForTests();
    setBackend(new MockBackend());
    kept = fakeStore();
    setStateStore(kept.store);
    sent = [];
    setOutboundObserver((to, content) => sent.push({ to, content }));
    setClaudeClientForTests(draftThenSend().client);
  });

  it("a draft, its 'send' and the connector's YES each land on a different instance and still work", async () => {
    await handleMessage(MAYA, "get me into ysig and draft something to jordan");
    expect(JSON.parse(kept.states.get(MAYA)!).session.pendingIntroId).toMatch(/^intro_/);

    anotherInstance();
    const afterSend = await handleMessage(MAYA, "send");
    expect(afterSend.join(" ")).toContain("Sent it to Jordan");
    expect(sent.filter((t) => t.to === JORDAN)).toHaveLength(1);
    // The request waiting for Jordan's answer is saved under Jordan's phone.
    expect(JSON.parse(kept.states.get(JORDAN)!).asks).toHaveLength(1);
    expect(JSON.parse(kept.states.get(MAYA)!).session.pendingIntroId).toBeUndefined();

    anotherInstance();
    const answer = await handleMessage(JORDAN, "YES");
    expect(answer[0]).toMatch(/^Thanks, I've let /);
    expect(sent.some((t) => t.to === MAYA && /accepted your intro request/.test(t.content))).toBe(true);
    expect(kept.states.has(JORDAN)).toBe(false);
  });

  it("without the saved state the same 'send' is refused, which is what the store prevents", async () => {
    await handleMessage(MAYA, "get me into ysig and draft something to jordan");
    anotherInstance();
    kept.states.clear();
    await handleMessage(MAYA, "send");
    expect(sent.filter((t) => t.to === JORDAN)).toHaveLength(0);
  });

  it("the conversation history follows the phone, and 'reset' forgets it everywhere", async () => {
    const fake = fakeClaude(() => claudeText("ok"));
    setClaudeClientForTests(fake.client);
    await handleMessage(MAYA, "first message");
    anotherInstance();
    await handleMessage(MAYA, "second message");
    expect(JSON.stringify(fake.bodies[1]!.messages)).toContain("first message");

    await handleMessage(MAYA, "reset");
    expect(kept.states.has(MAYA)).toBe(false);
    anotherInstance();
    await handleMessage(MAYA, "third message");
    expect(JSON.stringify(fake.bodies[2]!.messages)).not.toContain("first message");
  });

  it("a reply that is not an intro request closes a connector's YES/NO window on every instance", async () => {
    await handleMessage(MAYA, "get me into ysig and draft something to jordan");
    await handleMessage(MAYA, "send");
    expect(JSON.parse(kept.states.get(JORDAN)!).asks).toHaveLength(1);
    setClaudeClientForTests(fakeClaude(() => claudeText("Which club?")).client);
    anotherInstance();
    // Jordan asks something of his own; the bot's reply to him ends the window.
    await processSendbluePayload({ from_number: JORDAN, content: "can you help me too?", date_sent: "d1" }, handleMessage);
    anotherInstance();
    setClaudeClientForTests(fakeClaude(() => claudeText("Sure, which club?")).client);
    const reply = await handleMessage(JORDAN, "yes");
    expect(reply.join(" ")).toBe("Sure, which club?");
  });

  it("a webhook delivered twice is handled once, even by two instances; a released claim can be retried", async () => {
    let handled = 0;
    const handle = async () => {
      handled += 1;
      return [];
    };
    const payload = { from_number: MAYA, content: "hello", date_sent: "2026-11-18T00:00:00Z" };
    await processSendbluePayload(payload, handle);
    resetSendblueForTests(); // a second instance: no local memory of the delivery
    setStateStore(kept.store);
    await processSendbluePayload(payload, handle);
    expect(handled).toBe(1);
    // Only a hash is claimed, never the phone or the text.
    expect([...kept.claims].join(" ")).not.toMatch(/5550000001|hello/);

    expect(await claimOnce("app-webhook:i1|accept")).toBe(true);
    expect(await claimOnce("app-webhook:i1|accept")).toBe(false);
    await releaseClaim("app-webhook:i1|accept");
    expect(await claimOnce("app-webhook:i1|accept")).toBe(true);
  });
});
