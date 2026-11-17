import { AppError } from "./errors";

type Bucket = { hits: number[] };
const globalForRl = globalThis as unknown as { __nepoRl?: Map<string, Bucket> };
const buckets = (globalForRl.__nepoRl ??= new Map<string, Bucket>());

/**
 * Sliding-window limiter held in process memory. Good enough for one server
 * or a hackathon deploy; swap for a shared store before scaling out.
 */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): void {
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket);
    throw new AppError("rate_limited", "Too many requests. Try again in a moment.");
  }
  bucket.hits.push(now);
  buckets.set(key, bucket);
}

export function resetRateLimits() {
  buckets.clear();
}
