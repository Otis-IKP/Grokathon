/** `alum` only comes from the app; the mock graph has current members and board. */
export type Role = "member" | "board" | "alum";

export interface User {
  /** Mock: a seed id such as "maya". HTTP: the person's NetID. */
  id: string;
  name: string;
  phone: string;
  classYear?: number;
  college?: string;
  suggestible: boolean;
}

export interface Club {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  blurb?: string;
}

export interface Membership {
  userId: string;
  clubId: string;
  role: Role;
  source: "self" | "public_roster";
}

export interface Friendship {
  a: string;
  b: string;
  status: "pending" | "accepted";
}

export interface Contact {
  ownerId: string;
  phoneHash: string;
  matchedUserId?: string;
}

export interface PathResult {
  hops: 1 | 2;
  connector: { id: string; name: string };
  target?: { id: string; name: string; role: Role };
  via: "friend_in_club" | "friend_of_member" | "contact_of_member" | "shared_club";
  score: number;
  reasons: string[];
}

/** One saved path search. The HTTP backend needs `searchId` to create an intro. */
export interface PathSearch {
  searchId: string;
  paths: PathResult[];
  /** Why there are no paths, when the backend knows (no_friends, no_connection, ...). */
  emptyReason?: string | null;
  /** True when the backend is still researching and more paths may appear later. */
  pendingResearch?: boolean;
}

export interface Intro {
  id: string;
  requesterId: string;
  connectorId: string;
  connectorName?: string;
  clubId: string;
  message: string;
  status: "drafted" | "sent" | "accepted" | "declined" | "completed" | "cancelled";
  createdAt: number;
  /** Phone that asked for this intro. Never sent to the model. */
  requesterPhone?: string;
  /** Where the connector can answer in the NEPO app, when the backend has one. */
  responseUrl?: string;
}

export interface ClubMatch {
  club: Club;
  confidence: "exact" | "alias" | "fuzzy";
}

export type LinkResult = { ok: true; user: User } | { ok: false; reason: "invalid_code" | "code_expired" };

/** What the bot needs to tell the requester after a connector answers by text. */
export interface IntroAnswer {
  /** Null when the requester has no linked phone; then there is nobody to text. */
  requesterPhone: string | null;
  requesterName: string;
  connectorName: string;
  clubName: string;
}

export class IntroAlreadyAnsweredError extends Error {
  constructor() {
    super("This intro has already been answered.");
    this.name = "IntroAlreadyAnsweredError";
  }
}

export interface Backend {
  getUserByPhone(phone: string): Promise<User | null>;
  /** Link a phone to the account that created this 6-digit code in the app. */
  linkPhone(phone: string, code: string): Promise<LinkResult>;
  resolveClub(text: string): Promise<ClubMatch[]>;
  getClub(clubId: string): Promise<Club | null>;
  findPaths(requester: User, requesterPhone: string, clubId: string): Promise<PathSearch>;
  createIntro(input: {
    requesterId: string;
    requesterPhone: string;
    searchId: string;
    connectorId: string;
    clubId: string;
    message: string;
  }): Promise<Intro>;
  /**
   * An intro the requester owns. `requesterPhone` proves ownership to the HTTP backend;
   * without it, only intros this process created are found.
   */
  getIntro(id: string, requesterPhone?: string): Promise<Intro | null>;
  /**
   * The connector's phone, only when they linked it themselves. Internal: never
   * returned to the model. Null means the student has to send the intro themselves.
   */
  getConnectorPhone(intro: Intro): Promise<string | null>;
  markIntroSent(intro: Intro): Promise<void>;
  /** The connector answered by text. Throws IntroAlreadyAnsweredError if it was answered already. */
  answerIntro(introId: string, connectorPhone: string, decision: "accept" | "decline"): Promise<IntroAnswer>;
}
