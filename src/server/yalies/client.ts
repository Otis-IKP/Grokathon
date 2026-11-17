import fs from "node:fs";
import path from "node:path";
import { AppError } from "@/lib/errors";
import { env } from "@/server/env";
import { yaliesPersonSchema, type YaliesPerson, type YaliesQuery } from "./types";

/**
 * The only module that calls Yalies (section 6.2): bearer header, 10 s timeout,
 * one retry on 5xx or network error, and MOCK_EXTERNAL.
 */

let loggedRawSample = false;

function parsePeople(raw: unknown): YaliesPerson[] {
  if (!Array.isArray(raw)) {
    throw new AppError("upstream_error", "Yalies returned an unexpected response.");
  }
  const people: YaliesPerson[] = [];
  for (const item of raw) {
    const parsed = yaliesPersonSchema.safeParse(item);
    // A record without a NetID (some staff entries) cannot be a NEPO person.
    if (parsed.success) people.push(parsed.data);
  }
  return people;
}

function loadFixturePeople(): unknown[] {
  const file = path.join(process.cwd(), "tests/fixtures/yalies/people.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as unknown[];
}

function mockSearch(q: YaliesQuery): YaliesPerson[] {
  const all = parsePeople(loadFixturePeople());
  const tokens = (q.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = all.filter((p) => {
    for (const [field, accepted] of Object.entries(q.filters ?? {})) {
      const value = (p as Record<string, unknown>)[field];
      if (!accepted.map(String).includes(String(value))) return false;
    }
    if (tokens.length === 0) return true;
    const hay = `${p.first_name ?? ""} ${p.preferred_name ?? ""} ${p.last_name ?? ""} ${p.netid}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
  // Pages are 0-based, per the Yalies wiki ("page: the start index of the page", default 0).
  const size = q.page_size ?? 100;
  const page = q.page ?? 0;
  return filtered.slice(page * size, (page + 1) * size);
}

async function post(body: YaliesQuery): Promise<Response> {
  const e = env();
  if (!e.YALIES_API_KEY) {
    throw new AppError("upstream_error", "YALIES_API_KEY is not set. Set it, or run with MOCK_EXTERNAL=1.");
  }
  return fetch(`${e.YALIES_BASE_URL}/people`, {
    method: "POST",
    headers: { Authorization: `Bearer ${e.YALIES_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
}

export async function yaliesPeople(q: YaliesQuery): Promise<YaliesPerson[]> {
  if (!q.query && !q.filters) throw new Error("Yalies needs a query or a filter.");
  if (env().MOCK_EXTERNAL) return mockSearch(q);

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await post(q);
      if (res.status >= 500) {
        lastError = new Error(`Yalies responded ${res.status}`);
        continue;
      }
      if (!res.ok) {
        throw new AppError("upstream_error", `Yalies rejected the request (${res.status}).`);
      }
      const raw = (await res.json()) as unknown;
      if (!loggedRawSample && env().NODE_ENV !== "production" && Array.isArray(raw) && raw[0]) {
        // Section 6.2: confirm field names on first real contact. Keys only, never values.
        loggedRawSample = true;
        console.info("[yalies] first response field names:", Object.keys(raw[0] as object).join(", "));
      }
      return parsePeople(raw);
    } catch (err) {
      if (err instanceof AppError) throw err;
      lastError = err;
    }
  }
  const reason = lastError instanceof Error ? lastError.message : "network error";
  throw new AppError("upstream_error", `Could not reach the Yale directory (${reason}).`);
}

export async function yaliesLookup(netid: string): Promise<YaliesPerson | null> {
  const people = await yaliesPeople({ filters: { netid: [netid.toLowerCase()] } });
  return people.find((p) => p.netid === netid.toLowerCase()) ?? null;
}
