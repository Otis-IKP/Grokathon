import type { Backend, Club, ClubMatch, Intro, IntroAnswer, LinkResult, PathResult, PathSearch, Role, User } from "../types";
import { IntroAlreadyAnsweredError } from "../types";
import { BackendError } from "./Backend";
import type { PhoneState, StateStore } from "../state/store";

const TIMEOUT_MS = 10_000;

/** Shapes returned by the NEPO app's Bot API (src/app/api/bot in the app). */
type PersonCard = {
  netid: string;
  name: string;
  first_name: string;
  college: string | null;
  year: number | null;
  is_user: boolean;
};
type ClubCard = { id: string; slug: string; name: string; short_name: string | null; category: string | null };
type AppPathResult = {
  score: number;
  hops: 1 | 2;
  connector: PersonCard;
  link:
    | { type: "member"; role: string; title: string | null }
    | { type: "knows_member"; via: "friend" | "shared_club"; shared_club?: string };
  target: { person: PersonCard; role: string; title: string | null } | null;
  why: string;
};
type AppIntro = {
  intro_id: string;
  status: Intro["status"];
  message: string;
  club: ClubCard;
  connector: PersonCard;
  created_at: string;
  response_url: string | null;
};
type ErrorBody = { error?: { code?: string; message?: string } };

/**
 * Talks to the NEPO app's Bot API. Every call sends `Authorization: Bearer {secret}`
 * and identifies the texter by phone; the app never accepts a user id from the bot.
 * The /d/:introId link carries the requester's phone (encrypted), so it works on
 * any instance; intros this process created are also cached as a fallback for
 * a link without one.
 */
export class HttpBackend implements Backend, StateStore {
  private readonly created = new Map<string, Intro>();

  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
  ) {}

  /** Per-phone bot state is kept in the app's database (POST /api/bot/state/*), never in a URL. */
  async loadState(phone: string): Promise<PhoneState | null> {
    const body = await this.post<{ state: PhoneState | null }>("/api/bot/state/get", { phone });
    return body.state;
  }

  async saveState(phone: string, state: PhoneState | null): Promise<void> {
    await this.post("/api/bot/state/put", { phone, state });
  }

  async claim(key: string): Promise<boolean> {
    const body = await this.post<{ claimed: boolean }>("/api/bot/state/claim", { key });
    return body.claimed;
  }

  async release(key: string): Promise<void> {
    await this.post("/api/bot/state/claim", { key, release: true });
  }

  async getUserByPhone(phone: string): Promise<User | null> {
    try {
      const body = await this.post<{ user: PersonCard }>("/api/bot/whoami", { phone });
      return toUser(body.user, phone);
    } catch (error) {
      if (error instanceof BackendError && error.code === "user_not_linked") return null;
      throw error;
    }
  }

  async linkPhone(phone: string, code: string): Promise<LinkResult> {
    try {
      const body = await this.post<{ user: PersonCard }>("/api/bot/link-phone", { phone, code });
      return { ok: true, user: toUser(body.user, phone) };
    } catch (error) {
      if (error instanceof BackendError && (error.code === "invalid_code" || error.code === "code_expired")) {
        return { ok: false, reason: error.code };
      }
      throw error;
    }
  }

  async resolveClub(text: string): Promise<ClubMatch[]> {
    const body = await this.post<{ club: ClubCard | null; candidates: ClubCard[]; confidence: number }>(
      "/api/bot/resolve-club",
      { text: text.slice(0, 120) },
    );
    if (body.club) return [{ club: toClub(body.club), confidence: body.confidence >= 1 ? "exact" : "alias" }];
    return body.candidates.map((club) => ({ club: toClub(club), confidence: "fuzzy" as const }));
  }

  async getClub(clubId: string): Promise<Club | null> {
    try {
      const body = await this.post<{ club: ClubCard; description: string | null }>("/api/bot/club", { club_id: clubId });
      return { ...toClub(body.club), blurb: body.description ?? undefined };
    } catch (error) {
      if (error instanceof BackendError && (error.code === "club_not_found" || error.status === 400)) return null;
      throw error;
    }
  }

  async findPaths(_requester: User, requesterPhone: string, clubId: string): Promise<PathSearch> {
    const body = await this.post<{
      search_id: string;
      results: AppPathResult[];
      pending_research: boolean;
      empty_reason: string | null;
    }>("/api/bot/find-paths", { phone: requesterPhone, club_id: clubId, limit: 5 });
    return {
      searchId: body.search_id,
      paths: body.results.map(toPath),
      emptyReason: body.empty_reason,
      pendingResearch: body.pending_research,
    };
  }

  async createIntro(input: {
    requesterId: string;
    requesterPhone: string;
    searchId: string;
    connectorId: string;
    clubId: string;
    message: string;
  }): Promise<Intro> {
    const body = await this.post<{ intro_id: string; response_url: string | null }>("/api/bot/intros", {
      phone: input.requesterPhone,
      search_id: input.searchId,
      connector_netid: input.connectorId,
      message: input.message,
    });
    const intro: Intro = {
      id: body.intro_id,
      requesterId: input.requesterId,
      requesterPhone: input.requesterPhone,
      connectorId: input.connectorId,
      clubId: input.clubId,
      message: input.message,
      status: "drafted",
      createdAt: Date.now(),
      responseUrl: body.response_url ?? undefined,
    };
    this.created.set(intro.id, intro);
    return intro;
  }

  async getIntro(id: string, requesterPhone?: string): Promise<Intro | null> {
    const phone = requesterPhone ?? this.created.get(id)?.requesterPhone;
    if (!phone) return null;
    try {
      // The phone goes in the body: a query string would put it in the app's access logs.
      const body = await this.post<{ intro: AppIntro }>(`/api/bot/intros/${encodeURIComponent(id)}/read`, { phone });
      const intro = toIntro(body.intro, phone);
      this.created.set(intro.id, intro);
      return intro;
    } catch (error) {
      if (error instanceof BackendError && error.status === 404) return null;
      throw error;
    }
  }

  async getConnectorPhone(intro: Intro): Promise<string | null> {
    if (!intro.requesterPhone) return null;
    const body = await this.post<{ phone: string | null }>(
      `/api/bot/intros/${encodeURIComponent(intro.id)}/connector-phone`,
      { phone: intro.requesterPhone },
    );
    return body.phone;
  }

  async markIntroSent(intro: Intro): Promise<void> {
    if (!intro.requesterPhone) throw new BackendError(400, "intro has no requester phone");
    await this.post(`/api/bot/intros/${encodeURIComponent(intro.id)}/sent`, { phone: intro.requesterPhone });
  }

  async answerIntro(introId: string, connectorPhone: string, decision: "accept" | "decline"): Promise<IntroAnswer> {
    try {
      const body = await this.post<{
        requester_phone: string | null;
        requester_name: string;
        connector_first_name: string;
        club_name: string;
      }>(`/api/bot/intros/${encodeURIComponent(introId)}/respond`, { phone: connectorPhone, decision });
      return {
        requesterPhone: body.requester_phone,
        requesterName: body.requester_name,
        connectorName: body.connector_first_name,
        clubName: body.club_name,
      };
    } catch (error) {
      if (error instanceof BackendError && error.code === "invalid_state") throw new IntroAlreadyAnsweredError();
      throw error;
    }
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  private post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", body });
  }

  private async request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.secret}` };
    if (init?.body !== undefined) headers["Content-Type"] = "application/json";
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}${path}`, {
        method: init?.method ?? "GET",
        headers,
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "backend request failed";
      throw new BackendError(0, message);
    }
    if (!response.ok) {
      const text = await response.text();
      let code: string | undefined;
      let message = text.slice(0, 300) || `backend returned ${response.status}`;
      try {
        const parsed = JSON.parse(text) as ErrorBody;
        code = parsed.error?.code;
        message = parsed.error?.message ?? message;
      } catch {
        // not JSON
      }
      throw new BackendError(response.status, message, code);
    }
    return (await response.json()) as T;
  }
}

function toUser(card: PersonCard, phone: string): User {
  return {
    id: card.netid,
    name: card.name,
    phone,
    classYear: card.year ?? undefined,
    college: card.college ?? undefined,
    suggestible: true,
  };
}

function toClub(card: ClubCard): Club {
  return {
    id: card.id,
    name: card.name,
    aliases: card.short_name ? [card.short_name] : [],
    category: card.category ?? "student group",
  };
}

/** Alumni are passed through as alumni, so the model does not call a former member a current one. */
function toRole(role: string): Role {
  if (role === "board" || role === "alum") return role;
  return "member";
}

function toPath(result: AppPathResult): PathResult {
  const connector = { id: result.connector.netid, name: result.connector.name };
  if (result.link.type === "member") {
    return {
      hops: result.hops,
      connector,
      target: { ...connector, role: toRole(result.link.role) },
      via: "friend_in_club",
      score: result.score,
      reasons: [result.why],
    };
  }
  return {
    hops: result.hops,
    connector,
    target: result.target
      ? { id: result.target.person.netid, name: result.target.person.name, role: toRole(result.target.role) }
      : undefined,
    via: result.link.via === "shared_club" ? "shared_club" : "friend_of_member",
    score: result.score,
    reasons: [result.why],
  };
}

function toIntro(intro: AppIntro, requesterPhone: string): Intro {
  return {
    id: intro.intro_id,
    requesterId: "",
    requesterPhone,
    connectorId: intro.connector.netid,
    connectorName: intro.connector.name,
    clubId: intro.club.id,
    message: intro.message,
    status: intro.status,
    createdAt: Date.parse(intro.created_at),
    responseUrl: intro.response_url ?? undefined,
  };
}
