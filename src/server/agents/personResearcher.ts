import { z } from "zod";
import type { Db } from "@/server/db/client";
import { runAgent } from "@/server/xai/runAgent";
import { affiliationSchema, loadPrompt, tag } from "./shared";

export const personResearchSchema = z.object({
  linkedin_url: z.string().nullable(),
  affiliations: z.array(affiliationSchema),
  evidence: z.array(z.object({ org_name: z.string(), url: z.string(), quote: z.string() })),
});
export type PersonResearchOutput = z.infer<typeof personResearchSchema>;

/**
 * One directory person → their public club affiliations. The agent is given
 * only name, college, year and major; never contact details.
 */
export async function runPersonResearcher(
  db: Db,
  input: {
    netid: string;
    name: string;
    college: string | null;
    year: number | null;
    major: string | null;
    knownClubs: string[];
  },
  ctx: { jobId?: string } = {},
) {
  return runAgent(
    db,
    {
      name: "personResearcher",
      system: loadPrompt("personResearcher"),
      user: [
        tag("student_name", input.name),
        tag("residential_college", input.college),
        tag("class_year", input.year),
        tag("major", input.major),
        tag("known_clubs", input.knownClubs.join("; ")),
      ].join("\n"),
      webSearch: true,
      submit: {
        name: "submit_affiliations",
        description: "Return the Yale student organisations this student publicly belongs to, with evidence.",
        schema: personResearchSchema,
      },
      fixtureKey: input.netid,
    },
    ctx,
  );
}
