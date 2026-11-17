import { z } from "zod";
import type { Db } from "@/server/db/client";
import { env } from "@/server/env";
import { runAgent } from "@/server/xai/runAgent";
import { loadPrompt, tag } from "./shared";

export type IntroTone = "casual" | "polite";

export type IntroDraftInput = {
  requesterFirstName: string;
  connectorFirstName: string;
  clubName: string;
  clubShort: string;
  link:
    | { kind: "member" | "board"; title: string | null }
    | {
        kind: "knows_member";
        memberFirstName: string;
        memberTitle: string | null;
        via: "friend" | "shared_club";
        sharedClub: string | null;
      };
  sameCollege: boolean;
  sameYear: boolean;
  tone: IntroTone;
  note?: string;
};

const schema = z.object({ message: z.string().min(1).max(600) });

/** Deterministic draft used only with MOCK_EXTERNAL=1, so the demo reads right without a key. */
export function templateDraft(i: IntroDraftInput): string {
  const club = i.clubShort;
  const note = i.note?.trim() ? ` ${i.note.trim().replace(/\s+/g, " ")}` : "";
  if (i.link.kind === "knows_member") {
    const m = i.link.memberFirstName;
    return i.tone === "polite"
      ? `Hi ${i.connectorFirstName}, I'm hoping to join ${club} and I think you know ${m}. Would you be open to introducing us?${note} Completely fine if not.`
      : `hey ${i.connectorFirstName}, i'm trying to get into ${club} and saw you know ${m}. any chance you could intro us?${note} no worries if not`;
  }
  return i.tone === "polite"
    ? `Hi ${i.connectorFirstName}, I'm hoping to join ${club} this year. Would you have ten minutes to tell me how recruiting works?${note} Completely fine if you're busy.`
    : `hey ${i.connectorFirstName}, i'm thinking about going for ${club}. could i ask you a couple things about how recruiting works?${note} no worries if you're slammed`;
}

/** Runs inline (no job): no web search, fast model. */
export async function draftIntroMessage(db: Db, input: IntroDraftInput): Promise<string> {
  const link =
    input.link.kind === "knows_member"
      ? `${input.connectorFirstName} is not in the club but knows ${input.link.memberFirstName}, who is ${
          input.link.memberTitle ? `the club's ${input.link.memberTitle}` : "a member"
        }${input.link.via === "shared_club" && input.link.sharedClub ? ` (they are in ${input.link.sharedClub} together)` : " (they are friends)"}. Ask for an intro to ${input.link.memberFirstName}.`
      : `${input.connectorFirstName} is ${input.link.kind === "board" ? "on the board of" : "a member of"} the club${
          input.link.title ? ` (${input.link.title})` : ""
        }. Ask for a quick chat about how the club recruits.`;
  const hints = [input.sameCollege ? "same residential college" : null, input.sameYear ? "same class year" : null]
    .filter(Boolean)
    .join(", ");
  const user = [
    tag("requester_first_name", input.requesterFirstName),
    tag("connector_first_name", input.connectorFirstName),
    tag("club", `${input.clubName}${input.clubShort !== input.clubName ? ` (${input.clubShort})` : ""}`),
    tag("link", link),
    tag("relationship_hints", hints || "none"),
    tag("tone", input.tone),
    `<source>${tag("requester_note", input.note?.slice(0, 300) || "none")}</source>`,
  ].join("\n");
  const { output } = await runAgent(db, {
    name: "introDrafter",
    model: env().XAI_MODEL_FAST_RESOLVED,
    system: loadPrompt("introDrafter"),
    user,
    webSearch: false,
    submit: { name: "submit_message", description: "Return the drafted message.", schema },
    mock: () => ({ message: templateDraft(input) }),
  });
  return output.message.trim();
}
