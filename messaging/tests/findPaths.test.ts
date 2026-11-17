import { describe, expect, it } from "vitest";
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

  it("gives Maya one YPU path and no Whiffenpoofs path", async () => {
    const ypu = await backend.findPaths("maya", "ypu");
    expect(ypu).toHaveLength(1);
    expect(ypu[0]?.hops).toBe(2);
    expect(ypu[0]?.connector.name).toBe("Chris Park");
    expect(ypu[0]?.target?.name).toBe("Taylor Brooks");

    expect(await backend.findPaths("maya", "whiffs")).toEqual([]);
  });

  it("treats extra demo phones as Maya", async () => {
    const aliased = new MockBackend({
      DEMO_ALSO_PHONES: "+1 (555) 000-9101, +1 (555) 000-9102",
    });
    const fromDc = await aliased.getUserByPhone("+15550009101");
    const fromCt = await aliased.getUserByPhone("+15550009102");
    expect(fromDc?.id).toBe("maya");
    expect(fromCt?.id).toBe("maya");
    expect(await aliased.getUserByPhone("+15559999999")).toBeNull();
  });
});
