import type { Db, Tx } from "@/server/db/client";
import { clubAliases } from "@/server/db/schema";

/**
 * Normal form used for matching (section 7.5): lowercase, strip punctuation,
 * drop a leading "the", collapse whitespace, drop a leading "yale".
 */
export function normalizeClubName(text: string): string {
  let s = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/^the /, "");
  const withoutYale = s.replace(/^yale /, "");
  // "Yale" alone must not normalise to the empty string.
  if (withoutYale) s = withoutYale;
  return s.replace(/^the /, "").trim();
}

export function slugify(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "club"
  );
}

/** Add aliases for a club, skipping any whose normal form is already taken. */
export async function addAliases(db: Db | Tx, clubId: string, aliases: string[]): Promise<void> {
  const seen = new Set<string>();
  for (const alias of aliases) {
    const aliasNorm = normalizeClubName(alias);
    if (!aliasNorm || seen.has(aliasNorm)) continue;
    seen.add(aliasNorm);
    await db.insert(clubAliases).values({ clubId, alias: alias.trim(), aliasNorm }).onConflictDoNothing();
  }
}
