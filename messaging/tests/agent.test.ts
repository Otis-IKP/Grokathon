import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { setBackend } from "../src/backend/Backend";
import { MockBackend } from "../src/backend/MockBackend";
import { echoableContent, handleMessage, setClaudeClientForTests } from "../src/agent/handleMessage";
import { recordConnectorAsk } from "../src/agent/connectorAsks";
import { resetSessionsForTests } from "../src/agent/session";
import { resetSendblueForTests, setOutboundObserver } from "../src/transport/sendblue";
import type { Backend, LinkResult } from "../src/types";
import { claudeRefusal, claudeText, claudeToolUse, fakeClaude, loadTestConfig } from "./helpers";

const MAYA = "+15550000001";
const JORDAN = "+15550000002";

/** Drives a draft-then-send conversation: find_paths, save_intro_draft, then send_intro once "send" arrives. */
function draftThenSend(prefix: string) {
  let step = 0;
  return fakeClaude((body) => {
    const messages = JSON.stringify(body.messages);
    const introId = messages.match(/intro_[0-9a-f-]{36}/i)?.[0];
    if (!messages.includes('"content":"send"')) {
      step += 1;
      if (step === 1) return claudeToolUse(`${prefix}1`, "find_paths", { clubId: "ysig" });
      if (step === 2) {
        return claudeToolUse(`${prefix}2`, "save_intro_draft", {
          connectorId: "jordan",
          clubId: "ysig",
          message: "Hey Jordan, want to grab coffee about YSIG?",
        });
      }
      // Tries to send on the same turn as the draft; the gate must refuse.
      if (step === 3) return claudeToolUse(`${prefix}3`, "send_intro", { introId });
      return claudeText("Here's the draft. Reply send and I'll text Jordan.");
    }
    if (!messages.includes('\\"ok\\":true')) return claudeToolUse(`${prefix}4`, "send_intro", { introId });
    return claudeText("Sent it to Jordan.");
  });
}

describe("agent loop", () => {
  beforeEach(() => {
    loadTestConfig();
    resetSessionsForTests();
    resetSendblueForTests();
    setBackend(new MockBackend());
    setClaudeClientForTests(null);
  });

  it("runs a tool call, then returns stripped plain-text bubbles", async () => {
    const fake = fakeClaude((_body, call) =>
      call === 1 ? claudeToolUse("toolu_1", "resolve_club", { text: "ysig" }) : claudeText("**Found** Jordan\n\n- your strongest link"),
    );
    setClaudeClientForTests(fake.client);

    const replies = await handleMessage(MAYA, "I want to be on YSIG");
    expect(fake.bodies).toHaveLength(2);
    expect(JSON.stringify(fake.bodies[1]!.messages)).toContain('"type":"tool_result"');
    expect(JSON.stringify(fake.bodies[1]!.messages)).toContain("Yale Student Investment Group");
    expect(replies.join("\n")).toBe("Found Jordan\nyour strongest link");
  });

  it("asks Claude with fallbacks, adaptive thinking that drops stale blocks, and the configured effort", async () => {
    const fake = fakeClaude(() => claudeText("Which club?"));
    setClaudeClientForTests(fake.client);
    await handleMessage(MAYA, "hi");
    expect(fake.bodies[0]).toMatchObject({
      model: "claude-opus-5-5",
      fallbacks: "default",
      betas: ["server-side-fallback-2026-07-01", "thinking-binding-controls-2026-08-01"],
      thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
      output_config: { effort: "low" },
    });
    expect(fake.bodies[0]!.tools?.every((tool) => "strict" in tool && tool.strict === true)).toBe(true);
  });

  it("leaves out fallbacks for a model that doesn't accept the default form", async () => {
    loadTestConfig({ CLAUDE_MODEL: "claude-haiku-5-5" });
    const fake = fakeClaude(() => claudeText("Which club?"));
    setClaudeClientForTests(fake.client);
    await handleMessage(MAYA, "hi");
    expect(fake.bodies[0]).not.toHaveProperty("fallbacks");
  });

  it("stops after 6 model calls", async () => {
    let calls = 0;
    setClaudeClientForTests(
      fakeClaude(() => {
        calls += 1;
        return claudeToolUse(`toolu_${calls}`, "resolve_club", { text: "ysig" });
      }).client,
    );
    const replies = await handleMessage(MAYA, "ysig");
    expect(calls).toBe(6);
    expect(replies).toEqual(["Sorry, I got tangled up. Can you rephrase?"]);
  });

  it("answers a refusal with a redirect instead of empty text", async () => {
    setClaudeClientForTests(fakeClaude(() => claudeRefusal()).client);
    const replies = await handleMessage(MAYA, "something off-topic");
    expect(replies).toEqual(["I can't help with that one. Want to find a warm intro to a club instead?"]);
  });

  it("lets an unknown phone talk to Claude in mock mode", async () => {
    const fake = fakeClaude(() => claudeText("Which club?"));
    setClaudeClientForTests(fake.client);
    const replies = await handleMessage("+15559999999", "I want to be on YSIG");
    expect(fake.bodies).toHaveLength(1);
    expect(replies).toEqual(["Which club?"]);
  });

  it("does not text the connector until send arrives on a later turn", async () => {
    const outbound: string[] = [];
    setOutboundObserver((to, content) => outbound.push(`${to} ${content}`));
    setClaudeClientForTests(draftThenSend("c").client);

    await handleMessage(MAYA, "yes");
    expect(outbound.filter((line) => line.startsWith(JORDAN))).toEqual([]);

    await handleMessage(MAYA, "send");
    const toJordan = outbound.filter((line) => line.startsWith(JORDAN));
    expect(toJordan).toHaveLength(1);
    expect(toJordan[0]).toContain("Hey Jordan, want to grab coffee about YSIG?");
    expect(toJordan[0]).toContain("Reply YES to accept or NO to pass.");
  });

  it("accepts a connector YES right after the ask, without calling Claude, and texts Maya", async () => {
    const backend = new MockBackend();
    setBackend(backend);
    const intro = await backend.createIntro({
      requesterId: "maya",
      requesterPhone: MAYA,
      searchId: "search_test",
      connectorId: "jordan",
      clubId: "ysig",
      message: "Hey Jordan, could you intro me to someone on YSIG?",
    });
    await backend.markIntroSent(intro);
    recordConnectorAsk(JORDAN, intro.id);
    const sent: string[] = [];
    setOutboundObserver((to, content) => sent.push(`${to} ${content}`));
    const fake = fakeClaude(() => claudeText("should not run"));
    setClaudeClientForTests(fake.client);

    const replies = await handleMessage(JORDAN, "YES");
    expect(fake.bodies).toHaveLength(0);
    expect(replies).toEqual(["Thanks, I've let Maya Chen know."]);
    expect(sent).toEqual([`${MAYA} Jordan Hale accepted your intro request for Yale Student Investment Group! They'll reach out.`]);
    expect((await backend.getIntro(intro.id))?.status).toBe("accepted");
  });

  it("treats yes as conversation when the bot texted the connector something else after the ask", async () => {
    const backend = new MockBackend();
    setBackend(backend);
    const intro = await backend.createIntro({
      requesterId: "maya",
      requesterPhone: MAYA,
      searchId: "search_test",
      connectorId: "jordan",
      clubId: "ysig",
      message: "Hey Jordan",
    });
    await backend.markIntroSent(intro);
    recordConnectorAsk(JORDAN, intro.id);
    const fake = fakeClaude(() => claudeText("Want me to draft a message to Priya?"));
    setClaudeClientForTests(fake.client);

    // Jordan starts their own conversation; the bot's reply ends the YES window.
    await handleMessage(JORDAN, "can you help me get into the Whiffs?");
    const replies = await handleMessage(JORDAN, "yes");
    expect(fake.bodies).toHaveLength(2);
    expect(replies).toEqual(["Want me to draft a message to Priya?"]);
    expect((await backend.getIntro(intro.id))?.status).toBe("sent");
  });

  it("tells a connector who already answered that it's done", async () => {
    const backend = new MockBackend();
    setBackend(backend);
    const intro = await backend.createIntro({
      requesterId: "maya",
      requesterPhone: MAYA,
      searchId: "search_test",
      connectorId: "jordan",
      clubId: "ysig",
      message: "Hey Jordan",
    });
    await backend.markIntroSent(intro);
    await backend.answerIntro(intro.id, JORDAN, "decline");
    recordConnectorAsk(JORDAN, intro.id);
    const replies = await handleMessage(JORDAN, "yes");
    expect(replies).toEqual(["Looks like you already answered that one. Thanks!"]);
  });

  it("texts the alias phone that requested the intro, not Maya's main phone", async () => {
    const aliasPhone = "+15550000999";
    const backend = new MockBackend({ DEMO_MAYA_PHONE: MAYA, DEMO_ALSO_PHONES: aliasPhone });
    setBackend(backend);
    const outbound: string[] = [];
    setOutboundObserver((to, content) => outbound.push(`${to} ${content}`));
    const fake = draftThenSend("a");
    setClaudeClientForTests(fake.client);

    await handleMessage(aliasPhone, "yes");
    await handleMessage(aliasPhone, "send");
    expect(outbound.some((line) => line.startsWith(JORDAN))).toBe(true);

    outbound.length = 0;
    const replies = await handleMessage(JORDAN, "YES");
    expect(replies).toEqual(["Thanks, I've let Maya Chen know."]);
    expect(outbound).toEqual([
      `${aliasPhone} Jordan Hale accepted your intro request for Yale Student Investment Group! They'll reach out.`,
    ]);
    const seen = JSON.stringify(fake.bodies);
    expect(seen).not.toContain("requesterPhone");
    expect(seen).not.toContain(aliasPhone);
  });
});

describe("unlinked phones in http mode", () => {
  function stubBackend(link: LinkResult): Backend {
    return {
      getUserByPhone: async () => null,
      linkPhone: async () => link,
    } as unknown as Backend;
  }

  beforeEach(() => {
    loadTestConfig({
      BACKEND_MODE: "http",
      BACKEND_URL: "http://app.test",
      BACKEND_API_SECRET: "bot-secret",
      SIGNUP_URL: "https://app.test/login",
    });
    resetSessionsForTests();
    resetSendblueForTests();
    setClaudeClientForTests(fakeClaude(() => claudeText("should not run")).client);
  });

  it("points an unknown phone to sign up and explains the code", async () => {
    setBackend(stubBackend({ ok: false, reason: "invalid_code" }));
    const replies = await handleMessage("+12035550199", "hi");
    expect(replies[0]).toContain("https://app.test/login");
    expect(replies[1]).toContain("6-digit code");
  });

  it("links the phone when they text a valid code", async () => {
    setBackend(stubBackend({ ok: true, user: { id: "bo107", name: "Bea Okafor", phone: "+12035550199", suggestible: true } }));
    expect(await handleMessage("+12035550199", " 123456 ")).toEqual(["You're linked, Bea! What club are you aiming for?"]);
  });

  it("says when a code has expired", async () => {
    setBackend(stubBackend({ ok: false, reason: "code_expired" }));
    expect((await handleMessage("+12035550199", "123456"))[0]).toContain("expired");
  });

  it("refuses to start in http mode with the placeholder sign-up URL", () => {
    expect(() =>
      loadTestConfig({ BACKEND_MODE: "http", BACKEND_URL: "http://app.test", BACKEND_API_SECRET: "s" }),
    ).toThrow(/SIGNUP_URL/);
  });
});

describe("echoableContent", () => {
  it("drops the declined model's thinking and tool calls before the last fallback block", () => {
    const content = [
      { type: "thinking", thinking: "", signature: "a" },
      { type: "tool_use", id: "t1", name: "find_paths", input: {} },
      { type: "text", text: "partial", citations: null },
      { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" } },
      { type: "thinking", thinking: "", signature: "b" },
      { type: "tool_use", id: "t2", name: "find_paths", input: {} },
    ] as unknown as Anthropic.Beta.BetaContentBlock[];
    expect(echoableContent(content).map((block) => block.type)).toEqual(["text", "fallback", "thinking", "tool_use"]);
  });

  it("leaves content without a fallback untouched", () => {
    const content = [{ type: "text", text: "hi", citations: null }] as unknown as Anthropic.Beta.BetaContentBlock[];
    expect(echoableContent(content)).toBe(content);
  });
});
