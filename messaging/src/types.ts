export type Role = "member" | "board";

export interface User {
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
  via: "friend_in_club" | "friend_of_member" | "contact_of_member";
  score: number;
  reasons: string[];
}

export interface Intro {
  id: string;
  requesterId: string;
  connectorId: string;
  clubId: string;
  message: string;
  status: "drafted" | "sent" | "accepted" | "declined";
  createdAt: number;
  /** Phone that asked for this intro. Set for alias phones that share Maya's user id. */
  requesterPhone?: string;
}

export interface ClubMatch {
  club: Club;
  confidence: "exact" | "alias" | "fuzzy";
}

export interface Backend {
  getUserByPhone(phone: string): Promise<User | null>;
  resolveClub(text: string): Promise<ClubMatch[]>;
  getClub(clubId: string): Promise<Club | null>;
  findPaths(userId: string, clubId: string): Promise<PathResult[]>;
  createIntro(i: Omit<Intro, "id" | "status" | "createdAt">): Promise<Intro>;
  updateIntroStatus(id: string, status: Intro["status"]): Promise<Intro>;
  getIntro(id: string): Promise<Intro | null>;
  getUser(id: string): Promise<User | null>;
  /** Internal. Used by send_intro, never returned to Grok. */
  getUserPhone(id: string): Promise<string | null>;
  /**
   * Latest intro this connector has been asked to make and has not answered.
   * The HTTP backend uses GET /intros?connectorId=&status=sent.
   */
  findLatestSentIntroByConnector(connectorId: string): Promise<Intro | null>;
}
