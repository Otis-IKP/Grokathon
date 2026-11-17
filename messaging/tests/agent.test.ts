import { beforeEach, describe, expect, it } from "vitest";
import { setBackend } from "../src/backend/Backend";
import { MockBackend } from "../src/backend/MockBackend";
import { handleMessage, setGrokClientForTests } from "../src/agent/handleMessage";
import { resetSessionsForTests } from "../src/agent/session";
import { resetSendblueForTests, setOutboundObserver } from "../src/transport/sendblue";
import { loadTestConfig } from "./helpers";

function toolCall(id: string, name: string, args: unknown) {
  return {
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id,
              type: "function" as const,
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  };
}

describe("agent loop", () => {
  beforeEach(() => {
    loadTestConfig();
    resetSessionsForTests();
    resetSendblueForTests();
    setBackend(new MockBackend());
    setGrokClientForTests(null);
  });

  it("runs a tool call, then returns stripped plain-text bubbles", async () => {
    const seen: unknown[] = [];
    setGrokClientForTests({
      chat: {
        completions: {
          create: async (body) => {
            seen.push(body.messages);
            if (seen.length === 1) return toolCall("call_1", "resolve_club", { text: "ysig" });
            return {
              choices: [
                {
                  message: {
                    content: "**Found** Jordan\n\n- your strongest link",
                  },
                },
              ],
            };
          },
        },
      },
    });

    const replies = await handleMessage("+15550000001", "I want to be on YSIG");
    expect(seen).toHaveLength(2);
    expect(JSON.stringify(seen[1])).toContain('"role":"tool"');
    expect(JSON.stringify(seen[1])).toContain("Yale Student Investment Group");
    expect(replies.join("\n")).toBe("Found Jordan\nyour strongest link");
    expect(replies.join("\n")).not.toMatch(/\*\*/);
    expect(replies.join("\n")).not.toMatch(/^\s*[-*]\s/m);
  });

  it("stops after 6 model calls", async () => {
    let calls = 0;
    setGrokClientForTests({
      chat: {
        completions: {
          create: async () => {
            calls += 1;
            return toolCall(`call_${calls}`, "resolve_club", { text: "ysig" });
          },
        },
      },
    });

    const replies = await handleMessage("+15550000001", "ysig");
    expect(calls).toBe(6);
    expect(replies).toEqual(["Sorry, I got tangled up. Can you rephrase?"]);
  });

  it("lets an unknown phone talk to Grok instead of sending them to sign up", async () => {
    let calls = 0;
    setGrokClientForTests({
      chat: {
        completions: {
          create: async () => {
            calls += 1;
            return { choices: [{ message: { content: "Which club?" } }] };
          },
        },
      },
    });

    const replies = await handleMessage("+15559999999", "I want to be on YSIG");
    expect(calls).toBe(1);
    expect(replies).toEqual(["Which club?"]);
  });

  it("does not text the connector until send arrives on a later turn", async () => {
    const outbound: string[] = [];
    setOutboundObserver((to, content) => outbound.push(`${to} ${content}`));
    let step = 0;
    setGrokClientForTests({
      chat: {
        completions: {
          create: async (body) => {
            const messages = JSON.stringify(body.messages);
            const introId = messages.match(/intro_[0-9a-f-]{36}/i)?.[0];
            if (!messages.includes('"content":"send"')) {
              step += 1;
              if (step === 1) return toolCall("c1", "find_paths", { clubId: "ysig" });
              if (step === 2) {
                return toolCall("c2", "save_intro_draft", {
                  connectorId: "jordan",
                  clubId: "ysig",
                  message: "Hey Jordan, want to grab coffee about YSIG?",
                });
              }
              if (step === 3) return toolCall("c3", "send_intro", { introId });
              return { choices: [{ message: { content: "Here's the draft. Reply send and I'll text Jordan." } }] };
            }
            if (!messages.includes('"ok":true')) return toolCall("c4", "send_intro", { introId });
            return { choices: [{ message: { content: "Sent it to Jordan." } }] };
          },
        },
      },
    });

    await handleMessage("+15550000001", "yes");
    expect(outbound.filter((line) => line.startsWith("+15550000002"))).toEqual([]);

    await handleMessage("+15550000001", "send");
    const toJordan = outbound.filter((line) => line.startsWith("+15550000002"));
    expect(toJordan).toHaveLength(1);
    expect(toJordan[0]).toContain("Hey Jordan, want to grab coffee about YSIG?");
  });

  it("accepts a connector YES without calling Grok and texts Maya", async () => {
    const backend = new MockBackend();
    setBackend(backend);
    const intro = await backend.createIntro({
      requesterId: "maya",
      connectorId: "jordan",
      clubId: "ysig",
      message: "Hey Jordan, could you intro me to someone on YSIG?",
    });
    await backend.updateIntroStatus(intro.id, "sent");
    const sent: string[] = [];
    setOutboundObserver((to, content) => sent.push(`${to} ${content}`));
    let calls = 0;
    setGrokClientForTests({
      chat: {
        completions: {
          create: async () => {
            calls += 1;
            return { choices: [{ message: { content: "should not run" } }] };
          },
        },
      },
    });

    const replies = await handleMessage("+15550000002", "YES");
    expect(calls).toBe(0);
    expect(replies).toEqual(["Thanks, I've let Maya Chen know."]);
    expect(sent).toEqual([
      "+15550000001 Jordan Hale accepted your intro request for Yale Student Investment Group! They'll reach out.",
    ]);
    expect((await backend.getIntro(intro.id))?.status).toBe("accepted");
  });

  it("texts the alias phone that requested the intro, not Maya's main phone", async () => {
    const mayaPhone = "+15550000001";
    const aliasPhone = "+15550000999";
    const jordanPhone = "+15550000002";
    const backend = new MockBackend({
      DEMO_MAYA_PHONE: mayaPhone,
      DEMO_ALSO_PHONES: aliasPhone,
    });
    setBackend(backend);
    const outbound: string[] = [];
    const seenByGrok: string[] = [];
    setOutboundObserver((to, content) => outbound.push(`${to} ${content}`));
    let step = 0;
    setGrokClientForTests({
      chat: {
        completions: {
          create: async (body) => {
            seenByGrok.push(JSON.stringify(body.messages));
            const messages = seenByGrok[seenByGrok.length - 1] ?? "";
            const introId = messages.match(/intro_[0-9a-f-]{36}/i)?.[0];
            if (!messages.includes('"content":"send"')) {
              step += 1;
              if (step === 1) return toolCall("a1", "find_paths", { clubId: "ysig" });
              if (step === 2) {
                return toolCall("a2", "save_intro_draft", {
                  connectorId: "jordan",
                  clubId: "ysig",
                  message: "Hey Jordan, want to grab coffee about YSIG?",
                });
              }
              if (step === 3) return toolCall("a3", "send_intro", { introId });
              return { choices: [{ message: { content: "Here's the draft. Reply send and I'll text Jordan." } }] };
            }
            if (!messages.includes('"ok":true')) return toolCall("a4", "send_intro", { introId });
            return { choices: [{ message: { content: "Sent it to Jordan." } }] };
          },
        },
      },
    });

    await handleMessage(aliasPhone, "yes");
    await handleMessage(aliasPhone, "send");
    expect(outbound.some((line) => line.startsWith(jordanPhone))).toBe(true);

    outbound.length = 0;
    const replies = await handleMessage(jordanPhone, "YES");
    expect(replies).toEqual(["Thanks, I've let Maya Chen know."]);
    expect(outbound).toEqual([
      `${aliasPhone} Jordan Hale accepted your intro request for Yale Student Investment Group! They'll reach out.`,
    ]);
    expect(outbound.some((line) => line.startsWith(mayaPhone))).toBe(false);
    expect(seenByGrok.join("\n")).not.toContain("requesterPhone");
    expect(seenByGrok.join("\n")).not.toContain(aliasPhone);
  });
});
