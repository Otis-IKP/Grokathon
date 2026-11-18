import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/agent/systemPrompt";
import { MockBackend } from "../src/backend/MockBackend";
import { pathsFor } from "./helpers";

describe("findPaths", () => {
  const backend = new MockBackend();

  it("ranks Maya's YSIG paths and hides phones, pending friends, and unmatched contacts", async () => {
    const paths = await pathsFor(backend, "maya", "ysig");
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
    const ypu = await pathsFor(backend, "maya", "ypu");
    expect(ypu[0]?.connector.name).toBe("Jordan Hale");
    expect(ypu[0]?.hops).toBe(1);
    expect(ypu.some((path) => path.connector.name === "Chris Park" && path.target?.name === "Taylor Brooks")).toBe(true);

    const whiffs = await pathsFor(backend, "maya", "whiffs");
    expect(whiffs[0]?.connector.name).toBe("Jordan Hale");
    expect(whiffs[0]?.hops).toBe(1);
  });

  it("gives any phone the same warm graph", async () => {
    const fromElsewhere = await backend.getUserByPhone("+15550107777");
    const fromRandom = await backend.getUserByPhone("+15559999999");
    expect(fromElsewhere?.id.startsWith("guest_")).toBe(true);
    expect(fromElsewhere?.phone).toBe("+15550107777");
    expect(fromRandom?.phone).toBe("+15559999999");

    const paths = await pathsFor(backend, fromRandom?.id ?? "", "whiffs");
    expect(paths[0]?.connector.name).toBe("Jordan Hale");
  });

  it("addresses Otis and Arden by name and still finds Jordan", async () => {
    const backend = new MockBackend({
      DEMO_MAYA_PHONE: "+15550000101",
      DEMO_JORDAN_PHONE: "+15550000104",
      DEMO_ALSO_PHONES: "+15550000102,+15550000103",
    });
    const otis = await backend.getUserByPhone("+1 (555) 000-0102");
    const arden = await backend.getUserByPhone("+15550000103");
    const jesse = await backend.getUserByPhone("+15550000104");

    expect(otis?.name).toBe("Otis");
    expect(arden?.name).toBe("Arden");
    expect(jesse?.name).toBe("Jordan Hale");
    expect(buildSystemPrompt(otis!)).toContain("The student's name is Otis.");
    expect(buildSystemPrompt(otis!)).not.toContain("Maya");
    expect(buildSystemPrompt(arden!)).toContain("The student's name is Arden.");

    const paths = await pathsFor(backend, otis?.id ?? "", "ysig");
    expect(paths[0]?.connector.name).toBe("Jordan Hale");
  });

  it("takes extra names from DEMO_STUDENT_NAMES and keeps the DEMO_*_PHONE overrides", async () => {
    const backend = new MockBackend({
      DEMO_STUDENT_NAMES: "+15550000201=Robin, (555) 000-0202 = Sky",
      DEMO_JORDAN_PHONE: "+15550000203",
    });
    expect((await backend.getUserByPhone("+15550000201"))?.name).toBe("Robin");
    expect((await backend.getUserByPhone("+15550000202"))?.name).toBe("Sky");
    expect((await backend.getUserByPhone("+15550000203"))?.name).toBe("Jordan Hale");
  });

  it("has no real-looking phone number anywhere in the bot's source, tests or docs", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const files = ["README.md", ".env.example", "public/chat.html", "scripts/simulate.ts"];
    for (const dir of ["src", "tests"]) {
      for (const entry of fs.readdirSync(path.join(root, dir), { recursive: true })) {
        const file = path.join(dir, String(entry));
        if (fs.statSync(path.join(root, file)).isFile()) files.push(file);
      }
    }
    const offenders: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(path.join(root, file), "utf8");
      // North American numbers written with a country code. Fictional ones use 555.
      for (const match of text.matchAll(/\+1[\s(.-]*(\d{3})[\s).-]*(\d{3})[\s.-]*\d{4}\b/g)) {
        if (match[1] !== "555" && match[2] !== "555") offenders.push(`${file}: ${match[0].slice(0, 5)}...`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
