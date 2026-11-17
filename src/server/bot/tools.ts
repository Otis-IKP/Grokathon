import { z } from "zod";

/**
 * The Bot API contract with Tobi's Grok agent (section 9.3). Request schemas
 * are defined once here: the route handlers validate with them, and
 * `pnpm gen:bot-tools` turns them into xAI function definitions in
 * docs/bot-tools.json. Keep the Bot API stable: add fields, never rename.
 */

const phone = z
  .string()
  .min(5)
  .max(30)
  .describe("The texter's phone number, as received from iMessage. Any common format; E.164 preferred, e.g. +12035550101.");
const searchId = z.string().uuid().describe("The search_id returned by find_paths.");
const connectorNetid = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .describe("results[].connector.netid of the connector the user chose, from find_paths.");
const tone = z.enum(["casual", "polite"]).describe("casual (default) for a close friend, polite for someone they know less well.");

export const botSchemas = {
  link_phone: z.object({
    phone,
    code: z.string().trim().regex(/^\d{6}$/).describe("The 6-digit code the user texted."),
  }),
  whoami: z.object({ phone }),
  resolve_club: z.object({
    text: z.string().trim().min(1).max(120).describe('The club phrase from the user\'s message, e.g. "YSIG" or "the Dramat".'),
  }),
  find_paths: z.object({
    phone,
    club_id: z.string().uuid().describe("club.id from resolve_club."),
    limit: z.number().int().min(1).max(5).optional().describe("How many paths to return. Default 3, max 5."),
  }),
  draft_intro: z.object({
    phone,
    search_id: searchId,
    connector_netid: connectorNetid,
    tone: tone.optional(),
    note: z.string().trim().max(300).optional().describe("Anything the user wants worked into the message."),
  }),
  create_intro: z.object({
    phone,
    search_id: searchId,
    connector_netid: connectorNetid,
    target_netid: z
      .string()
      .trim()
      .max(40)
      .nullable()
      .optional()
      .describe("results[].target.person.netid for a 2-hop path; omit for a 1-hop path."),
    message: z.string().trim().min(1).max(1000).describe("The exact message the user approved."),
  }),
  mark_intro_sent: z.object({
    phone,
    intro_id: z.string().uuid().describe("intro_id returned by create_intro."),
  }),
  list_intros: z.object({ phone }),
  add_friend: z.object({
    phone,
    query: z.string().trim().min(2).max(80).describe("The friend's name as the user wrote it."),
    confirm: z
      .boolean()
      .optional()
      .describe("Pass true only after the user has confirmed the single match; the request is then created."),
  }),
} as const;

export type BotTool = {
  name: keyof typeof botSchemas;
  method: "GET" | "POST";
  /** Path under the app origin. `{intro_id}` is filled from the arguments. */
  path: string;
  description: string;
  returns: string;
  errors: string[];
};

export const botTools: BotTool[] = [
  {
    name: "whoami",
    method: "POST",
    path: "/api/bot/whoami",
    description:
      "Look up the NEPO user for a phone number. Call this at the start of every conversation, before anything else. If it fails with user_not_linked, the texter has no linked account: if their message is a 6-digit number call link_phone, otherwise tell them to sign up in the NEPO app and link their phone there.",
    returns: "{ user: PersonCard, friends_count, clubs: [{ name, role }], onboarding_done }",
    errors: ["user_not_linked"],
  },
  {
    name: "link_phone",
    method: "POST",
    path: "/api/bot/link-phone",
    description:
      "Link the texter's phone number to their NEPO account. Call this when a number that whoami does not recognise texts a 6-digit number. On invalid_code or code_expired, tell them to get a fresh code in the app.",
    returns: "{ linked: true, user: PersonCard }",
    errors: ["invalid_code", "code_expired", "invalid_phone"],
  },
  {
    name: "resolve_club",
    method: "POST",
    path: "/api/bot/resolve-club",
    description:
      "Turn the club phrase in the user's message into a known club. Call this whenever the user names a club they want to join, before find_paths. If `club` is null, ask the user to choose among `candidates` (\"Did you mean…?\") and call again with their choice; if there are no candidates, say NEPO does not know that club yet.",
    returns: "{ club: ClubCard | null, candidates: ClubCard[], confidence }",
    errors: [],
  },
  {
    name: "find_paths",
    method: "POST",
    path: "/api/bot/find-paths",
    description:
      "Find the friends best placed to introduce the user to a club. Call this once the club is resolved. Reply with each result's `why` sentence. If `results` is empty, use `empty_reason`: no_friends → suggest adding friends first; no_known_members → NEPO does not have that club's roster yet; no_connection → none of their friends are connected to it yet; already_member → they are already in it. If `pending_research` is true, more paths may appear if you call again in about a minute.",
    returns: "{ search_id, club, results: PathResult[], pending_research, empty_reason }",
    errors: ["user_not_linked", "club_not_found"],
  },
  {
    name: "draft_intro",
    method: "POST",
    path: "/api/bot/draft-intro",
    description:
      "Draft the message the user would send a connector to ask for an introduction. Call this after the user picks one of the paths from find_paths, then show them the draft and ask whether to send it or change it.",
    returns: "{ message }",
    errors: ["user_not_linked", "search_not_found", "connector_not_in_search"],
  },
  {
    name: "create_intro",
    method: "POST",
    path: "/api/bot/intros",
    description:
      "Record the intro once the user approves the message (for example by saying \"send\"). This does not send anything: sending is done by you or by the user. The returned `response_url` is a link where the connector can accept or decline in NEPO; you may append it to the outgoing text. Call mark_intro_sent after the message has gone out.",
    returns: '{ intro_id, status: "drafted", response_url }',
    errors: ["user_not_linked", "search_not_found", "connector_not_in_search"],
  },
  {
    name: "mark_intro_sent",
    method: "POST",
    path: "/api/bot/intros/{intro_id}/sent",
    description:
      "Mark an intro as sent. Call this right after the message goes out, whether you sent it or the user confirmed sending it themselves. The intro then appears in the connector's NEPO inbox.",
    returns: '{ status: "sent" }',
    errors: ["user_not_linked", "intro_not_found", "invalid_state"],
  },
  {
    name: "list_intros",
    method: "GET",
    path: "/api/bot/intros",
    description:
      "List the user's recent intros and their status. Call this when the user asks whether someone replied or what happened to an intro. A status of declined should be relayed gently as \"not right now\", with no reason.",
    returns: "{ intros: [{ intro_id, status, status_label, club, connector, target, message, created_at, sent_at, responded_at }] }",
    errors: ["user_not_linked"],
  },
  {
    name: "add_friend",
    method: "POST",
    path: "/api/bot/friends/add",
    description:
      "Find someone in the Yale directory to add as a friend. Call it first without `confirm` to get matches; if there is one `strong_match`, check it with the user (name, college, class year) and call again with confirm: true to create the request. If there are several matches, ask the user which one they mean. If the person is not on NEPO yet, the response includes an invite link for the user to send themselves.",
    returns: "{ matches: PersonCard[], created, strong_match?, friendship? }",
    errors: ["user_not_linked", "already_friends"],
  },
];

/** xAI function definitions: flat objects with type, name, description, parameters. */
export function botToolDefinitions() {
  return botTools.map((tool) => {
    const parameters = z.toJSONSchema(botSchemas[tool.name]) as Record<string, unknown>;
    delete parameters.$schema;
    return { type: "function" as const, name: tool.name, description: tool.description, parameters };
  });
}
