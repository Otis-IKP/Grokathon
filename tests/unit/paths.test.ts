import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/server/db/client";
import { friendships, intros, memberships, pathSearches, people, users, type Club } from "@/server/db/schema";
import { findPaths } from "@/server/paths/findPaths";
import { createTestDb } from "../helpers/db";
import { makeClub, makeFriends, makeMember, makePerson, makeUser } from "../helpers/factory";

let db: Db;
let close: () => Promise<void>;
let club: Club;
let other: Club;

beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

/** A fresh graph per test: requester `r`, and two clubs. */
beforeEach(async () => {
  await db.delete(intros);
  await db.delete(pathSearches);
  await db.delete(friendships);
  await db.delete(memberships);
  await db.delete(users);
  await db.delete(people);
  club ??= await makeClub(db, "Yale Student Investment Group", "YSIG");
  other ??= await makeClub(db, "Yale Chess Club", "Chess");
  await makeUser(db, "r", { person: { firstName: "Rae", college: "Morse", year: 2028 } });
});

const paths = (limit = 5) => findPaths(db, "r", club.id, limit);

describe("findPaths (section 11.6)", () => {
  test("1-hop beats 2-hop", async () => {
    await makeUser(db, "f1", { person: { college: "X", year: 2025 } });
    await makeUser(db, "f2", { person: { college: "X", year: 2025 } });
    await makePerson(db, "t", { college: "X", year: 2025 });
    await makeFriends(db, "r", "f1");
    await makeFriends(db, "r", "f2");
    await makeFriends(db, "f2", "t");
    await makeMember(db, "f1", club.id, { role: "member" });
    await makeMember(db, "t", club.id, { role: "board", title: "President" });
    const { results } = await paths();
    expect(results.map((r) => [r.connector.netid, r.hops])).toEqual([
      ["f1", 1],
      ["f2", 2],
    ]);
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(results[1].target?.person.netid).toBe("t");
    expect(results[1].link).toEqual({ type: "knows_member", via: "friend" });
  });

  test("board beats member at equal hops", async () => {
    await makeUser(db, "member1", { person: { college: "X", year: 2025 } });
    await makeUser(db, "board1", { person: { college: "X", year: 2025 } });
    await makeFriends(db, "r", "member1");
    await makeFriends(db, "r", "board1");
    await makeMember(db, "member1", club.id, { role: "member" });
    await makeMember(db, "board1", club.id, { role: "board" });
    const { results } = await paths();
    expect(results.map((r) => r.connector.netid)).toEqual(["board1", "member1"]);
  });

  test("a one-sided tie ranks below a confirmed one", async () => {
    await makeUser(db, "confirmed", { person: { college: "X", year: 2025 } });
    await makePerson(db, "added", { college: "X", year: 2025 });
    await makeFriends(db, "r", "confirmed", "accepted");
    await makeFriends(db, "r", "added", "pending");
    await makeMember(db, "confirmed", club.id);
    await makeMember(db, "added", club.id);
    const { results } = await paths();
    expect(results.map((r) => [r.connector.netid, r.connector_tie])).toEqual([
      ["confirmed", "friend"],
      ["added", "added"],
    ]);
    expect(results[1].why.startsWith("You added")).toBe(true);
  });

  test("a pending request the requester did not create is not an edge", async () => {
    await makeUser(db, "stranger");
    await makeFriends(db, "stranger", "r", "pending");
    await makeMember(db, "stranger", club.id);
    const { results, emptyReason } = await paths();
    expect(results).toEqual([]);
    expect(emptyReason).toBe("no_friends");
  });

  test("a one-sided tie never produces a 2-hop", async () => {
    await makeUser(db, "f");
    await makePerson(db, "t");
    await makeFriends(db, "r", "f", "pending");
    await makeFriends(db, "f", "t", "accepted");
    await makeMember(db, "t", club.id, { role: "board" });
    const { results, emptyReason } = await paths();
    expect(results).toEqual([]);
    expect(emptyReason).toBe("no_connection");
  });

  test("the second hop must be a confirmed friendship too", async () => {
    await makeUser(db, "f");
    await makePerson(db, "t");
    await makeFriends(db, "r", "f", "accepted");
    await makeFriends(db, "f", "t", "pending");
    await makeMember(db, "t", club.id);
    expect((await paths()).results).toEqual([]);
  });

  test("share_connections = false removes that user's 2-hops but not their 1-hop", async () => {
    await makeUser(db, "private", { user: { shareConnections: false } });
    await makePerson(db, "t");
    await makeFriends(db, "r", "private");
    await makeFriends(db, "private", "t");
    await makeMember(db, "t", club.id);
    expect((await paths()).results).toEqual([]);

    await makeMember(db, "private", club.id);
    const { results } = await paths();
    expect(results.map((r) => [r.connector.netid, r.hops])).toEqual([["private", 1]]);
  });

  test("a friend who is not a user cannot be routed through (they never agreed to share)", async () => {
    await makePerson(db, "nonuser");
    await makePerson(db, "t");
    await makeFriends(db, "r", "nonuser");
    await makeFriends(db, "nonuser", "t");
    await makeMember(db, "t", club.id);
    expect((await paths()).results).toEqual([]);
  });

  test("allow_as_connector = false removes the connector entirely", async () => {
    await makeUser(db, "optout", { user: { allowAsConnector: false } });
    await makePerson(db, "t");
    await makeFriends(db, "r", "optout");
    await makeFriends(db, "optout", "t");
    await makeMember(db, "optout", club.id);
    await makeMember(db, "t", club.id);
    expect((await paths()).results).toEqual([]);
  });

  test("hidden people appear nowhere: not as connector, not as target", async () => {
    await makeUser(db, "hiddenfriend", { person: { visibility: "hidden" } });
    await makeUser(db, "f");
    await makePerson(db, "hiddentarget", { visibility: "hidden" });
    await makeFriends(db, "r", "hiddenfriend");
    await makeFriends(db, "r", "f");
    await makeFriends(db, "f", "hiddentarget");
    await makeMember(db, "hiddenfriend", club.id);
    await makeMember(db, "hiddentarget", club.id);
    const { results } = await paths();
    expect(JSON.stringify(results)).not.toContain("hidden");
    expect(results).toEqual([]);
  });

  test("unverified, disputed and rejected memberships are ignored", async () => {
    for (const [netid, status] of [
      ["u1", "unverified"],
      ["u2", "disputed"],
      ["u3", "rejected"],
    ] as const) {
      await makeUser(db, netid);
      await makeFriends(db, "r", netid);
      const m = await makeMember(db, netid, club.id, { status: "claimed" });
      await db.update(memberships).set({ status }).where(eq(memberships.id, m.id));
    }
    const { results, emptyReason } = await paths();
    expect(results).toEqual([]);
    expect(emptyReason).toBe("no_known_members");
  });

  test("the requester is never their own target", async () => {
    // r is friends with f; f's only club friend is r themselves (r is an alum, not a current member).
    await makeUser(db, "f");
    await makeFriends(db, "r", "f");
    await makeMember(db, "r", club.id, { role: "alum", isCurrent: false });
    const { results } = await paths();
    expect(results).toEqual([]);
  });

  test("one connector appears once, with their best path", async () => {
    await makeUser(db, "f");
    await makePerson(db, "member", { firstName: "Mem" });
    await makePerson(db, "board", { firstName: "Boa" });
    await makeFriends(db, "r", "f");
    await makeFriends(db, "f", "member");
    await makeFriends(db, "f", "board");
    await makeMember(db, "member", club.id, { role: "member" });
    await makeMember(db, "board", club.id, { role: "board", title: "Treasurer" });
    const { results } = await paths();
    expect(results).toHaveLength(1);
    expect(results[0].target?.person.netid).toBe("board");
  });

  test("a declined intro suppresses the connector for that club only, for 30 days", async () => {
    await makeUser(db, "f");
    await makeFriends(db, "r", "f");
    await makeMember(db, "f", club.id);
    await makeMember(db, "f", other.id);
    const decline = async (respondedAt: Date) => {
      await db.delete(intros);
      await db.insert(intros).values({
        requesterNetid: "r",
        connectorNetid: "f",
        clubId: club.id,
        message: "hi",
        status: "declined",
        channel: "app",
        responseToken: `tok-${respondedAt.getTime()}`,
        respondedAt,
      });
    };
    await decline(new Date());
    expect((await paths()).results).toEqual([]);
    expect((await findPaths(db, "r", other.id, 5)).results.map((r) => r.connector.netid)).toEqual(["f"]);

    await decline(new Date(Date.now() - 31 * 24 * 60 * 60 * 1000));
    expect((await paths()).results.map((r) => r.connector.netid)).toEqual(["f"]);
  });

  test("already a member returns no results with already_member", async () => {
    await makeUser(db, "f");
    await makeFriends(db, "r", "f");
    await makeMember(db, "f", club.id);
    await makeMember(db, "r", club.id, { status: "claimed" });
    const res = await paths();
    expect(res.results).toEqual([]);
    expect(res.emptyReason).toBe("already_member");
  });

  test("empty reasons: no_friends, no_known_members, no_connection", async () => {
    expect((await paths()).emptyReason).toBe("no_friends");
    await makeUser(db, "f");
    await makeFriends(db, "r", "f");
    expect((await paths()).emptyReason).toBe("no_known_members");
    await makePerson(db, "unrelated");
    await makeMember(db, "unrelated", club.id);
    expect((await paths()).emptyReason).toBe("no_connection");
  });

  test("weak tie: friend shares a small verified club with a member", async () => {
    await makePerson(db, "f");
    await makePerson(db, "t", { firstName: "Tess", lastName: "Ng" });
    await makeFriends(db, "r", "f", "pending"); // weak ties work from any friend edge
    await makeMember(db, "f", other.id);
    await makeMember(db, "t", other.id);
    await makeMember(db, "t", club.id, { role: "board" });
    const { results } = await paths();
    expect(results).toHaveLength(1);
    expect(results[0].link).toEqual({ type: "knows_member", via: "shared_club", shared_club: "Chess" });
    expect(results[0].why).toBe("You added F, who is in Chess with Tess Ng, who is on YSIG's board.");
  });

  test("weak tie needs verified memberships in the shared club", async () => {
    await makeUser(db, "f");
    await makePerson(db, "t");
    await makeFriends(db, "r", "f");
    await makeMember(db, "f", other.id, { status: "claimed" });
    await makeMember(db, "t", other.id);
    await makeMember(db, "t", club.id);
    expect((await paths()).results).toEqual([]);
  });

  test("a busy connector (3+ intros awaiting response) is scored lower", async () => {
    await makeUser(db, "busy", { person: { college: "X", year: 2025, firstName: "Abe" } });
    await makeUser(db, "free", { person: { college: "X", year: 2025, firstName: "Zed" } });
    await makePerson(db, "someone");
    for (const f of ["busy", "free"]) {
      await makeFriends(db, "r", f);
      await makeMember(db, f, club.id);
    }
    for (let i = 0; i < 3; i++) {
      await db.insert(intros).values({
        requesterNetid: "someone",
        connectorNetid: "busy",
        clubId: club.id,
        message: "hi",
        status: "sent",
        channel: "app",
        responseToken: `busy-${i}`,
      });
    }
    const { results } = await paths();
    expect(results.map((r) => [r.connector.netid, r.score])).toEqual([
      ["free", 0.9],
      ["busy", 0.72],
    ]);
  });

  test("limit is respected and ranks are 1..n", async () => {
    for (const n of ["a", "b", "c", "d"]) {
      await makeUser(db, n);
      await makeFriends(db, "r", n);
      await makeMember(db, n, club.id);
    }
    const { results } = await paths(3);
    expect(results.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
});
