import { z } from "zod";
import type { Db } from "@/server/db/client";
import { runAgent } from "@/server/claude/runAgent";
import { loadPrompt, tag } from "./shared";

export const rosterSchema = z.object({
  roster_url: z.string().nullable(),
  as_of: z.string().nullable().describe('Academic year the list is from, e.g. "2025-2026"; null if unknown'),
  members: z.array(
    z.object({
      full_name: z.string().min(1),
      role_title: z.string().nullable(),
      is_board: z.boolean(),
      class_year: z.number().int().nullable(),
      college: z.string().nullable(),
      quote: z.string(),
    }),
  ),
  website: z.string().nullable(),
  notes: z.string(),
});
export type RosterOutput = z.infer<typeof rosterSchema>;

/** One club → its public member list. */
export async function runRosterCrawler(
  db: Db,
  input: { clubName: string; aliases: string[]; website: string | null; slug: string },
  ctx: { jobId?: string } = {},
) {
  return runAgent(
    db,
    {
      name: "rosterCrawler",
      system: loadPrompt("rosterCrawler"),
      user: [
        tag("club_name", input.clubName),
        tag("club_aliases", input.aliases.join(", ") || "none"),
        tag("club_website", input.website),
      ].join("\n"),
      webSearch: true,
      submit: {
        name: "submit_roster",
        description: "Return the public roster found for this club, or an empty list when none is published.",
        schema: rosterSchema,
      },
      fixtureKey: input.slug,
    },
    ctx,
  );
}
