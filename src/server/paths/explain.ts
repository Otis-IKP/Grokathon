import type { Role, Tie, VisibleStatus } from "./score";

/**
 * `why` sentences (section 11.4). Built from templates, not an LLM, so they
 * are instant and never wrong about the facts.
 */

export type ExplainInput = {
  tie: Tie;
  connectorFirstName: string;
  clubShort: string;
} & (
  | {
      kind: "member";
      role: Role;
      title: string | null;
      status: VisibleStatus;
      evidenceSource: string | null;
    }
  | { kind: "via_friend"; targetName: string; targetRole: Role; targetTitle: string | null }
  | { kind: "via_shared_club"; targetName: string; targetRole: Role; sharedClub: string }
);

const VOWEL = /^[aeiou]/i;

function article(word: string): string {
  return VOWEL.test(word) ? "an" : "a";
}

function roleWord(role: Role, title: string | null): string {
  if (title?.trim()) return title.trim().toLowerCase();
  if (role === "board") return "board member";
  if (role === "alum") return "alum";
  return "member";
}

export function evidenceSuffix(status: VisibleStatus, evidenceSource: string | null): string {
  if (status === "verified") {
    if (!evidenceSource || evidenceSource === "club_site") return " (confirmed on the club's site)";
    const names: Record<string, string> = {
      yale_connect: "Yale Connect",
      campus_news: "campus news",
      linkedin: "LinkedIn",
      other: "a public source",
    };
    return ` (confirmed by ${names[evidenceSource] ?? "a public source"})`;
  }
  if (status === "likely") return " (likely, from public sources)";
  return " (self-reported)";
}

export function explainPath(input: ExplainInput): string {
  const F = input.connectorFirstName;
  const lead = input.tie === "one_sided" ? `You added ${F}, who is` : `${F} is your friend and`;
  const is = input.tie === "one_sided" ? "" : " is";

  if (input.kind === "member") {
    const word = roleWord(input.role, input.title);
    const a = input.tie === "one_sided" ? ` ${article(input.clubShort)}` : ` ${article(input.clubShort)}`;
    return `${lead}${a} ${input.clubShort} ${word}${evidenceSuffix(input.status, input.evidenceSource)}.`;
  }
  if (input.kind === "via_friend") {
    const word = roleWord(input.targetRole, input.targetTitle);
    const possessive =
      input.targetRole === "board" && input.targetTitle
        ? `${input.clubShort}'s ${word}`
        : `${article(input.clubShort)} ${input.clubShort} ${word}`;
    return `${lead}${is} friends with ${input.targetName}, ${possessive}.`;
  }
  const tail =
    input.targetRole === "board" ? `who is on ${input.clubShort}'s board` : `who is in ${input.clubShort}`;
  return `${lead}${is} in ${input.sharedClub} with ${input.targetName}, ${tail}.`;
}
