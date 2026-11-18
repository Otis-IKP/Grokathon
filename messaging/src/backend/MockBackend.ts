import { randomUUID } from "node:crypto";
import type {
  Backend,
  Club,
  ClubMatch,
  Contact,
  Friendship,
  Intro,
  IntroAnswer,
  LinkResult,
  Membership,
  PathResult,
  PathSearch,
  Role,
  User,
} from "../types";
import { IntroAlreadyAnsweredError } from "../types";
import { BackendError } from "./Backend";
import { buildSeed } from "./seed";
import { normalizePhone } from "../util/phone";

const CONFIDENCE_RANK = { exact: 0, alias: 1, fuzzy: 2 } as const;

/**
 * Phones the bot addresses by a first name while they use Maya's friends.
 * These defaults are fictional. Real teammates go in the DEMO_STUDENT_NAMES
 * env var ("+15550000101=Tobi,+15550000102=Otis"), never in this file.
 */
const DEFAULT_STUDENT_NAMES: Record<string, string> = {
  "+15550000101": "Tobi",
  "+15550000102": "Otis",
  "+15550000103": "Arden",
  "+15550000104": "Jesse",
};

function studentNamesFrom(raw: string | undefined): Record<string, string> {
  const names: Record<string, string> = { ...DEFAULT_STUDENT_NAMES };
  for (const pair of (raw ?? "").split(",")) {
    const [phone, name] = pair.split("=").map((part) => part.trim());
    if (!phone || !name) continue;
    names[normalizePhone(phone)] = name.slice(0, 40);
  }
  return names;
}

export class MockBackend implements Backend {
  private readonly users: User[];
  private readonly clubs: Club[];
  private readonly memberships: Membership[];
  private readonly friendships: Friendship[];
  private readonly contacts: Contact[];
  private readonly intros = new Map<string, Intro>();
  /** Phones that play Maya. They share her user id, so the intro remembers which handset asked. */
  private readonly mayaAliasPhones: Set<string>;
  private readonly studentsByPhone = new Map<string, User>();
  private readonly studentNames: Record<string, string>;

  constructor(env: NodeJS.ProcessEnv = {}) {
    const seed = buildSeed(env);
    this.studentNames = studentNamesFrom(env.DEMO_STUDENT_NAMES);
    this.users = seed.users;
    this.clubs = seed.clubs;
    this.memberships = seed.memberships;
    this.friendships = seed.friendships;
    this.contacts = seed.contacts;
    this.mayaAliasPhones = new Set(
      (env.DEMO_ALSO_PHONES ?? "")
        .split(",")
        .map((phone) => phone.trim())
        .filter(Boolean)
        .map((phone) => normalizePhone(phone)),
    );
    for (const club of this.clubs) this.ensureReachable(club.id);
  }

  async getUserByPhone(phone: string): Promise<User | null> {
    const normalized = normalizePhone(phone);
    const direct = this.users.find((user) => user.phone === normalized);
    const named = this.studentNames[normalized];
    if (direct && !(named && direct.id === "maya")) return direct;
    if (named) return this.ensureStudent(normalized);
    if (direct) return direct;
    if (this.mayaAliasPhones.has(normalized)) {
      return this.users.find((user) => user.id === "maya") ?? null;
    }
    return this.ensureStudent(normalized);
  }

  /**
   * A phone that is not already in the seed still gets Maya's accepted friends,
   * so the demo works from any handset. Maya's own phone stays Maya.
   * The connector lookup uses the seeded user when the phone matches one.
   */
  ensureStudent(phone: string): User {
    const normalized = normalizePhone(phone);
    const cached = this.studentsByPhone.get(normalized);
    if (cached) return cached;

    const knownName = this.studentNames[normalized];
    if (knownName) return this.studentWithMayaFriends(normalized, knownName);

    const direct = this.users.find((user) => user.phone === normalized);
    const maya = this.users.find((user) => user.id === "maya");
    if (maya && (direct?.id === "maya" || this.mayaAliasPhones.has(normalized))) {
      this.studentsByPhone.set(normalized, maya);
      return maya;
    }

    return this.studentWithMayaFriends(normalized, "the student", { classYear: 2028, college: "Pierson" });
  }

  private studentWithMayaFriends(
    phone: string,
    name: string,
    extras?: { classYear?: number; college?: string },
  ): User {
    const guest: User = {
      id: `guest_${phone.replace(/\D/g, "")}`,
      name,
      phone,
      classYear: extras?.classYear,
      college: extras?.college,
      suggestible: true,
    };
    this.users.push(guest);
    for (const friendId of this.acceptedFriends("maya")) {
      this.friendships.push({ a: guest.id, b: friendId, status: "accepted" });
    }
    this.studentsByPhone.set(phone, guest);
    return guest;
  }

  async getUser(id: string): Promise<User | null> {
    return this.users.find((user) => user.id === id) ?? null;
  }

  /** Demo REPL only. Not part of the backend contract and never sent to Grok. */
  demoUsers(): User[] {
    return this.users;
  }

  async getClub(clubId: string): Promise<Club | null> {
    return this.clubs.find((club) => club.id === clubId) ?? null;
  }

  async resolveClub(text: string): Promise<ClubMatch[]> {
    const query = normalizeClubText(text);
    if (!query) return [];

    const hits: { club: Club; confidence: ClubMatch["confidence"]; distance: number }[] = [];

    for (const club of this.clubs) {
      const name = normalizeClubText(club.name);
      const aliases = club.aliases.map((alias) => normalizeClubText(alias)).filter(Boolean);
      const labels = [name, ...aliases];

      if (labels.some((label) => label === query)) {
        hits.push({ club, confidence: "exact", distance: 0 });
        continue;
      }

      if (aliases.some((alias) => containsWholePhrase(query, alias)) || containsWholePhrase(query, name)) {
        hits.push({ club, confidence: "alias", distance: 0 });
        continue;
      }

      let best = Number.POSITIVE_INFINITY;
      for (const label of labels) {
        best = Math.min(best, normalizedLevenshtein(query, label));
      }
      const fuzzyByDistance = best <= 0.25;
      const fuzzyByTokens = tokenOverlap(query, name) || aliases.some((alias) => tokenOverlap(query, alias));
      if (fuzzyByDistance || fuzzyByTokens) {
        hits.push({ club, confidence: "fuzzy", distance: Number.isFinite(best) ? best : 1 });
      }
    }

    hits.sort((a, b) => {
      const rank = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
      if (rank !== 0) return rank;
      return a.distance - b.distance;
    });

    if (hits.length === 0) {
      const club = this.clubFromQuery(text, query);
      return [{ club, confidence: "exact" }];
    }

    return hits.slice(0, 3).map(({ club, confidence }) => ({ club, confidence }));
  }

  async findPaths(requester: User, _requesterPhone: string, clubId: string): Promise<PathSearch> {
    return { searchId: `search_${randomUUID()}`, paths: await this.rankPaths(requester.id, clubId) };
  }

  private async rankPaths(userId: string, clubId: string): Promise<PathResult[]> {
    const requester = await this.getUser(userId);
    if (!requester) return [];
    const members = new Map<string, Role>();
    for (const membership of this.memberships) {
      if (membership.clubId === clubId) members.set(membership.userId, membership.role);
    }

    const candidates: PathResult[] = [];

    for (const friendId of this.acceptedFriends(requester.id)) {
      const friend = await this.getUser(friendId);
      if (!friend || !friend.suggestible || friend.id === requester.id) continue;

      const directRole = members.get(friend.id);
      if (directRole) {
        candidates.push(
          this.scorePath({
            requester,
            connector: friend,
            target: friend,
            targetRole: directRole,
            hops: 1,
            via: "friend_in_club",
            clubId,
          }),
        );
      }

      for (const memberId of this.acceptedFriends(friend.id)) {
        if (memberId === requester.id || memberId === friend.id) continue;
        const role = members.get(memberId);
        const target = await this.getUser(memberId);
        if (!role || !target) continue;
        candidates.push(
          this.scorePath({
            requester,
            connector: friend,
            target,
            targetRole: role,
            hops: 2,
            via: "friend_of_member",
            clubId,
          }),
        );
      }

      for (const contact of this.contacts) {
        if (contact.ownerId !== friend.id || !contact.matchedUserId) continue;
        if (contact.matchedUserId === requester.id) continue;
        const role = members.get(contact.matchedUserId);
        const target = await this.getUser(contact.matchedUserId);
        if (!role || !target) continue;
        candidates.push(
          this.scorePath({
            requester,
            connector: friend,
            target,
            targetRole: role,
            hops: 2,
            via: "contact_of_member",
            clubId,
          }),
        );
      }
    }

    const bestByConnector = new Map<string, PathResult>();
    for (const path of candidates) {
      const current = bestByConnector.get(path.connector.id);
      if (!current || path.score > current.score || (path.score === current.score && path.hops < current.hops)) {
        bestByConnector.set(path.connector.id, path);
      }
    }

    return [...bestByConnector.values()].sort((a, b) => b.score - a.score).slice(0, 5);
  }

  async createIntro(input: {
    requesterId: string;
    requesterPhone?: string;
    searchId?: string;
    connectorId: string;
    clubId: string;
    message: string;
  }): Promise<Intro> {
    const connector = await this.getUser(input.connectorId);
    const intro: Intro = {
      id: `intro_${randomUUID()}`,
      requesterId: input.requesterId,
      requesterPhone: input.requesterPhone,
      connectorId: input.connectorId,
      connectorName: connector?.name,
      clubId: input.clubId,
      message: input.message,
      status: "drafted",
      createdAt: Date.now(),
    };
    this.intros.set(intro.id, intro);
    return intro;
  }

  async getIntro(id: string): Promise<Intro | null> {
    return this.intros.get(id) ?? null;
  }

  /** Every seeded connector has a phone, so the demo can always text them. */
  async getConnectorPhone(intro: Intro): Promise<string | null> {
    return (await this.getUser(intro.connectorId))?.phone ?? null;
  }

  async markIntroSent(intro: Intro): Promise<void> {
    const stored = this.intros.get(intro.id);
    if (!stored) throw new BackendError(404, `Intro ${intro.id} was not found`);
    if (stored.status === "drafted") stored.status = "sent";
  }

  async answerIntro(introId: string, _connectorPhone: string, decision: "accept" | "decline"): Promise<IntroAnswer> {
    const intro = this.intros.get(introId);
    if (!intro) throw new BackendError(404, `Intro ${introId} was not found`);
    if (intro.status !== "sent") throw new IntroAlreadyAnsweredError();
    intro.status = decision === "accept" ? "accepted" : "declined";
    const requester = await this.getUser(intro.requesterId);
    const connector = await this.getUser(intro.connectorId);
    const club = await this.getClub(intro.clubId);
    return {
      requesterPhone: intro.requesterPhone ?? requester?.phone ?? null,
      requesterName: requester?.name ?? "them",
      connectorName: connector?.name ?? "Your friend",
      clubName: club?.name ?? "the club",
    };
  }

  /** Mock users can't link a phone: every phone already plays a demo student. */
  async linkPhone(): Promise<LinkResult> {
    return { ok: false, reason: "invalid_code" };
  }

  /** Drops drafted and sent intros so the stage demo can start over. */
  resetIntros(): void {
    this.intros.clear();
  }

  /** Jordan is the 1-hop friend and Sam is the board member, for every club. */
  private ensureReachable(clubId: string): void {
    this.ensureMember(clubId, "jordan", "member");
    this.ensureMember(clubId, "sam", "board");
  }

  private ensureMember(clubId: string, userId: string, role: Role): void {
    const existing = this.memberships.find((membership) => membership.clubId === clubId && membership.userId === userId);
    if (existing) return;
    this.memberships.push({ userId, clubId, role, source: "self" });
  }

  private clubFromQuery(raw: string, query: string): Club {
    const id = `club_${query.replace(/\s+/g, "_").slice(0, 48)}`;
    const existing = this.clubs.find((club) => club.id === id);
    if (existing) return existing;
    const name = raw
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
    const club: Club = {
      id,
      name: name || "that club",
      aliases: [query],
      category: "student group",
      blurb: "A Yale student group.",
    };
    this.clubs.push(club);
    this.ensureReachable(club.id);
    return club;
  }

  private acceptedFriends(userId: string): string[] {
    const ids: string[] = [];
    for (const friendship of this.friendships) {
      if (friendship.status !== "accepted") continue;
      if (friendship.a === userId) ids.push(friendship.b);
      else if (friendship.b === userId) ids.push(friendship.a);
    }
    return ids;
  }

  private scorePath(input: {
    requester: User;
    connector: User;
    target: User;
    targetRole: Role;
    hops: 1 | 2;
    via: PathResult["via"];
    clubId: string;
  }): PathResult {
    let score = input.hops === 1 ? 100 : 50;
    const reasons = ["accepted friend"];
    if (input.targetRole === "board") {
      score += 15;
      reasons.push("board member");
    }
    if (input.via === "friend_of_member") score += 10;
    if (input.connector.college && input.connector.college === input.requester.college) {
      score += 5;
      reasons.push(`same college: ${input.connector.college}`);
    }
    if (input.connector.classYear && input.connector.classYear === input.requester.classYear) {
      score += 5;
      reasons.push(`same class year: ${input.connector.classYear}`);
    }
    const shared = this.sharedOtherClubs(input.requester.id, input.connector.id, input.clubId);
    for (const club of shared) {
      score += 5;
      reasons.push(`shared club: ${club.name}`);
    }
    return {
      hops: input.hops,
      connector: { id: input.connector.id, name: input.connector.name },
      target: { id: input.target.id, name: input.target.name, role: input.targetRole },
      via: input.via,
      score,
      reasons,
    };
  }

  private sharedOtherClubs(a: string, b: string, targetClubId: string): Club[] {
    const clubsOf = (userId: string) =>
      new Set(this.memberships.filter((membership) => membership.userId === userId).map((membership) => membership.clubId));
    const left = clubsOf(a);
    const right = clubsOf(b);
    return this.clubs.filter((club) => club.id !== targetClubId && left.has(club.id) && right.has(club.id));
  }
}

export function normalizeClubText(value: string): string {
  let text = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.startsWith("the ")) text = text.slice(4);
  return text;
}

function containsWholePhrase(text: string, phrase: string): boolean {
  if (!phrase) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(text);
}

function normalizedLevenshtein(a: string, b: string): number {
  const denom = Math.max(a.length, b.length);
  if (denom === 0) return 0;
  return levenshtein(a, b) / denom;
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dp[i]![0] = i;
  for (let j = 0; j < cols; j += 1) dp[0]![j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[a.length]![b.length]!;
}

const TOKEN_STOPWORDS = new Set(["yale", "club", "the", "of", "and", "a", "student", "group", "association", "society"]);

function tokenOverlap(a: string, b: string): boolean {
  const left = a.split(" ").filter((token) => token && !TOKEN_STOPWORDS.has(token));
  const right = new Set(b.split(" ").filter((token) => token && !TOKEN_STOPWORDS.has(token)));
  if (left.length === 0 || right.size === 0) return false;
  const shared = left.filter((token) => right.has(token));
  return shared.length > 0 && shared.length / Math.min(left.length, right.size) >= 0.5;
}
