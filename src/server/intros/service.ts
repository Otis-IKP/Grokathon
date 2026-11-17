import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { draftIntroMessage, type IntroTone } from "@/server/agents/introDrafter";
import { toClubCard, type ClubCard } from "@/server/clubs/resolve";
import type { Db } from "@/server/db/client";
import { clubs, introEvents, intros, people, users, type Intro } from "@/server/db/schema";
import { env } from "@/server/env";
import { clubShort } from "@/server/paths/findPaths";
import { getSearchResultFor } from "@/server/paths/service";
import { getPersonCards, type PersonCard } from "@/server/people/service";

/**
 * The single writer for `intros` and `intro_events`. The backend records what
 * the requester decided to send; it never sends a message itself (privacy rule 7).
 */

export type IntroView = {
  id: string;
  status: string;
  /** Requesters see a declined intro as "not right now", with no reason (privacy rule 8). */
  status_label: string;
  message: string;
  channel: string;
  club: ClubCard;
  requester: PersonCard;
  connector: PersonCard;
  target: PersonCard | null;
  role: "requester" | "connector";
  connector_note: string | null;
  response_url: string | null;
  created_at: string;
  sent_at: string | null;
  responded_at: string | null;
};

export type IntroEventView = { type: string; actor: "you" | "them" | null; at: string };

const STATUS_LABELS: Record<string, string> = {
  drafted: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Not right now",
  completed: "Done",
  cancelled: "Cancelled",
};

function responseUrl(token: string): string {
  return `${env().APP_URL}/i/${token}`;
}

async function addEvent(db: Db, introId: string, type: string, actorNetid: string | null, data?: unknown) {
  await db.insert(introEvents).values({ introId, type, actorNetid, data: (data ?? null) as object | null });
}

async function toViews(db: Db, rows: Intro[], viewerNetid: string): Promise<IntroView[]> {
  if (rows.length === 0) return [];
  const cards = await getPersonCards(
    db,
    rows.flatMap((i) => [i.requesterNetid, i.connectorNetid, ...(i.targetNetid ? [i.targetNetid] : [])]),
  );
  const clubRows = await db
    .select()
    .from(clubs)
    .where(
      inArray(
        clubs.id,
        rows.map((i) => i.clubId),
      ),
    );
  const clubBy = new Map(clubRows.map((c) => [c.id, c]));
  return rows.map((i) => {
    const role = i.requesterNetid === viewerNetid ? ("requester" as const) : ("connector" as const);
    // A decline carries no reason to the requester; an accept note is theirs to read.
    const note = role === "connector" || i.status === "accepted" || i.status === "completed" ? i.connectorNote : null;
    return {
      id: i.id,
      status: i.status,
      status_label: STATUS_LABELS[i.status] ?? i.status,
      message: i.message,
      channel: i.channel,
      club: toClubCard(clubBy.get(i.clubId)!),
      requester: cards.get(i.requesterNetid)!,
      connector: cards.get(i.connectorNetid)!,
      target: i.targetNetid ? (cards.get(i.targetNetid) ?? null) : null,
      role,
      connector_note: note,
      response_url: role === "requester" ? responseUrl(i.responseToken) : null,
      created_at: i.createdAt.toISOString(),
      sent_at: i.sentAt?.toISOString() ?? null,
      responded_at: i.respondedAt?.toISOString() ?? null,
    };
  });
}

/** Draft the text a requester would send a connector. Fast enough to run inline. */
export async function draftIntro(
  db: Db,
  input: { requesterNetid: string; searchId: string; connectorNetid: string; tone?: IntroTone; note?: string },
): Promise<{ message: string }> {
  const { club, result } = await getSearchResultFor(db, input.requesterNetid, input.searchId, input.connectorNetid);
  const [requester] = await db.select().from(people).where(eq(people.netid, input.requesterNetid));
  const first = requester.preferredName?.trim() || requester.firstName;
  const link =
    result.link.type === "member"
      ? result.link.role === "board"
        ? ({ kind: "board", title: result.link.title } as const)
        : ({ kind: "member", title: result.link.title } as const)
      : ({
          kind: "knows_member",
          memberFirstName: result.target!.person.first_name,
          memberTitle: result.target!.title,
          via: result.link.via,
          sharedClub: result.link.shared_club ?? null,
        } as const);
  const message = await draftIntroMessage(db, {
    requesterFirstName: first,
    connectorFirstName: result.connector.first_name,
    clubName: club.name,
    clubShort: clubShort(club),
    link,
    sameCollege: Boolean(requester.college && requester.college === result.connector.college),
    sameYear: Boolean(requester.year && requester.year === result.connector.year),
    tone: input.tone ?? "casual",
    note: input.note,
  });
  return { message };
}

export async function createIntro(
  db: Db,
  input: {
    requesterNetid: string;
    searchId: string;
    connectorNetid: string;
    targetNetid?: string | null;
    message: string;
    channel: "app" | "bot";
  },
): Promise<IntroView> {
  const { club, result } = await getSearchResultFor(db, input.requesterNetid, input.searchId, input.connectorNetid);
  // The target always comes from the saved search, never from the caller's word alone.
  const target = result.target?.person.netid ?? null;
  if (input.targetNetid && input.targetNetid.toLowerCase() !== target) {
    throw new AppError("invalid_request", "target_netid does not match this path.");
  }
  const [row] = await db
    .insert(intros)
    .values({
      requesterNetid: input.requesterNetid,
      connectorNetid: result.connector.netid,
      targetNetid: target,
      clubId: club.id,
      pathSearchId: input.searchId,
      message: input.message.trim(),
      channel: input.channel,
      responseToken: randomBytes(18).toString("base64url"),
    })
    .returning();
  await addEvent(db, row.id, "created", input.requesterNetid, { channel: input.channel });
  return (await toViews(db, [row], input.requesterNetid))[0];
}

export async function listIntros(db: Db, netid: string, box: "incoming" | "outgoing"): Promise<IntroView[]> {
  const where =
    box === "incoming"
      ? and(eq(intros.connectorNetid, netid), inArray(intros.status, ["sent", "accepted", "declined", "completed"]))
      : eq(intros.requesterNetid, netid);
  const rows = await db.select().from(intros).where(where).orderBy(desc(intros.createdAt)).limit(100);
  return toViews(db, rows, netid);
}

export async function introCounts(db: Db, netid: string): Promise<{ inbox: number }> {
  const rows = await db
    .select({ id: intros.id })
    .from(intros)
    .where(and(eq(intros.connectorNetid, netid), eq(intros.status, "sent")));
  return { inbox: rows.length };
}

async function loadFor(db: Db, id: string, netid: string): Promise<Intro> {
  const [row] = await db.select().from(intros).where(eq(intros.id, id));
  if (!row || (row.requesterNetid !== netid && row.connectorNetid !== netid)) {
    throw new AppError("intro_not_found", "That intro does not exist.");
  }
  return row;
}

async function eventsFor(db: Db, introId: string, viewerNetid: string): Promise<IntroEventView[]> {
  const rows = await db.select().from(introEvents).where(eq(introEvents.introId, introId)).orderBy(asc(introEvents.createdAt));
  return rows.map((e) => ({
    type: e.type,
    actor: e.actorNetid === null ? null : e.actorNetid === viewerNetid ? "you" : "them",
    at: e.createdAt.toISOString(),
  }));
}

/** Requester or connector only. */
export async function getIntro(db: Db, id: string, netid: string): Promise<{ intro: IntroView; events: IntroEventView[] }> {
  const row = await loadFor(db, id, netid);
  const [intro] = await toViews(db, [row], netid);
  const events = await eventsFor(db, row.id, netid);
  // The requester does not see that (or when) the connector opened the link.
  return { intro, events: intro.role === "requester" ? events.filter((e) => e.type !== "viewed") : events };
}

async function requesterIntro(db: Db, id: string, netid: string): Promise<Intro> {
  const row = await loadFor(db, id, netid);
  if (row.requesterNetid !== netid) throw new AppError("forbidden", "Only the person asking can do that.");
  return row;
}

export async function editIntroMessage(db: Db, id: string, netid: string, message: string): Promise<IntroView> {
  const row = await requesterIntro(db, id, netid);
  if (row.status !== "drafted") throw new AppError("invalid_state", "Only a draft can be edited.");
  const [updated] = await db.update(intros).set({ message: message.trim() }).where(eq(intros.id, id)).returning();
  await addEvent(db, id, "edited", netid);
  return (await toViews(db, [updated], netid))[0];
}

export async function introAction(
  db: Db,
  id: string,
  netid: string,
  action: "mark_sent" | "cancel" | "complete",
): Promise<IntroView> {
  const row = await requesterIntro(db, id, netid);
  let patch: Partial<typeof intros.$inferInsert>;
  let event: string;
  if (action === "mark_sent") {
    if (row.status === "sent") return (await toViews(db, [row], netid))[0];
    if (row.status !== "drafted") throw new AppError("invalid_state", "This intro was already sent.");
    patch = { status: "sent", sentAt: new Date() };
    event = "sent";
  } else if (action === "cancel") {
    if (!["drafted", "sent"].includes(row.status)) throw new AppError("invalid_state", "This intro can't be cancelled now.");
    patch = { status: "cancelled" };
    event = "cancelled";
  } else {
    if (row.status !== "accepted") throw new AppError("invalid_state", "Only an accepted intro can be marked done.");
    patch = { status: "completed" };
    event = "completed";
  }
  const [updated] = await db.update(intros).set(patch).where(eq(intros.id, id)).returning();
  await addEvent(db, id, event, netid);
  return (await toViews(db, [updated], netid))[0];
}

/** Tell the bot a connector answered, so it can text the requester. Fire and forget, 5 s timeout. */
function notifyBot(payload: Record<string, unknown>): void {
  const url = env().BOT_WEBHOOK_URL;
  if (!url) return;
  const secret = env().BOT_API_SECRET;
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    // Best effort by design; the requester still sees the answer in the app.
  });
}

/** Connector only. Decline needs no reason. */
export async function respondToIntro(
  db: Db,
  id: string,
  netid: string,
  decision: "accept" | "decline",
  note?: string,
): Promise<IntroView> {
  const row = await loadFor(db, id, netid);
  if (row.connectorNetid !== netid) throw new AppError("forbidden", "Only the person asked can answer.");
  if (!["sent", "drafted"].includes(row.status)) {
    throw new AppError("invalid_state", "This request has already been answered.");
  }
  const status = decision === "accept" ? "accepted" : "declined";
  const [updated] = await db
    .update(intros)
    .set({
      status,
      respondedAt: new Date(),
      sentAt: row.sentAt ?? new Date(),
      connectorNote: note?.trim() ? note.trim().slice(0, 500) : null,
    })
    .where(eq(intros.id, id))
    .returning();
  await addEvent(db, id, status, netid);

  const [requesterUser] = await db.select().from(users).where(eq(users.netid, row.requesterNetid));
  const [club] = await db.select().from(clubs).where(eq(clubs.id, row.clubId));
  const [connector] = await db.select().from(people).where(eq(people.netid, row.connectorNetid));
  if (requesterUser?.phoneE164 && requesterUser.phoneVerifiedAt) {
    notifyBot({
      event: "intro.responded",
      intro_id: row.id,
      decision,
      requester_phone: requesterUser.phoneE164,
      connector_first_name: connector.preferredName?.trim() || connector.firstName,
      club_name: club.name,
    });
  }
  return (await toViews(db, [updated], netid))[0];
}

/** For /i/{token}: the signed-in NetID must be the connector. */
export async function getIntroByToken(
  db: Db,
  token: string,
  netid: string,
): Promise<{ intro: IntroView; events: IntroEventView[] }> {
  const [row] = await db.select().from(intros).where(eq(intros.responseToken, token));
  if (!row || row.status === "cancelled") throw new AppError("intro_not_found", "This link is no longer active.");
  if (row.connectorNetid !== netid) throw new AppError("forbidden", "This link is for someone else.");
  await addEvent(db, row.id, "viewed", netid);
  const [intro] = await toViews(db, [row], netid);
  return { intro, events: await eventsFor(db, row.id, netid) };
}

/** The bot's "did Jordan reply?" list. */
export async function recentIntrosForRequester(db: Db, netid: string, limit = 10) {
  const rows = await db
    .select()
    .from(intros)
    .where(or(eq(intros.requesterNetid, netid)))
    .orderBy(desc(intros.createdAt))
    .limit(limit);
  return toViews(db, rows, netid);
}
