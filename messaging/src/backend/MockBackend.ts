import { randomUUID } from "node:crypto";
import type {
  Backend,
  Club,
  ClubMatch,
  Contact,
  Friendship,
  Intro,
  Membership,
  PathResult,
  Role,
  User,
} from "../types";
import { BackendError } from "./Backend";
import { buildSeed } from "./seed";
import { normalizePhone } from "../util/phone";

const CONFIDENCE_RANK = { exact: 0, alias: 1, fuzzy: 2 } as const;

export class MockBackend implements Backend {
  private readonly users: User[];
  private readonly clubs: Club[];
  private readonly memberships: Membership[];
  private readonly friendships: Friendship[];
  private readonly contacts: Contact[];
  private readonly intros = new Map<string, Intro>();
  /** Extra real phones that should get Maya's demo graph when they text in. */
  private readonly mayaAliasPhones: Set<string>;

  constructor(env: NodeJS.ProcessEnv = {}) {
    const seed = buildSeed(env);
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
  }

  async getUserByPhone(phone: string): Promise<User | null> {
    const normalized = normalizePhone(phone);
    const direct = this.users.find((user) => user.phone === normalized);
    if (direct) return direct;
    if (this.mayaAliasPhones.has(normalized)) {
      return this.users.find((user) => user.id === "maya") ?? null;
    }
    return null;
  }

  async getUser(id: string): Promise<User | null> {
    return this.users.find((user) => user.id === id) ?? null;
  }

  /** Demo REPL only. Not part of the backend contract and never sent to Grok. */
  demoUsers(): User[] {
    return this.users;
  }

  async getUserPhone(id: string): Promise<string | null> {
    return (await this.getUser(id))?.phone ?? null;
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

    return hits.slice(0, 3).map(({ club, confidence }) => ({ club, confidence }));
  }

  async findPaths(userId: string, clubId: string): Promise<PathResult[]> {
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

  async createIntro(input: Omit<Intro, "id" | "status" | "createdAt">): Promise<Intro> {
    const intro: Intro = {
      ...input,
      id: `intro_${randomUUID()}`,
      status: "drafted",
      createdAt: Date.now(),
    };
    this.intros.set(intro.id, intro);
    return intro;
  }

  async updateIntroStatus(id: string, status: Intro["status"]): Promise<Intro> {
    const intro = this.intros.get(id);
    if (!intro) throw new BackendError(404, `Intro ${id} was not found`);
    intro.status = status;
    return intro;
  }

  async getIntro(id: string): Promise<Intro | null> {
    return this.intros.get(id) ?? null;
  }

  /** Drops drafted and sent intros so the stage demo can start over. */
  resetIntros(): void {
    this.intros.clear();
  }

  async findLatestSentIntroByConnector(connectorId: string): Promise<Intro | null> {
    let latest: Intro | null = null;
    for (const intro of this.intros.values()) {
      if (intro.connectorId !== connectorId || intro.status !== "sent") continue;
      if (!latest || intro.createdAt > latest.createdAt) latest = intro;
    }
    return latest;
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
