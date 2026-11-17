import { z } from "zod";
import type { Db } from "@/server/db/client";
import { runAgent } from "@/server/xai/runAgent";
import { affiliationSchema, loadPrompt, tag } from "./shared";

export const profileReaderOutput = z.object({
  readable: z.boolean().describe("false when the experience section could not be seen"),
  reason: z.string().nullable().describe("Why the profile could not be read, or null"),
  identity_match: z.enum(["yes", "no", "unsure"]),
  affiliations: z.array(affiliationSchema),
});
export type ProfileReaderOutput = z.infer<typeof profileReaderOutput>;

/** LinkedIn URL → affiliations, from the public page only. */
export async function runProfileReader(
  db: Db,
  input: { url: string; name: string; college: string | null; year: number | null; netid: string },
  ctx: { jobId?: string } = {},
) {
  return runAgent(
    db,
    {
      name: "profileReader",
      system: loadPrompt("profileReader"),
      user: [
        tag("linkedin_url", input.url),
        tag("student_name", input.name),
        tag("residential_college", input.college),
        tag("class_year", input.year),
      ].join("\n"),
      webSearch: true,
      submit: {
        name: "submit_profile",
        description: "Report whether the public profile was readable and the affiliations it shows.",
        schema: profileReaderOutput,
      },
      fixtureKey: input.netid,
    },
    ctx,
  );
}
