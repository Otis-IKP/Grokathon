const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** Lowercase, strip diacritics, punctuation and generational suffixes, split into tokens. */
export function nameTokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter((t) => t && !SUFFIXES.has(t));
}

export function normalizeName(name: string): string {
  return nameTokens(name).join(" ");
}

export type NameParts = { firstName: string; preferredName?: string | null; lastName: string };

function firstNameMatches(candidate: string, given: string): boolean {
  if (!candidate || !given) return false;
  if (candidate === given) return true;
  const [short, long] = candidate.length <= given.length ? [candidate, given] : [given, candidate];
  // "Sam" / "Samuel": one is a prefix of the other, at least 3 letters.
  return short.length >= 3 && long.startsWith(short);
}

/**
 * Does a full name as written on a roster or a LinkedIn profile refer to this
 * directory person? Middle names are ignored; the preferred name is accepted;
 * first names may be prefix-shortened. Last names must match exactly.
 */
export function fullNameMatchesPerson(fullName: string, person: NameParts): boolean {
  const tokens = nameTokens(fullName);
  const last = nameTokens(person.lastName);
  if (tokens.length < 2 || last.length === 0 || tokens.length <= last.length) return false;
  const tail = tokens.slice(tokens.length - last.length);
  if (tail.join(" ") !== last.join(" ")) return false;
  const first = tokens[0];
  const given = [person.firstName, person.preferredName ?? ""]
    .map((n) => nameTokens(n)[0] ?? "")
    .filter(Boolean);
  return given.some((g) => firstNameMatches(first, g));
}

export type RosterCandidate = NameParts & { netid: string; year: number | null; college: string | null };

export type RosterMatch =
  | { kind: "match"; netid: string }
  | { kind: "ambiguous"; netids: string[] }
  | { kind: "none" };

/**
 * Section 7.6. One candidate → match. Several → narrow by class year, then
 * college, when the roster gave them. Never pick among ambiguous candidates:
 * a wrong match attaches a club to the wrong person.
 */
export function pickRosterMatch(
  roster: { fullName: string; classYear?: number | null; college?: string | null },
  candidates: RosterCandidate[],
): RosterMatch {
  let pool = candidates.filter((c) => fullNameMatchesPerson(roster.fullName, c));
  if (pool.length === 0) return { kind: "none" };
  if (pool.length > 1 && roster.classYear != null) {
    const byYear = pool.filter((c) => c.year === roster.classYear);
    if (byYear.length > 0) pool = byYear;
  }
  if (pool.length > 1 && roster.college) {
    const college = roster.college.trim().toLowerCase();
    const byCollege = pool.filter((c) => (c.college ?? "").trim().toLowerCase() === college);
    if (byCollege.length > 0) pool = byCollege;
  }
  // A single candidate whose stated class year contradicts the roster is not a match.
  if (pool.length === 1) {
    const only = pool[0];
    if (roster.classYear != null && only.year != null && only.year !== roster.classYear) return { kind: "none" };
    // "Sam Lee" on a roster and "Samantha Lee" in the directory may be two people
    // (the directory covers Yale College only). A nickname-style match needs the
    // roster's class year or college to agree; otherwise a person reviews it.
    const first = nameTokens(roster.fullName)[0] ?? "";
    const exact = [only.firstName, only.preferredName ?? ""].some((n) => (nameTokens(n)[0] ?? "") === first);
    const corroborated =
      (roster.classYear != null && only.year === roster.classYear) ||
      (roster.college != null &&
        roster.college.trim().toLowerCase() === (only.college ?? "").trim().toLowerCase());
    if (!exact && !corroborated) return { kind: "ambiguous", netids: [only.netid] };
    return { kind: "match", netid: only.netid };
  }
  return { kind: "ambiguous", netids: pool.map((c) => c.netid) };
}

/** Last-name token used to pre-filter candidates in SQL. */
export function lastToken(fullName: string): string | null {
  const tokens = nameTokens(fullName);
  return tokens.length >= 2 ? tokens[tokens.length - 1] : null;
}

export function firstNameAndInitial(first: string, last: string): string {
  const initial = last.trim().charAt(0).toUpperCase();
  return initial ? `${first} ${initial}.` : first;
}
