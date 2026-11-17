import { beforeEach, describe, expect, it } from "vitest";
import { MockBackend } from "../src/backend/MockBackend";

describe("resolveClub", () => {
  const backend = new MockBackend();

  beforeEach(() => {
    // Seed is static. A fresh backend keeps tests from depending on intro state.
  });

  async function top(text: string) {
    const matches = await backend.resolveClub(text);
    return matches[0];
  }

  it("matches exact names and aliases, whole words, and close typos", async () => {
    expect((await top("ysig"))?.club.name).toBe("Yale Student Investment Group");
    expect((await top("ysig"))?.confidence).toBe("exact");

    expect((await top("YSIG"))?.confidence).toBe("exact");
    expect((await top("YSIG"))?.club.id).toBe("ysig");

    const investment = await top("the investment club");
    expect(investment?.club.id).toBe("ysig");
    expect(investment?.confidence).toBe("exact");

    const sentence = await top("i want to be on ysig");
    expect(sentence?.club.id).toBe("ysig");
    expect(sentence?.confidence).toBe("alias");

    const whiffs = await top("whiffs");
    expect(whiffs?.club.name).toBe("Whiffenpoofs");
    expect(whiffs?.confidence).toBe("exact");

    const typo = await top("Yale Politcal Union");
    expect(typo?.club.name).toBe("Yale Political Union");
    expect(typo?.confidence).toBe("fuzzy");
  });

  it("creates a club when the name is new and still finds Jordan", async () => {
    const created = await top("sketch comedy");
    expect(created?.confidence).toBe("exact");
    expect(created?.club.name).toBe("Sketch Comedy");
    const paths = await backend.findPaths("maya", created?.club.id ?? "");
    expect(paths[0]?.connector.name).toBe("Jordan Hale");
  });

  it("returns at most 3 matches", async () => {
    const matches = await backend.resolveClub("yale");
    expect(matches.length).toBeLessThanOrEqual(3);
  });
});
