import { z } from "zod";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { getConfig } from "../config";
import { getBackend } from "../backend/Backend";
import type { Session } from "./session";
import { smsLink } from "../util/smsLink";
import { sendText } from "../transport/sendblue";

const CONFIRM_RE = /^\s*(send|send it|yes|yep|yeah|y|go|do it|ok|okay)\b/i;
const NOT_CONFIRMED = "not confirmed: ask the user to reply 'send'";

export const toolDefinitions: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "resolve_club",
      description: "Match the student's text to a Yale club.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_club_info",
      description: "Get the public name, category, and blurb for a club id.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { clubId: { type: "string" } },
        required: ["clubId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_paths",
      description: "Find warm intro paths from the current student to a club. Do not pass a user id.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { clubId: { type: "string" } },
        required: ["clubId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_intro_draft",
      description: "Save a draft intro to a connector returned by find_paths. Returns an iMessage link the student can tap.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          connectorId: { type: "string" },
          clubId: { type: "string" },
          message: { type: "string" },
        },
        required: ["connectorId", "clubId", "message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_intro",
      description: "Send the pending draft to the connector. Only works after the student confirms.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { introId: { type: "string" } },
        required: ["introId"],
      },
    },
  },
];

const schemas = {
  resolve_club: z.object({ text: z.string().min(1) }),
  get_club_info: z.object({ clubId: z.string().min(1) }),
  find_paths: z.object({ clubId: z.string().min(1) }),
  save_intro_draft: z.object({
    connectorId: z.string().min(1),
    clubId: z.string().min(1),
    message: z.string().min(1).max(600),
  }),
  send_intro: z.object({ introId: z.string().min(1) }),
} as const;

type ToolName = keyof typeof schemas;

export async function executeTool(name: string, rawArgs: unknown, session: Session): Promise<unknown> {
  if (!(name in schemas)) return { error: `unknown tool ${name}` };
  const toolName = name as ToolName;
  const args = parseArgs(rawArgs);
  if (args === null) return { error: "invalid arguments" };
  const parsed = schemas[toolName].safeParse(args);
  if (!parsed.success) {
    const tooLong = parsed.error.issues.some((issue) => issue.code === "too_big");
    if (toolName === "save_intro_draft" && tooLong) {
      return { error: "message is longer than 600 characters" };
    }
    return { error: parsed.error.issues.map((issue) => issue.message).join("; ") };
  }

  try {
    return await runTool(toolName, parsed.data, session);
  } catch (error) {
    const message = error instanceof Error ? error.message : "tool failed";
    return { error: message };
  }
}

async function runTool(name: ToolName, args: z.infer<(typeof schemas)[ToolName]>, session: Session): Promise<unknown> {
  const backend = getBackend();
  if (name === "resolve_club") {
    const data = args as z.infer<typeof schemas.resolve_club>;
    const matches = await backend.resolveClub(data.text);
    return {
      matches: matches.map((match) => ({
        clubId: match.club.id,
        name: match.club.name,
        confidence: match.confidence,
      })),
    };
  }
  if (name === "get_club_info") {
    const data = args as z.infer<typeof schemas.get_club_info>;
    const club = await backend.getClub(data.clubId);
    if (!club) return { error: "club not found" };
    return { name: club.name, category: club.category, blurb: club.blurb ?? "" };
  }
  if (name === "find_paths") {
    const data = args as z.infer<typeof schemas.find_paths>;
    const paths = await backend.findPaths(session.userId, data.clubId);
    session.allowedConnectorIds = paths.map((path) => path.connector.id);
    return {
      paths: paths.map((path) => ({
        connectorId: path.connector.id,
        connectorName: path.connector.name,
        hops: path.hops,
        targetName: path.target?.name,
        targetRole: path.target?.role,
        via: path.via,
        reasons: path.reasons,
      })),
    };
  }
  if (name === "save_intro_draft") {
    const data = args as z.infer<typeof schemas.save_intro_draft>;
    if (!session.allowedConnectorIds.includes(data.connectorId)) {
      return { error: "connector was not in the latest path results" };
    }
    const intro = await backend.createIntro({
      requesterId: session.userId,
      requesterPhone: session.phone,
      connectorId: data.connectorId,
      clubId: data.clubId,
      message: data.message,
    });
    session.pendingIntroId = intro.id;
    session.pendingIntroTurn = session.turn;
    const phone = await backend.getUserPhone(data.connectorId);
    if (!phone) return { error: "connector has no phone on file" };
    const baseUrl = getConfig().PUBLIC_BASE_URL;
    const link = baseUrl ? `${baseUrl}/d/${intro.id}` : smsLink(phone, data.message);
    return { introId: intro.id, smsLink: link };
  }

  const data = args as z.infer<typeof schemas.send_intro>;
  const confirmedOnALaterTurn = session.pendingIntroTurn !== undefined && session.turn > session.pendingIntroTurn;
  if (data.introId !== session.pendingIntroId || !CONFIRM_RE.test(session.latestUserText) || !confirmedOnALaterTurn) {
    return { error: NOT_CONFIRMED };
  }
  const intro = await backend.getIntro(data.introId);
  if (!intro) return { error: "intro not found" };
  const requester = await backend.getUser(intro.requesterId);
  const phone = await backend.getUserPhone(intro.connectorId);
  if (!requester || !phone) return { error: "could not address that intro" };
  const content = `${intro.message}\n\n— sent via NEPO for ${requester.name}. Reply YES to accept or NO to pass.`;
  await sendText(phone, content);
  await backend.updateIntroStatus(intro.id, "sent");
  session.pendingIntroId = undefined;
  session.pendingIntroTurn = undefined;
  return { ok: true, introId: intro.id };
}

function parseArgs(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  return raw ?? null;
}
