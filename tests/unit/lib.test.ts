import { describe, expect, test } from "vitest";
import { fullNameMatchesPerson, pickRosterMatch, type RosterCandidate } from "@/lib/names";
import { maskPhone, normalizePhone } from "@/lib/phone";
import { casLoginUrl, casServiceUrl, parseCasResponse, safeNext } from "@/server/auth/cas";
import { normalizeClubName } from "@/server/clubs/aliases";
import { classifySource, filterCited, isCited } from "@/server/claude/evidence";
import { yaliesPeople } from "@/server/yalies/client";
import { rosterIsOld } from "@/server/jobs/handlers";

describe("names (section 7.6)", () => {
  const sam = { firstName: "Samuel", preferredName: "Sam", lastName: "Wu" };

  test("ignores case, middle names, diacritics and suffixes; accepts the preferred name", () => {
    expect(fullNameMatchesPerson("sam wu", sam)).toBe(true);
    expect(fullNameMatchesPerson("Samuel J. Wu", sam)).toBe(true);
    expect(fullNameMatchesPerson("Samuel Wu Jr.", sam)).toBe(true);
    expect(fullNameMatchesPerson("José García", { firstName: "Jose", lastName: "Garcia" })).toBe(true);
    expect(fullNameMatchesPerson("Ana de la Cruz", { firstName: "Ana", lastName: "de la Cruz" })).toBe(true);
  });

  test("prefix first names need 3+ letters; last names must match exactly", () => {
    expect(fullNameMatchesPerson("Sam Wu", { firstName: "Samuel", lastName: "Wu" })).toBe(true);
    expect(fullNameMatchesPerson("Sa Wu", { firstName: "Samuel", lastName: "Wu" })).toBe(false);
    expect(fullNameMatchesPerson("Sam Wun", sam)).toBe(false);
    expect(fullNameMatchesPerson("Wu", sam)).toBe(false);
  });

  const c = (netid: string, year: number, college: string): RosterCandidate => ({
    netid,
    firstName: "Sam",
    lastName: "Wright",
    year,
    college,
  });

  test("one candidate matches; several are narrowed by year then college; never guesses", () => {
    expect(pickRosterMatch({ fullName: "Sam Wright" }, [c("a", 2027, "Morse")])).toEqual({ kind: "match", netid: "a" });
    const two = [c("a", 2027, "Morse"), c("b", 2028, "Pierson")];
    expect(pickRosterMatch({ fullName: "Sam Wright" }, two)).toEqual({ kind: "ambiguous", netids: ["a", "b"] });
    expect(pickRosterMatch({ fullName: "Sam Wright", classYear: 2028 }, two)).toEqual({ kind: "match", netid: "b" });
    const sameYear = [c("a", 2027, "Morse"), c("b", 2027, "Pierson")];
    expect(pickRosterMatch({ fullName: "Sam Wright", classYear: 2027 }, sameYear).kind).toBe("ambiguous");
    expect(pickRosterMatch({ fullName: "Sam Wright", classYear: 2027, college: "pierson" }, sameYear)).toEqual({
      kind: "match",
      netid: "b",
    });
    expect(pickRosterMatch({ fullName: "Nobody Here" }, two)).toEqual({ kind: "none" });
  });

  test("a single candidate with a contradicting class year is not a match", () => {
    expect(pickRosterMatch({ fullName: "Sam Wright", classYear: 2025 }, [c("a", 2027, "Morse")])).toEqual({ kind: "none" });
  });
});

describe("club name normalisation (section 7.5)", () => {
  test("lowercases, strips punctuation, drops leading the/yale", () => {
    expect(normalizeClubName("The Yale Whiffenpoofs")).toBe("whiffenpoofs");
    expect(normalizeClubName("  Yale  Daily News. ")).toBe("daily news");
    expect(normalizeClubName("y/cs")).toBe("y cs");
    expect(normalizeClubName("the Dramat")).toBe("dramat");
    expect(normalizeClubName("Yale")).toBe("yale");
  });
});

describe("phone", () => {
  test("normalises to E.164 with US default and masks", () => {
    expect(normalizePhone("(203) 555-0101")).toBe("+12035550101");
    expect(normalizePhone("+1 203 555 0101")).toBe("+12035550101");
    expect(maskPhone("+12035550101")).toBe("••• ••• 0101");
    expect(() => normalizePhone("12")).toThrowError(/not valid/);
  });
});

describe("CAS (section 6.1)", () => {
  test("next must be a same-origin relative path", () => {
    expect(safeNext("/clubs/ysig?x=1")).toBe("/clubs/ysig?x=1");
    for (const bad of [null, "", "//evil.example", "https://evil.example", "/\\evil.example", "clubs", "/a\nb"]) {
      expect(safeNext(bad)).toBe("/");
    }
  });

  test("the service URL is identical for login and validation and never contains the ticket", () => {
    const service = casServiceUrl("/i/abc");
    expect(service).toBe("http://localhost:3000/api/auth/cas/callback?next=%2Fi%2Fabc");
    expect(casLoginUrl("/i/abc")).toBe(`https://secure.its.yale.edu/cas/login?service=${encodeURIComponent(service)}`);
    expect(service).not.toContain("ticket");
  });

  test("parses success and failure XML strictly", () => {
    const ok = `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationSuccess><cas:user>ABC123</cas:user></cas:authenticationSuccess></cas:serviceResponse>`;
    expect(parseCasResponse(ok)).toEqual({ ok: true, netid: "abc123" });
    const fail = `<cas:serviceResponse><cas:authenticationFailure code="INVALID_TICKET">Ticket not recognized</cas:authenticationFailure></cas:serviceResponse>`;
    expect(parseCasResponse(fail)).toEqual({ ok: false, code: "INVALID_TICKET" });
    expect(parseCasResponse("<html>hello</html>")).toEqual({ ok: false, code: "MALFORMED_RESPONSE" });
    // A user element outside authenticationSuccess is not a sign-in.
    expect(parseCasResponse("<cas:user>abc123</cas:user>").ok).toBe(false);
    expect(parseCasResponse("<cas:authenticationSuccess><cas:user>a b</cas:user></cas:authenticationSuccess>").ok).toBe(false);
  });
});

describe("evidence integrity (section 7.3)", () => {
  const citations = ["https://www.ysig.org/team/", "https://yaledailynews.com/blog/2026/09/01/board?utm_source=x"];

  test("a URL counts only if the run cited the same page", () => {
    expect(isCited("https://ysig.org/team", citations)).toBe(true);
    expect(isCited("http://YSIG.org/team#board", citations)).toBe(true);
    expect(isCited("https://yaledailynews.com/blog/2026/09/01/board", citations)).toBe(true);
    expect(isCited("https://ysig.org/about", citations)).toBe(false);
    expect(isCited("not a url", citations)).toBe(false);
    expect(filterCited([{ url: "https://ysig.org/team" }, { url: "https://invented.example/x" }], citations)).toEqual([
      { url: "https://ysig.org/team" },
    ]);
  });

  test("source type is decided by the host", () => {
    expect(classifySource("https://www.ysig.org/team", "https://ysig.org")).toBe("club_site");
    expect(classifySource("https://yaleconnect.yale.edu/ysig/roster")).toBe("yale_connect");
    expect(classifySource("https://yaledailynews.com/blog/x")).toBe("campus_news");
    expect(classifySource("https://www.linkedin.com/in/someone")).toBe("linkedin");
    expect(classifySource("https://random.example/page")).toBe("other");
  });
});

describe("roster age", () => {
  const nov2026 = new Date("2026-11-17T12:00:00Z");
  test("an earlier academic year is old; the current one is not", () => {
    expect(rosterIsOld("2025-2026", nov2026)).toBe(true);
    expect(rosterIsOld("2025-26", nov2026)).toBe(true);
    expect(rosterIsOld("2026-2027", nov2026)).toBe(false);
    expect(rosterIsOld("2026", nov2026)).toBe(false);
    expect(rosterIsOld("2024", nov2026)).toBe(true);
    expect(rosterIsOld(null, nov2026)).toBe(false);
  });
});

describe("Yalies client (section 6.2)", () => {
  test("keeps only the allowed fields: no phone, birthday or address ever leaves the client", async () => {
    const people = await yaliesPeople({ query: "bea" });
    expect(people).toHaveLength(1);
    expect(Object.keys(people[0]).sort()).toEqual(
      [
        "college",
        "email",
        "first_name",
        "image",
        "last_name",
        "major",
        "netid",
        "preferred_name",
        "school",
        "school_code",
        "upi",
        "year",
      ].sort(),
    );
    expect(JSON.stringify(people)).not.toMatch(/555|birth|address|Example Street/);
  });

  test("filters by NetID and pages from 0", async () => {
    const all = await yaliesPeople({ filters: { school_code: ["YC"] }, page: 0, page_size: 5 });
    expect(all).toHaveLength(5);
    const next = await yaliesPeople({ filters: { school_code: ["YC"] }, page: 1, page_size: 5 });
    expect(next[0].netid).not.toBe(all[0].netid);
    const empty = await yaliesPeople({ filters: { school_code: ["YC"] }, page: 99, page_size: 5 });
    expect(empty).toEqual([]);
  });
});
