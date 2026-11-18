import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const citext = customType<{ data: string }>({ dataType: () => "citext" });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const id = () => uuid("id").primaryKey().defaultRandom();

// Everyone at Yale that NEPO knows about. One row per NetID. Users and non-users alike.
export const people = pgTable(
  "people",
  {
    netid: text("netid").primaryKey(),
    upi: text("upi"),
    firstName: text("first_name").notNull(),
    preferredName: text("preferred_name"),
    lastName: text("last_name").notNull(),
    email: citext("email"),
    schoolCode: text("school_code"),
    school: text("school"),
    college: text("college"),
    year: integer("year"),
    major: text("major"),
    imageUrl: text("image_url"),
    directorySource: text("directory_source").notNull().default("yalies"), // yalies | self | demo
    directorySyncedAt: ts("directory_synced_at"),
    linkedinUrl: text("linkedin_url"),
    linkedinUrlSource: text("linkedin_url_source"), // self | agent
    visibility: text("visibility").notNull().default("listed"), // listed | hidden
    researchedAt: ts("researched_at"),
    isDemo: boolean("is_demo").notNull().default(false),
    searchName: text("search_name").generatedAlwaysAs(
      sql`lower(coalesce(preferred_name, first_name) || ' ' || last_name)`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("people_search_trgm").using("gin", t.searchName.op("gin_trgm_ops")),
    index("people_last_name").on(sql`lower(${t.lastName})`),
  ],
);

// People who have signed in.
export const users = pgTable("users", {
  id: id(),
  netid: text("netid")
    .notNull()
    .unique()
    .references(() => people.netid),
  phoneE164: text("phone_e164").unique(),
  phoneVerifiedAt: ts("phone_verified_at"),
  onboardingDoneAt: ts("onboarding_done_at"),
  allowAsConnector: boolean("allow_as_connector").notNull().default(true),
  shareConnections: boolean("share_connections").notNull().default(true),
  linkedinStatus: text("linkedin_status").notNull().default("none"), // none | reading | ok | needs_pdf | mismatch | failed
  // Latest LinkedIn job, so /api/linkedin/status can read what it found. (Addition to the spec DDL.)
  linkedinJobId: uuid("linkedin_job_id"),
  lastSeenAt: ts("last_seen_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const phoneLinkCodes = pgTable("phone_link_codes", {
  code: text("code").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

// A friendship is one row. requester added addressee.
export const friendships = pgTable(
  "friendships",
  {
    id: id(),
    requesterNetid: text("requester_netid")
      .notNull()
      .references(() => people.netid),
    addresseeNetid: text("addressee_netid")
      .notNull()
      .references(() => people.netid),
    status: text("status").notNull().default("pending"), // pending | accepted | declined | removed
    respondedAt: ts("responded_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("friendships_not_self", sql`${t.requesterNetid} <> ${t.addresseeNetid}`),
    uniqueIndex("friendships_pair").on(
      sql`least(${t.requesterNetid}, ${t.addresseeNetid})`,
      sql`greatest(${t.requesterNetid}, ${t.addresseeNetid})`,
    ),
    index("friendships_addressee").on(t.addresseeNetid, t.status),
  ],
);

export const clubs = pgTable("clubs", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  shortName: text("short_name"),
  category: text("category"),
  website: text("website"),
  description: text("description"),
  status: text("status").notNull().default("active"), // active | unreviewed | hidden
  rosterUrl: text("roster_url"),
  rosterCrawledAt: ts("roster_crawled_at"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const clubAliases = pgTable(
  "club_aliases",
  {
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    aliasNorm: text("alias_norm").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [index("club_aliases_trgm").using("gin", t.aliasNorm.op("gin_trgm_ops"))],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    netid: text("netid")
      .notNull()
      .references(() => people.netid),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    role: text("role").notNull().default("member"), // member | board | alum
    title: text("title"),
    startYear: integer("start_year"),
    endYear: integer("end_year"),
    isCurrent: boolean("is_current").notNull().default(true),
    status: text("status").notNull(), // claimed | verified | likely | unverified | disputed | rejected
    confidence: real("confidence").notNull().default(0.5),
    source: text("source").notNull(), // self_report | linkedin_pdf | linkedin_url | public_roster | web_research | seed
    lastCheckedAt: ts("last_checked_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("memberships_netid_club").on(t.netid, t.clubId),
    index("memberships_club").on(t.clubId, t.status),
  ],
);

export const membershipEvidence = pgTable("membership_evidence", {
  id: id(),
  membershipId: uuid("membership_id")
    .notNull()
    .references(() => memberships.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  quote: text("quote"),
  sourceType: text("source_type").notNull(), // club_site | yale_connect | campus_news | linkedin | other
  retrievedAt: ts("retrieved_at").notNull().defaultNow(),
  createdAt: createdAt(),
});

// Jobs and internships from a user's own LinkedIn. Display context only. Users only.
export const experiences = pgTable("experiences", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  orgName: text("org_name").notNull(),
  roleTitle: text("role_title"),
  kind: text("kind").notNull(), // job | internship | other
  startYear: integer("start_year"),
  endYear: integer("end_year"),
  createdAt: createdAt(),
});

export const unmatchedRosterNames = pgTable("unmatched_roster_names", {
  id: id(),
  clubId: uuid("club_id")
    .notNull()
    .references(() => clubs.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  roleTitle: text("role_title"),
  sourceUrl: text("source_url"),
  resolvedNetid: text("resolved_netid").references(() => people.netid),
  createdAt: createdAt(),
});

export const pathSearches = pgTable("path_searches", {
  id: id(),
  requesterNetid: text("requester_netid")
    .notNull()
    .references(() => people.netid),
  clubId: uuid("club_id")
    .notNull()
    .references(() => clubs.id),
  channel: text("channel").notNull(), // app | bot
  results: jsonb("results").notNull(),
  shareToken: text("share_token").unique(),
  // Share tokens expire after 24 hours. (Addition to the spec DDL.)
  shareExpiresAt: ts("share_expires_at"),
  createdAt: createdAt(),
});

export const intros = pgTable(
  "intros",
  {
    id: id(),
    requesterNetid: text("requester_netid")
      .notNull()
      .references(() => people.netid),
    connectorNetid: text("connector_netid")
      .notNull()
      .references(() => people.netid),
    targetNetid: text("target_netid").references(() => people.netid),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    pathSearchId: uuid("path_search_id").references(() => pathSearches.id),
    message: text("message").notNull(),
    status: text("status").notNull().default("drafted"), // drafted | sent | accepted | declined | completed | cancelled
    channel: text("channel").notNull(), // app | bot
    responseToken: text("response_token").notNull().unique(),
    connectorNote: text("connector_note"),
    sentAt: ts("sent_at"),
    respondedAt: ts("responded_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("intros_connector").on(t.connectorNetid, t.status)],
);

export const introEvents = pgTable("intro_events", {
  id: id(),
  introId: uuid("intro_id")
    .notNull()
    .references(() => intros.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // created | edited | sent | viewed | accepted | declined | completed | cancelled
  actorNetid: text("actor_netid"),
  data: jsonb("data"),
  createdAt: createdAt(),
});

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(), // linkedin_read | linkedin_pdf | validate_membership | crawl_roster | research_person
    payload: jsonb("payload").notNull(),
    dedupeKey: text("dedupe_key").unique(),
    status: text("status").notNull().default("queued"), // queued | running | done | failed
    attempts: integer("attempts").notNull().default(0),
    runAfter: ts("run_after").notNull().defaultNow(),
    lockedAt: ts("locked_at"),
    finishedAt: ts("finished_at"),
    error: text("error"),
    result: jsonb("result"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("jobs_ready").on(t.status, t.runAfter)],
);

export const agentRuns = pgTable("agent_runs", {
  id: id(),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
  agent: text("agent").notNull(),
  model: text("model").notNull(),
  input: jsonb("input").notNull(),
  output: jsonb("output"),
  citations: jsonb("citations"),
  durationMs: integer("duration_ms"),
  error: text("error"),
  createdAt: createdAt(),
});

/**
 * Request counts per key and time window. Shared by every server instance, so
 * a limit holds however many serverless functions are running.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: ts("window_start").notNull(),
    hits: integer("hits").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

/**
 * The messaging bot's per-phone state (the conversation so far, the draft
 * waiting for "send", intro requests waiting for a YES or NO), kept here so it
 * survives restarts and is the same on every bot instance. Keys are
 * `phone:{E.164}`. Rows expire after `BOT_STATE_TTL_MS` without an update.
 */
export const botState = pgTable("bot_state", {
  key: text("key").primaryKey(),
  state: jsonb("state").notNull(),
  updatedAt: updatedAt(),
});

/** One-time claims, so a webhook delivered twice (to any instance) is handled once. */
export const botClaims = pgTable("bot_claims", {
  key: text("key").primaryKey(),
  createdAt: createdAt(),
});

export type Person = typeof people.$inferSelect;
export type User = typeof users.$inferSelect;
export type Club = typeof clubs.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Friendship = typeof friendships.$inferSelect;
export type Intro = typeof intros.$inferSelect;
export type Job = typeof jobs.$inferSelect;
