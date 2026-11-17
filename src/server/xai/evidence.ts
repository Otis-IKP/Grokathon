/**
 * Evidence integrity (section 7.3, step 5): an evidence URL the agent reports
 * counts only if the same page appears in the citations xAI returned for that
 * run. This is the main defence against invented sources.
 */

export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !/^(utm_|fbclid|gclid|ref$)/i.test(k))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    return `${host}${path}${params ? `?${params}` : ""}`.toLowerCase();
  } catch {
    return null;
  }
}

export function isCited(url: string, citations: string[]): boolean {
  const norm = normalizeUrl(url);
  if (!norm) return false;
  return citations.some((c) => normalizeUrl(c) === norm);
}

/** Keep only the evidence items whose URL the run actually cited. */
export function filterCited<T extends { url: string }>(evidence: T[], citations: string[]): T[] {
  return evidence.filter((e) => isCited(e.url, citations));
}

export type SourceType = "club_site" | "yale_connect" | "campus_news" | "linkedin" | "other";

const CAMPUS_NEWS_HOSTS = [
  "yaledailynews.com",
  "yaleherald.com",
  "thepolitic.org",
  "news.yale.edu",
  "yalealumnimagazine.org",
  "yalescientific.org",
  "yalerecord.org",
];

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Classify an evidence URL by who controls the page. The agent's own label is
 * not trusted for this: the host decides.
 */
export function classifySource(url: string, clubWebsite?: string | null): SourceType {
  const host = hostOf(url);
  if (!host) return "other";
  const clubHost = hostOf(clubWebsite);
  if (clubHost && (host === clubHost || host.endsWith(`.${clubHost}`))) return "club_site";
  if (host === "yaleconnect.yale.edu") return "yale_connect";
  if (host.endsWith("linkedin.com")) return "linkedin";
  if (CAMPUS_NEWS_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return "campus_news";
  // Student organisation sites hosted by Yale.
  if (host.endsWith(".yale.edu") || host === "yale.edu") return "club_site";
  return "other";
}

/** Sources strong enough to mark a membership verified: controlled by the club or Yale, or campus news. */
export function isStrongSource(type: SourceType): boolean {
  return type === "club_site" || type === "yale_connect" || type === "campus_news";
}
