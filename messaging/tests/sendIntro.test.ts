import { beforeEach, describe, expect, it } from "vitest";
import { setBackend } from "../src/backend/Backend";
import { MockBackend } from "../src/backend/MockBackend";
import { getSession, resetSessionsForTests } from "../src/agent/session";
import { executeTool } from "../src/agent/tools";
import { resetSendblueForTests } from "../src/transport/sendblue";
import { loadTestConfig } from "./helpers";

describe("send_intro confirmation gate", () => {
  const backend = new MockBackend();

  beforeEach(() => {
    loadTestConfig();
    resetSessionsForTests();
    resetSendblueForTests();
    setBackend(backend);
  });

  it("rejects a send that was not confirmed or that is not the pending draft", async () => {
    const session = getSession("+15550000001", "maya");
    session.allowedConnectorIds = ["jordan"];
    const intro = await backend.createIntro({
      requesterId: "maya",
      connectorId: "jordan",
      clubId: "ysig",
      message: "Hey Jordan, want to grab coffee about YSIG?",
    });
    session.pendingIntroId = intro.id;

    session.latestUserText = "sounds good, tell me more";
    const unconfirmed = await executeTool("send_intro", { introId: intro.id }, session);
    expect(unconfirmed).toEqual({ error: "not confirmed: ask the user to reply 'send'" });

    session.latestUserText = "send";
    const mismatched = await executeTool("send_intro", { introId: "intro_other" }, session);
    expect(mismatched).toEqual({ error: "not confirmed: ask the user to reply 'send'" });

    const stillDraft = await backend.getIntro(intro.id);
    expect(stillDraft?.status).toBe("drafted");
  });
});
