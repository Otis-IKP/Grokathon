import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/agent/systemPrompt";
import { MockBackend } from "../src/backend/MockBackend";

describe("findPaths", () => {
  const backend = new MockBackend();

  it("ranks Maya's YSIG paths and hides phones, pending friends, and unmatched contacts", async () => {
    const paths = await backend.findPaths("maya", "ysig");
    expect(paths[0]?.connector.name).toBe("Jordan Hale");
    expect(paths[0]?.hops).toBe(1);
    expect(paths[0]?.via).toBe("friend_in_club");

    expect(paths[1]?.connector.name).toBe("Priya Shah");
    expect(paths[1]?.hops).toBe(2);
    expect(paths[1]?.target?.name).toBe("Sam Okonkwo");
    expect(paths[1]?.target?.role).toBe("board");
    expect(paths[1]?.via).toBe("friend_of_member");

    const names = paths.map((path) => path.connector.name);
    expect(names).not.toContain("Casey Nguyen");
    expect(names).not.toContain("Alex Rivera");

    const blob = JSON.stringify(paths);
    expect(blob.toLowerCase()).not.toContain("phone");
    expect(blob).not.toContain("+1555");
    expect(blob).not.toContain("555000");
  });

  it("keeps the YPU friend path and also reaches Whiffenpoofs through Jordan", async () => {
    const ypu = await backend.findPaths("maya", "ypu");
    expect(ypu[0]?.connector.name).toBe("Jordan Hale");
    expect(ypu[0]?.hops).toBe(1);
    expect(ypu.some((path) => path.connector.name === "Chris Park" && path.target?.name === "Taylor Brooks")).toBe(true);

    const whiffs = await backend.findPaths("maya", "whiffs");
    expect(whiffs[0]?.connector.name).toBe("Jordan Hale");
    expect(whiffs[0]?.hops).toBe(1);
  });

  it("gives any phone the same warm graph", async () => {
    const fromDc = await backend.getUserByPhone("+12029130363");
    const fromRandom = await backend.getUserByPhone("+15559999999");
    expect(fromDc?.id.startsWith("guest_")).toBe(true);
    expect(fromDc?.phone).toBe("+12029130363");
    expect(fromRandom?.phone).toBe("+15559999999");

    const paths = await backend.findPaths(fromRandom?.id ?? "", "whiffs");
    expect(paths[0]?.connector.name).toBe("Jordan Hale");
  });

  it("addresses Otis and Arden by name and still finds Jordan", async () => {
    const backend = new MockBackend({
      DEMO_MAYA_PHONE: "+18179360103",
      DEMO_JORDAN_PHONE: "+12035854812",
      DEMO_ALSO_PHONES: "+12035894150,+12035357481",
    });
    const otis = await backend.getUserByPhone("+1 (203) 589-4150");
    const arden = await backend.getUserByPhone("+12035357481");
    const jesse = await backend.getUserByPhone("+12035854812");

    expect(otis?.name).toBe("Otis");
    expect(arden?.name).toBe("Arden");
    expect(jesse?.name).toBe("Jordan Hale");
    expect(buildSystemPrompt(otis!)).toContain("The student's name is Otis.");
    expect(buildSystemPrompt(otis!)).not.toContain("Maya");
    expect(buildSystemPrompt(arden!)).toContain("The student's name is Arden.");

    const paths = await backend.findPaths(otis?.id ?? "", "ysig");
    expect(paths[0]?.connector.name).toBe("Jordan Hale");
  });
});
