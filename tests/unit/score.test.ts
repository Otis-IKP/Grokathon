import { describe, expect, test } from "vitest";
import { evidenceSuffix, explainPath } from "@/server/paths/explain";
import { comparePaths, scorePath, WEIGHTS, type ScoreInput } from "@/server/paths/score";

const base: ScoreInput = {
  tie: "confirmed",
  hops: 1,
  role: "member",
  status: "verified",
  pendingIntros: 0,
  sameCollege: false,
  sameYear: false,
};

describe("scorePath (section 11.3)", () => {
  test("1-hop link weights: board 1.0, member 0.9, alum 0.6", () => {
    expect(scorePath({ ...base, role: "board" })).toBe(1);
    expect(scorePath({ ...base, role: "member" })).toBe(0.9);
    expect(scorePath({ ...base, role: "alum" })).toBe(0.6);
  });

  test("tie: one-sided is 0.6 of confirmed", () => {
    expect(scorePath({ ...base, tie: "one_sided" })).toBe(0.54);
  });

  test("2-hop via friend: 0.6 × (board 1.0 | member 0.8)", () => {
    expect(scorePath({ ...base, hops: 2, via: "friend", role: "board" })).toBe(0.6);
    expect(scorePath({ ...base, hops: 2, via: "friend", role: "member" })).toBe(0.48);
  });

  test("2-hop via shared club: 0.35 × (board 1.0 | member 0.8)", () => {
    expect(scorePath({ ...base, hops: 2, via: "shared_club", role: "board" })).toBe(0.35);
    expect(scorePath({ ...base, hops: 2, via: "shared_club", role: "member" })).toBe(0.28);
  });

  test("confidence: verified 1.0, likely 0.8, claimed 0.7", () => {
    expect(scorePath({ ...base, status: "likely" })).toBe(0.72);
    expect(scorePath({ ...base, status: "claimed" })).toBe(0.63);
  });

  test("load: 0.8 once the connector has 3 or more intros awaiting response", () => {
    expect(scorePath({ ...base, pendingIntros: 2 })).toBe(0.9);
    expect(scorePath({ ...base, pendingIntros: 3 })).toBe(0.72);
  });

  test("affinity adds 0.03 each for same college and same year, and the result is clamped to 1", () => {
    expect(scorePath({ ...base, sameCollege: true })).toBe(0.93);
    expect(scorePath({ ...base, sameCollege: true, sameYear: true })).toBe(0.96);
    expect(scorePath({ ...base, role: "board", sameCollege: true, sameYear: true })).toBe(1);
  });

  test("weights are exported from one constant", () => {
    expect(WEIGHTS.tie.one_sided).toBe(0.6);
    expect(WEIGHTS.load.busyThreshold).toBe(3);
  });

  test("ordering: score, then fewer hops, then connector name", () => {
    const rows = [
      { score: 0.5, hops: 2, connectorName: "Zed" },
      { score: 0.5, hops: 1, connectorName: "Yan" },
      { score: 0.9, hops: 2, connectorName: "Abe" },
      { score: 0.5, hops: 1, connectorName: "Bea" },
    ];
    expect(rows.sort(comparePaths).map((r) => r.connectorName)).toEqual(["Abe", "Bea", "Yan", "Zed"]);
  });
});

describe("explainPath (section 11.4)", () => {
  test("1-hop, verified on the club site", () => {
    expect(
      explainPath({
        kind: "member",
        tie: "confirmed",
        connectorFirstName: "Jordan",
        clubShort: "YSIG",
        role: "member",
        title: "Analyst",
        status: "verified",
        evidenceSource: "club_site",
      }),
    ).toBe("Jordan is your friend and a YSIG analyst (confirmed on the club's site).");
  });

  test("2-hop via a friend", () => {
    expect(
      explainPath({
        kind: "via_friend",
        tie: "confirmed",
        connectorFirstName: "Priya",
        clubShort: "YSIG",
        targetName: "Sam Wu",
        targetRole: "board",
        targetTitle: "President",
      }),
    ).toBe("Priya is your friend and is friends with Sam Wu, YSIG's president.");
  });

  test("2-hop via a shared club", () => {
    expect(
      explainPath({
        kind: "via_shared_club",
        tie: "confirmed",
        connectorFirstName: "Ana",
        clubShort: "YSIG",
        targetName: "Sam Wu",
        targetRole: "board",
        sharedClub: "the Dramat",
      }),
    ).toBe("Ana is your friend and is in the Dramat with Sam Wu, who is on YSIG's board.");
  });

  test("one-sided tie starts with \"You added\"", () => {
    expect(
      explainPath({
        kind: "member",
        tie: "one_sided",
        connectorFirstName: "Kai",
        clubShort: "YDN",
        role: "member",
        title: null,
        status: "claimed",
        evidenceSource: null,
      }),
    ).toBe("You added Kai, who is a YDN member (self-reported).");
  });

  test("evidence suffixes", () => {
    expect(evidenceSuffix("verified", "campus_news")).toBe(" (confirmed by campus news)");
    expect(evidenceSuffix("likely", "linkedin")).toBe(" (likely, from public sources)");
    expect(evidenceSuffix("claimed", null)).toBe(" (self-reported)");
  });
});
