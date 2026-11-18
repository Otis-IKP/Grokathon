import { z } from "zod";
import type { Db } from "@/server/db/client";
import { env } from "@/server/env";
import { hashedPlaceholder } from "@/server/privacy/redact";
import { runAgent } from "@/server/claude/runAgent";
import { affiliationSchema, loadPrompt, tag } from "./shared";

export const profileExtractorOutput = z.object({
  profile_name: z.string().describe("The name at the top of the profile, exactly as written"),
  affiliations: z.array(affiliationSchema),
});
export type ProfileExtractorOutput = z.infer<typeof profileExtractorOutput>;

const MAX_CHARS = 40_000;

/** LinkedIn PDF text → affiliations. No web search, fast model. The text is never logged. */
export async function runProfileExtractor(
  db: Db,
  input: { text: string; name: string; year: number | null; netid: string },
  ctx: { jobId?: string } = {},
) {
  const text = input.text.slice(0, MAX_CHARS);
  return runAgent(
    db,
    {
      name: "profileExtractor",
      model: env().CLAUDE_MODEL_FAST_RESOLVED,
      system: loadPrompt("profileExtractor"),
      user: [tag("student_name", input.name), tag("class_year", input.year), `<source>\n${tag("profile_text", text)}\n</source>`].join(
        "\n",
      ),
      webSearch: false,
      submit: {
        name: "submit_profile",
        description: "Return the profile name and every affiliation found in the profile text.",
        schema: profileExtractorOutput,
      },
      // Privacy rule 11: agent_runs stores a hash of the PDF text, not the text.
      logInput: { name: input.name, class_year: input.year, text: hashedPlaceholder(input.text) },
      fixtureKey: input.netid,
    },
    ctx,
  );
}
