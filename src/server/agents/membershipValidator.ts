import { z } from "zod";
import type { Db } from "@/server/db/client";
import { runAgent } from "@/server/claude/runAgent";
import { loadPrompt, tag } from "./shared";

export const verdictSchema = z.object({
  verdict: z.enum(["confirmed", "likely", "not_found", "contradicted"]),
  confidence: z.number().min(0).max(1),
  role_found: z.string().nullable(),
  is_board: z.boolean().nullable(),
  evidence: z.array(
    z.object({
      url: z.string(),
      quote: z.string(),
      source_type: z.enum(["club_site", "yale_connect", "campus_news", "linkedin", "other"]),
    }),
  ),
  reasoning: z.string().describe("Two or three sentences"),
});
export type ValidatorVerdict = z.infer<typeof verdictSchema>;

export type ClaimInput = {
  personName: string;
  college: string | null;
  year: number | null;
  clubName: string;
  clubAliases: string[];
  clubWebsite: string | null;
  claimedRole: string | null;
  claimedYears: string | null;
  claimSource: string;
  fixtureKey?: string;
};

/** One claim → verdict + evidence. */
export async function runMembershipValidator(db: Db, input: ClaimInput, ctx: { jobId?: string } = {}) {
  return runAgent(
    db,
    {
      name: "membershipValidator",
      system: loadPrompt("membershipValidator"),
      user: [
        tag("student_name", input.personName),
        tag("residential_college", input.college),
        tag("class_year", input.year),
        tag("club_name", input.clubName),
        tag("club_aliases", input.clubAliases.join(", ") || "none"),
        tag("club_website", input.clubWebsite),
        tag("claimed_role", input.claimedRole),
        tag("claimed_years", input.claimedYears),
        tag("claim_source", input.claimSource),
      ].join("\n"),
      webSearch: true,
      submit: {
        name: "submit_verdict",
        description: "Report the verdict on this membership claim with the evidence found.",
        schema: verdictSchema,
      },
      fixtureKey: input.fixtureKey,
    },
    ctx,
  );
}
