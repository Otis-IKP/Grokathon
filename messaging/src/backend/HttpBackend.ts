import type { Backend, Club, ClubMatch, Intro, PathResult, User } from "../types";
import { BackendError } from "./Backend";

const TIMEOUT_MS = 4000;

/**
 * Talks to Otis's API. A 404 on a single-resource GET becomes null.
 * Every other non-2xx throws BackendError. Each call aborts after 4 seconds.
 */
export class HttpBackend implements Backend {
  constructor(private readonly baseUrl: string) {}

  getUserByPhone(phone: string): Promise<User | null> {
    return this.getOrNull<User>(`/users/by-phone/${encodeURIComponent(phone)}`);
  }

  getUser(id: string): Promise<User | null> {
    return this.getOrNull<User>(`/users/${encodeURIComponent(id)}`);
  }

  getUserPhone(id: string): Promise<string | null> {
    return this.getOrNull<{ phone: string }>(`/users/${encodeURIComponent(id)}/phone`).then((row) => row?.phone ?? null);
  }

  resolveClub(text: string): Promise<ClubMatch[]> {
    return this.send<ClubMatch[]>(`/clubs/resolve?q=${encodeURIComponent(text)}`);
  }

  getClub(clubId: string): Promise<Club | null> {
    return this.getOrNull<Club>(`/clubs/${encodeURIComponent(clubId)}`);
  }

  findPaths(userId: string, clubId: string): Promise<PathResult[]> {
    const query = new URLSearchParams({ userId, clubId });
    return this.send<PathResult[]>(`/paths?${query.toString()}`);
  }

  createIntro(input: Omit<Intro, "id" | "status" | "createdAt">): Promise<Intro> {
    return this.send<Intro>("/intros", { method: "POST", body: input });
  }

  updateIntroStatus(id: string, status: Intro["status"]): Promise<Intro> {
    return this.send<Intro>(`/intros/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { status },
    });
  }

  getIntro(id: string): Promise<Intro | null> {
    return this.getOrNull<Intro>(`/intros/${encodeURIComponent(id)}`);
  }

  async findLatestSentIntroByConnector(connectorId: string): Promise<Intro | null> {
    const query = new URLSearchParams({ connectorId, status: "sent" });
    const intros = await this.send<Intro[]>(`/intros?${query.toString()}`);
    return intros.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  }

  private async getOrNull<T>(path: string): Promise<T | null> {
    const response = await this.request(path);
    if (response.status === 404) return null;
    if (!response.ok) throw await this.toError(response);
    return (await response.json()) as T;
  }

  private async send<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const response = await this.request(path, init);
    if (!response.ok) throw await this.toError(response);
    return (await response.json()) as T;
  }

  private async request(path: string, init?: { method?: string; body?: unknown }): Promise<Response> {
    const headers: Record<string, string> = {};
    if (init?.body !== undefined) headers["Content-Type"] = "application/json";
    try {
      return await fetch(this.url(path), {
        method: init?.method ?? "GET",
        headers,
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "backend request failed";
      throw new BackendError(0, message);
    }
  }

  private async toError(response: Response): Promise<BackendError> {
    const text = await response.text();
    return new BackendError(response.status, text.slice(0, 300) || `backend returned ${response.status}`);
  }

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }
}
