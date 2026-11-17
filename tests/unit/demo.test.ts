import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { resolveClub } from "@/server/clubs/resolve";
import type { Db } from "@/server/db/client";
import { people } from "@/server/db/schema";
import { searchPaths } from "@/server/paths/service";
import { searchDirectory } from "@/server/people/service";
import { purgeDemo, seed } from "@/server/tasks/seed";
import { createTestDb } from "../helpers/db";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seed(db);
});
afterAll(() => close());

describe("seeded demo (section 14)", () => {
  test("seed is idempotent", async () => {
    const before = (await db.select().from(people)).length;
    await seed(db);
    expect((await db.select().from(people)).length).toBe(before);
  });

  test("demo_maya searching YSIG gets Jordan at rank 1 and Priya via Sam at rank 2", async () => {
    const { club } = await resolveClub(db, "ysig");
    expect(club?.name).toBe("Yale Student Investment Group");
    const res = await searchPaths(db, { requesterNetid: "demo_maya", clubId: club!.id, channel: "app" });
    expect(res.results.length).toBeGreaterThanOrEqual(2);
    const [first, second] = res.results;
    expect(first.connector.netid).toBe("demo_jordan");
    expect(first.hops).toBe(1);
    expect(first.score).toBe(0.93);
    expect(first.link).toMatchObject({ type: "member", title: "Analyst", status: "verified" });
    expect(first.why).toBe("Jordan is your friend and a YSIG analyst (confirmed on the club's site).");
    expect(second.connector.netid).toBe("demo_priya");
    expect(second.hops).toBe(2);
    expect(second.target?.person.netid).toBe("demo_sam");
    expect(second.why).toBe("Priya is your friend and is friends with Sam Wu, YSIG's president.");
    expect(res.search_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("demo people never appear for a non-demo viewer", async () => {
    await db.insert(people).values({ netid: "real1", firstName: "Real", lastName: "Person" });
    const asReal = await searchDirectory(db, { netid: "real1", isDemo: false }, "jordan");
    expect(asReal.find((p) => p.netid === "demo_jordan")).toBeUndefined();
    const asDemo = await searchDirectory(db, { netid: "demo_maya", isDemo: true }, "jordan");
    expect(asDemo.find((p) => p.netid === "demo_jordan")).toBeDefined();
  });

  test("--purge removes every demo row", async () => {
    await purgeDemo(db);
    expect((await db.select().from(people).where(eq(people.isDemo, true))).length).toBe(0);
  });
});
