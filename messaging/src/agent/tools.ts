import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { getConfig } from "../config";
import { getBackend } from "../backend/Backend";
import type { Session } from "./session";
import { smsLink } from "../util/smsLink";
import { sendText } from "../transport/sendblue";

const CONFIRM_RE = /^\s*(send|send it|yes|yep|yeah|y|go|do it|ok|okay)\b/i;
const NOT_CONFIRMED = "not confirmed: ask the user to reply 'send'";

export const toolDefinitions: Anthropic.Beta.BetaTool[] = [
  {
    name: "resolve_club",
    description:
      "Match the student's text to a Yale club. Call this whenever the student names a club or goal, before find_paths. Pass only the club phrase, e.g. \"YSIG\".",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "get_club_info",
    description: "Get the public name, category, and blurb for a club id from resolve_club.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { clubId: { type: "string" } },
      required: ["clubId"],
    },
  },
  {
    name: "find_paths",
    description:
      "Find warm intro paths from the current student to a club id from resolve_club. Do not pass a user id. If paths is empty, emptyReason says why; if pendingResearch is true, more paths may appear in a minute.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { clubId: { type: "string" } },
      required: ["clubId"],
    },
  },
  {
    name: "save_intro_draft",
    description:
      "Save a draft intro to a connector returned by the latest find_paths for the same club. If canTextConnector is true, you can offer to text it for them. If false, the student has to send it themselves; give them appLink, where the connector can answer.",
    strict: true,
    input_schema: {
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
  {
    name: "send_intro",
    description: "Text the pending draft to the connector. Only works after the student explicitly replies \"send\" to that draft.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { introId: { type: "string" } },
      required: ["introId"],
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
    const requester = { id: session.userId, name: session.userName, phone: session.phone, suggestible: true };
    const search = await backend.findPaths(requester, session.phone, data.clubId);
    session.allowedConnectorIds = search.paths.map((path) => path.connector.id);
    session.lastSearch = { searchId: search.searchId, clubId: data.clubId };
    return {
      paths: search.paths.map((path) => ({
        connectorId: path.connector.id,
        connectorName: path.connector.name,
        hops: path.hops,
        targetName: path.target?.name,
        targetRole: path.target?.role,
        via: path.via,
        reasons: path.reasons,
      })),
      ...(search.emptyReason ? { emptyReason: search.emptyReason } : {}),
      ...(search.pendingResearch ? { pendingResearch: true } : {}),
    };
  }
  if (name === "save_intro_draft") {
    const data = args as z.infer<typeof schemas.save_intro_draft>;
    if (!session.allowedConnectorIds.includes(data.connectorId) || !session.lastSearch) {
      return { error: "connector was not in the latest path results" };
    }
    if (session.lastSearch.clubId !== data.clubId) {
      return { error: "the latest find_paths was for a different club; call find_paths for this club first" };
    }
    const intro = await backend.createIntro({
      requesterId: session.userId,
      requesterPhone: session.phone,
      searchId: session.lastSearch.searchId,
      connectorId: data.connectorId,
      clubId: data.clubId,
      message: data.message,
    });
    session.pendingIntroId = intro.id;
    session.pendingIntroTurn = session.turn;
    const phone = await backend.getConnectorPhone(intro);
    if (!phone) {
      // Not an error: the draft is saved and the student sends it themselves.
      return {
        introId: intro.id,
        canTextConnector: false,
        ...(intro.responseUrl ? { appLink: intro.responseUrl } : {}),
      };
    }
    const config = getConfig();
    // The raw sms: link carries the connector's phone and can't expire, so it is a mock-only fallback.
    const link = config.PUBLIC_BASE_URL
      ? `${config.PUBLIC_BASE_URL}/d/${intro.id}`
      : config.BACKEND_MODE === "mock"
        ? smsLink(phone, data.message)
        : undefined;
    return { introId: intro.id, canTextConnector: true, ...(link ? { smsLink: link } : {}) };
  }

  const data = args as z.infer<typeof schemas.send_intro>;
  const confirmedOnALaterTurn = session.pendingIntroTurn !== undefined && session.turn > session.pendingIntroTurn;
  if (data.introId !== session.pendingIntroId || !CONFIRM_RE.test(session.latestUserText) || !confirmedOnALaterTurn) {
    return { error: NOT_CONFIRMED };
  }
  const intro = await backend.getIntro(data.introId, session.phone);
  if (!intro) return { error: "intro not found" };
  if (intro.status !== "drafted") return { error: "that intro was already sent" };
  const phone = await backend.getConnectorPhone(intro);
  if (!phone) return { error: "this connector has not linked a phone, so the student has to send it themselves" };
  const answerInApp = intro.responseUrl ? ` Or answer in the NEPO app: ${intro.responseUrl}` : "";
  const content = `${intro.message}\n\n— sent via NEPO for ${session.userName}. Reply YES to accept or NO to pass.${answerInApp}`;
  await sendText(phone, content, { askIntroId: intro.id });
  await backend.markIntroSent(intro);
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
