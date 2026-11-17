CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"agent" text NOT NULL,
	"model" text NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"citations" jsonb,
	"duration_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "club_aliases" (
	"club_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"alias_norm" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "club_aliases_alias_norm_unique" UNIQUE("alias_norm")
);
--> statement-breakpoint
CREATE TABLE "clubs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"category" text,
	"website" text,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"roster_url" text,
	"roster_crawled_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clubs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_name" text NOT NULL,
	"role_title" text,
	"kind" text NOT NULL,
	"start_year" integer,
	"end_year" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "friendships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_netid" text NOT NULL,
	"addressee_netid" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friendships_not_self" CHECK ("friendships"."requester_netid" <> "friendships"."addressee_netid")
);
--> statement-breakpoint
CREATE TABLE "intro_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intro_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_netid" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_netid" text NOT NULL,
	"connector_netid" text NOT NULL,
	"target_netid" text,
	"club_id" uuid NOT NULL,
	"path_search_id" uuid,
	"message" text NOT NULL,
	"status" text DEFAULT 'drafted' NOT NULL,
	"channel" text NOT NULL,
	"response_token" text NOT NULL,
	"connector_note" text,
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intros_response_token_unique" UNIQUE("response_token")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "membership_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"url" text NOT NULL,
	"quote" text,
	"source_type" text NOT NULL,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"netid" text NOT NULL,
	"club_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"title" text,
	"start_year" integer,
	"end_year" integer,
	"is_current" boolean DEFAULT true NOT NULL,
	"status" text NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"source" text NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_netid_club" UNIQUE("netid","club_id")
);
--> statement-breakpoint
CREATE TABLE "path_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_netid" text NOT NULL,
	"club_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"results" jsonb NOT NULL,
	"share_token" text,
	"share_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "path_searches_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"netid" text PRIMARY KEY NOT NULL,
	"upi" text,
	"first_name" text NOT NULL,
	"preferred_name" text,
	"last_name" text NOT NULL,
	"email" "citext",
	"school_code" text,
	"school" text,
	"college" text,
	"year" integer,
	"major" text,
	"image_url" text,
	"directory_source" text DEFAULT 'yalies' NOT NULL,
	"directory_synced_at" timestamp with time zone,
	"linkedin_url" text,
	"linkedin_url_source" text,
	"visibility" text DEFAULT 'listed' NOT NULL,
	"researched_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"search_name" text GENERATED ALWAYS AS (lower(coalesce(preferred_name, first_name) || ' ' || last_name)) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phone_link_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unmatched_roster_names" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"role_title" text,
	"source_url" text,
	"resolved_netid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"netid" text NOT NULL,
	"phone_e164" text,
	"phone_verified_at" timestamp with time zone,
	"onboarding_done_at" timestamp with time zone,
	"allow_as_connector" boolean DEFAULT true NOT NULL,
	"share_connections" boolean DEFAULT true NOT NULL,
	"linkedin_status" text DEFAULT 'none' NOT NULL,
	"linkedin_job_id" uuid,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_netid_unique" UNIQUE("netid"),
	CONSTRAINT "users_phone_e164_unique" UNIQUE("phone_e164")
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_aliases" ADD CONSTRAINT "club_aliases_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requester_netid_people_netid_fk" FOREIGN KEY ("requester_netid") REFERENCES "public"."people"("netid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_addressee_netid_people_netid_fk" FOREIGN KEY ("addressee_netid") REFERENCES "public"."people"("netid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intro_events" ADD CONSTRAINT "intro_events_intro_id_intros_id_fk" FOREIGN KEY ("intro_id") REFERENCES "public"."intros"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intros" ADD CONSTRAINT "intros_requester_netid_people_netid_fk" FOREIGN KEY ("requester_netid") REFERENCES "public"."people"("netid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intros" ADD CONSTRAINT "intros_connector_netid_people_netid_fk" FOREIGN KEY ("connector_netid") REFERENCES "public"."people"("netid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intros" ADD CONSTRAINT "intros_target_netid_people_netid_fk" FOREIGN KEY ("target_netid") REFERENCES "public"."people"("netid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intros" ADD CONSTRAINT "intros_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intros" ADD CONSTRAINT "intros_path_search_id_path_searches_id_fk" FOREIGN KEY ("path_search_id") REFERENCES "public"."path_searches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_evidence" ADD CONSTRAINT "membership_evidence_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_netid_people_netid_fk" FOREIGN KEY ("netid") REFERENCES "public"."people"("netid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "path_searches" ADD CONSTRAINT "path_searches_requester_netid_people_netid_fk" FOREIGN KEY ("requester_netid") REFERENCES "public"."people"("netid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "path_searches" ADD CONSTRAINT "path_searches_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_link_codes" ADD CONSTRAINT "phone_link_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched_roster_names" ADD CONSTRAINT "unmatched_roster_names_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched_roster_names" ADD CONSTRAINT "unmatched_roster_names_resolved_netid_people_netid_fk" FOREIGN KEY ("resolved_netid") REFERENCES "public"."people"("netid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_netid_people_netid_fk" FOREIGN KEY ("netid") REFERENCES "public"."people"("netid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "club_aliases_trgm" ON "club_aliases" USING gin ("alias_norm" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "friendships_pair" ON "friendships" USING btree (least("requester_netid", "addressee_netid"),greatest("requester_netid", "addressee_netid"));--> statement-breakpoint
CREATE INDEX "friendships_addressee" ON "friendships" USING btree ("addressee_netid","status");--> statement-breakpoint
CREATE INDEX "intros_connector" ON "intros" USING btree ("connector_netid","status");--> statement-breakpoint
CREATE INDEX "jobs_ready" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "memberships_club" ON "memberships" USING btree ("club_id","status");--> statement-breakpoint
CREATE INDEX "people_search_trgm" ON "people" USING gin ("search_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "people_last_name" ON "people" USING btree (lower("last_name"));