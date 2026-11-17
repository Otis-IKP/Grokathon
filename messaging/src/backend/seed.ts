import { createHash } from "node:crypto";
import type { Club, Contact, Friendship, Membership, User } from "../types";
import { normalizePhone } from "../util/phone";

/**
 * Fictional demo graph. Every name and 555 number is made up for the hackathon.
 * Maya wants YSIG: Jordan is a 1-hop analyst, Priya is not a member and knows
 * board member Sam. The mock backend also puts Jordan and Sam on every club
 * so a demo from any phone still has a real connector to text.
 */

export const DEMO_PHONES = {
  maya: "+15550000001",
  jordan: "+15550000002",
  priya: "+15550000003",
  sam: "+15550000004",
} as const;

export interface SeedData {
  users: User[];
  clubs: Club[];
  memberships: Membership[];
  friendships: Friendship[];
  contacts: Contact[];
}

function hashPhone(phone: string): string {
  return createHash("sha256").update(phone).digest("hex").slice(0, 16);
}

export function buildSeed(env: NodeJS.ProcessEnv = {}): SeedData {
  const clubs: Club[] = [
    {
      id: "ysig",
      name: "Yale Student Investment Group",
      aliases: ["YSIG", "investment club"],
      category: "finance",
      blurb: "Student-run investment group. Analysts pitch stocks and the board allocates a practice portfolio.",
    },
    {
      id: "ypu",
      name: "Yale Political Union",
      aliases: ["YPU"],
      category: "politics",
      blurb: "Weekly debates across party caucuses.",
    },
    {
      id: "whiffs",
      name: "Whiffenpoofs",
      aliases: ["Whiffs"],
      category: "a cappella",
      blurb: "Yale's senior a cappella group.",
    },
    {
      id: "ydn",
      name: "Yale Daily News",
      aliases: ["YDN"],
      category: "publication",
      blurb: "The campus daily newspaper.",
    },
    {
      id: "yucg",
      name: "Yale Undergraduate Consulting Group",
      aliases: ["YUCG", "consulting group"],
      category: "consulting",
      blurb: "Student consulting for local nonprofits and startups.",
    },
    {
      id: "yes",
      name: "Yale Entrepreneurial Society",
      aliases: ["YES"],
      category: "entrepreneurship",
      blurb: "Founders, pitch nights, and startup office hours.",
    },
    {
      id: "yda",
      name: "Yale Debate Association",
      aliases: ["YDA"],
      category: "debate",
      blurb: "Parliamentary and British Parliamentary debate.",
    },
    {
      id: "record",
      name: "Yale Record",
      aliases: ["the Record", "Record"],
      category: "humor",
      blurb: "Yale's humor magazine.",
    },
  ];

  const users: User[] = [
    { id: "maya", name: "Maya Chen", phone: DEMO_PHONES.maya, classYear: 2028, college: "Pierson", suggestible: true },
    { id: "jordan", name: "Jordan Hale", phone: DEMO_PHONES.jordan, classYear: 2027, college: "Pierson", suggestible: true },
    { id: "priya", name: "Priya Shah", phone: DEMO_PHONES.priya, classYear: 2028, college: "Pierson", suggestible: true },
    { id: "sam", name: "Sam Okonkwo", phone: DEMO_PHONES.sam, classYear: 2026, college: "Timothy Dwight", suggestible: true },
    { id: "alex", name: "Alex Rivera", phone: "+15550000005", classYear: 2028, college: "Pierson", suggestible: false },
    { id: "casey", name: "Casey Nguyen", phone: "+15550000006", classYear: 2027, college: "Branford", suggestible: true },
    { id: "chris", name: "Chris Park", phone: "+15550000007", classYear: 2028, college: "Saybrook", suggestible: true },
    { id: "taylor", name: "Taylor Brooks", phone: "+15550000008", classYear: 2026, college: "Berkeley", suggestible: true },
    { id: "riley", name: "Riley Adams", phone: "+15550000009", classYear: 2028, college: "Ezra Stiles", suggestible: true },
    { id: "noah", name: "Noah Patel", phone: "+15550000010", classYear: 2027, college: "Morse", suggestible: true },
    { id: "harper", name: "Harper Quinn", phone: "+15550000011", classYear: 2026, college: "Davenport", suggestible: true },
    { id: "drew", name: "Drew Alvarez", phone: "+15550000012", classYear: 2027, college: "Jonathan Edwards", suggestible: true },
    { id: "quinn", name: "Quinn Ibarra", phone: "+15550000013", classYear: 2026, college: "Branford", suggestible: true },
    { id: "reese", name: "Reese Dalton", phone: "+15550000014", classYear: 2025, college: "Silliman", suggestible: true },
    { id: "avery", name: "Avery Singh", phone: "+15550000015", classYear: 2027, college: "Trumbull", suggestible: true },
    { id: "blake", name: "Blake Moreno", phone: "+15550000016", classYear: 2026, college: "Grace Hopper", suggestible: true },
    { id: "cameron", name: "Cameron Ortiz", phone: "+15550000017", classYear: 2028, college: "Pierson", suggestible: true },
    { id: "dakota", name: "Dakota Kim", phone: "+15550000018", classYear: 2026, college: "Saybrook", suggestible: true },
    { id: "emerson", name: "Emerson Walsh", phone: "+15550000019", classYear: 2027, college: "Berkeley", suggestible: true },
    { id: "finley", name: "Finley Grant", phone: "+15550000020", classYear: 2026, college: "Morse", suggestible: true },
    { id: "gray", name: "Gray Sullivan", phone: "+15550000021", classYear: 2028, college: "Davenport", suggestible: true },
    { id: "hayden", name: "Hayden Clark", phone: "+15550000022", classYear: 2027, college: "Ezra Stiles", suggestible: true },
    { id: "indigo", name: "Indigo Ross", phone: "+15550000023", classYear: 2026, college: "Timothy Dwight", suggestible: true },
    { id: "jules", name: "Jules Perry", phone: "+15550000024", classYear: 2027, college: "Jonathan Edwards", suggestible: true },
    { id: "kai", name: "Kai Nakamura", phone: "+15550000025", classYear: 2028, college: "Branford", suggestible: true },
  ];

  applyDemoPhoneOverrides(users, env);

  const memberships: Membership[] = [
    { userId: "jordan", clubId: "ysig", role: "member", source: "self" },
    { userId: "sam", clubId: "ysig", role: "board", source: "self" },
    { userId: "alex", clubId: "ysig", role: "member", source: "self" },
    { userId: "casey", clubId: "ysig", role: "member", source: "self" },
    { userId: "noah", clubId: "ysig", role: "member", source: "public_roster" },
    { userId: "jules", clubId: "ysig", role: "member", source: "public_roster" },
    { userId: "maya", clubId: "yes", role: "member", source: "self" },
    { userId: "jordan", clubId: "yes", role: "member", source: "self" },
    { userId: "cameron", clubId: "yes", role: "member", source: "self" },
    { userId: "dakota", clubId: "yes", role: "board", source: "self" },
    { userId: "taylor", clubId: "ypu", role: "member", source: "self" },
    { userId: "indigo", clubId: "ypu", role: "board", source: "public_roster" },
    { userId: "kai", clubId: "ypu", role: "member", source: "self" },
    { userId: "harper", clubId: "whiffs", role: "member", source: "public_roster" },
    { userId: "drew", clubId: "whiffs", role: "board", source: "public_roster" },
    { userId: "quinn", clubId: "ydn", role: "member", source: "self" },
    { userId: "reese", clubId: "ydn", role: "board", source: "self" },
    { userId: "avery", clubId: "yucg", role: "member", source: "self" },
    { userId: "blake", clubId: "yucg", role: "board", source: "self" },
    { userId: "emerson", clubId: "yda", role: "member", source: "self" },
    { userId: "finley", clubId: "yda", role: "board", source: "self" },
    { userId: "gray", clubId: "record", role: "member", source: "self" },
    { userId: "hayden", clubId: "record", role: "board", source: "self" },
  ];

  const friendships: Friendship[] = [
    { a: "maya", b: "jordan", status: "accepted" },
    { a: "maya", b: "priya", status: "accepted" },
    { a: "priya", b: "sam", status: "accepted" },
    { a: "maya", b: "alex", status: "accepted" },
    { a: "maya", b: "casey", status: "pending" },
    { a: "maya", b: "chris", status: "accepted" },
    { a: "chris", b: "taylor", status: "accepted" },
    { a: "maya", b: "riley", status: "accepted" },
  ];

  const contacts: Contact[] = [
    { ownerId: "maya", phoneHash: hashPhone("+15550009999") },
    { ownerId: "priya", phoneHash: hashPhone("+15550008888") },
    { ownerId: "riley", phoneHash: hashPhone("+15550000010"), matchedUserId: "noah" },
  ];

  return { users, clubs, memberships, friendships, contacts };
}

const PHONE_OVERRIDES: Record<string, string> = {
  "Maya Chen": "DEMO_MAYA_PHONE",
  "Jordan Hale": "DEMO_JORDAN_PHONE",
  "Priya Shah": "DEMO_PRIYA_PHONE",
  "Sam Okonkwo": "DEMO_SAM_PHONE",
};

export function applyDemoPhoneOverrides(users: User[], env: NodeJS.ProcessEnv): void {
  for (const user of users) {
    const envKey = PHONE_OVERRIDES[user.name];
    const raw = envKey ? env[envKey] : undefined;
    if (raw && raw.trim()) {
      user.phone = normalizePhone(raw);
    }
  }
}
