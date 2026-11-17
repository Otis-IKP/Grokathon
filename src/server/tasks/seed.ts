import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray, or } from "drizzle-orm";
import { addAliases, slugify } from "@/server/clubs/aliases";
import type { Db } from "@/server/db/client";
import {
  clubs,
  experiences,
  friendships,
  intros,
  memberships,
  pathSearches,
  people,
  phoneLinkCodes,
  users,
} from "@/server/db/schema";
import { upsertMembership } from "@/server/memberships/service";

/**
 * Demo data (section 14). Idempotent. Every demo person has `is_demo = true`,
 * `directory_source = 'demo'` and a NetID prefixed `demo_`, and is never
 * shown to a non-demo viewer.
 */

type SeedClub = { name: string; short_name: string; aliases: string[]; category: string; description?: string };

type DemoPerson = {
  netid: string;
  first: string;
  last: string;
  college: string;
  year: number;
  major: string;
  user?: { phone: string };
};

const COLLEGES = [
  "Berkeley",
  "Branford",
  "Davenport",
  "Ezra Stiles",
  "Grace Hopper",
  "Jonathan Edwards",
  "Morse",
  "Pauli Murray",
  "Pierson",
  "Saybrook",
  "Silliman",
  "Timothy Dwight",
  "Trumbull",
  "Benjamin Franklin",
];

const CORE: DemoPerson[] = [
  { netid: "demo_maya", first: "Maya", last: "Chen", college: "Berkeley", year: 2028, major: "Economics", user: { phone: "+12035550101" } },
  { netid: "demo_jordan", first: "Jordan", last: "Lee", college: "Berkeley", year: 2027, major: "Economics", user: { phone: "+12035550102" } },
  { netid: "demo_priya", first: "Priya", last: "Kapoor", college: "Silliman", year: 2028, major: "Political Science", user: { phone: "+12035550103" } },
  { netid: "demo_sam", first: "Sam", last: "Wu", college: "Trumbull", year: 2026, major: "Applied Mathematics" },
];

const FILLER_NAMES: [string, string][] = [
  ["Aiden", "Brooks"], ["Bianca", "Rossi"], ["Caleb", "Nguyen"], ["Dalia", "Haddad"], ["Elias", "Park"],
  ["Farah", "Siddiqui"], ["Gabriel", "Ortiz"], ["Hana", "Sato"], ["Isaac", "Mensah"], ["Julia", "Novak"],
  ["Kai", "Anderson"], ["Leila", "Rahimi"], ["Mateo", "Alvarez"], ["Nora", "Fischer"], ["Omar", "Farouk"],
  ["Pia", "Lindqvist"], ["Quinn", "Murphy"], ["Rhea", "Desai"], ["Simon", "Adler"], ["Tessa", "Greene"],
  ["Uri", "Katz"], ["Vera", "Popov"], ["Wes", "Coleman"], ["Xin", "Zhao"], ["Yara", "Nasser"],
  ["Zoe", "Bennett"], ["Andre", "Baptiste"], ["Camila", "Reyes"], ["Devon", "Clarke"], ["Esme", "Laurent"],
];
const MAJORS = ["Computer Science", "History", "Economics", "Global Affairs", "English", "Physics", "Psychology"];

const FILLER: DemoPerson[] = FILLER_NAMES.map(([first, last], i) => ({
  netid: `demo_${first.toLowerCase()}`,
  first,
  last,
  college: COLLEGES[i % COLLEGES.length],
  year: 2026 + (i % 4),
  major: MAJORS[i % MAJORS.length],
}));

/** Filler memberships across six clubs: [club short name, title or null, board?] by filler index. */
const FILLER_CLUBS = ["YSIG", "YUCG", "YDN", "YPU", "y/cs", "the Dramat"];
const BOARD_TITLES = ["Vice President", "Treasurer", "Managing Editor", "Speaker", "Director", "Producer"];

function evidenceUrl(clubSlug: string): string {
  return `https://example.com/demo/${clubSlug}/team`;
}

function loadClubs(): SeedClub[] {
  const file = path.join(process.cwd(), "scripts/data/clubs.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as SeedClub[];
}

export async function seedClubs(db: Db): Promise<Map<string, string>> {
  const idByShort = new Map<string, string>();
  for (const c of loadClubs()) {
    const slug = slugify(c.short_name || c.name);
    const [row] = await db
      .insert(clubs)
      .values({ slug, name: c.name, shortName: c.short_name, category: c.category, description: c.description ?? null })
      .onConflictDoUpdate({
        target: clubs.slug,
        set: { name: c.name, shortName: c.short_name, category: c.category, description: c.description ?? null },
      })
      .returning();
    await addAliases(db, row.id, [c.name, c.short_name, ...c.aliases]);
    idByShort.set(c.short_name, row.id);
  }
  return idByShort;
}

async function befriend(db: Db, a: string, b: string, status: "accepted" | "pending") {
  const [existing] = await db
    .select()
    .from(friendships)
    .where(
      or(
        and(eq(friendships.requesterNetid, a), eq(friendships.addresseeNetid, b)),
        and(eq(friendships.requesterNetid, b), eq(friendships.addresseeNetid, a)),
      ),
    );
  if (existing) return;
  await db.insert(friendships).values({
    requesterNetid: a,
    addresseeNetid: b,
    status,
    respondedAt: status === "accepted" ? new Date() : null,
  });
}

export async function seed(db: Db): Promise<{ clubs: number; people: number }> {
  const clubIds = await seedClubs(db);
  const slugOf = (short: string) => slugify(short);

  for (const p of [...CORE, ...FILLER]) {
    await db
      .insert(people)
      .values({
        netid: p.netid,
        firstName: p.first,
        lastName: p.last,
        college: p.college,
        year: p.year,
        major: p.major,
        school: "Yale College",
        schoolCode: "YC",
        directorySource: "demo",
        isDemo: true,
      })
      .onConflictDoUpdate({
        target: people.netid,
        set: { firstName: p.first, lastName: p.last, college: p.college, year: p.year, isDemo: true, directorySource: "demo" },
      });
    if (p.user) {
      await db
        .insert(users)
        .values({ netid: p.netid, phoneE164: p.user.phone, phoneVerifiedAt: new Date(), onboardingDoneAt: new Date() })
        .onConflictDoNothing();
    }
  }

  const member = async (
    netid: string,
    short: string,
    role: "member" | "board",
    title: string | null,
    status: "verified" | "likely" | "claimed",
  ) => {
    await upsertMembership(db, {
      netid,
      clubId: clubIds.get(short)!,
      role,
      title,
      status,
      source: status === "claimed" ? "self_report" : "seed",
      evidence:
        status === "claimed"
          ? []
          : [
              {
                url: evidenceUrl(slugOf(short)),
                quote: `${title ?? "Member"} (demo roster entry)`,
                source_type: status === "verified" ? "club_site" : "linkedin",
              },
            ],
    });
  };

  // The demo script: Jordan is a verified YSIG analyst; Sam is YSIG's verified president.
  await member("demo_jordan", "YSIG", "member", "Analyst", "verified");
  await member("demo_sam", "YSIG", "board", "President", "verified");
  await member("demo_priya", "YPU", "member", null, "verified");
  await member("demo_priya", "YIRA", "member", "Delegate", "claimed");

  // Filler: five people per club, the first of each on the board.
  for (let i = 0; i < FILLER.length; i++) {
    const clubIndex = i % FILLER_CLUBS.length;
    const short = FILLER_CLUBS[clubIndex];
    const board = i < FILLER_CLUBS.length;
    const status = i % 7 === 3 ? "likely" : i % 5 === 4 ? "claimed" : "verified";
    await member(FILLER[i].netid, short, board ? "board" : "member", board ? BOARD_TITLES[clubIndex] : null, status);
  }

  // Friendships from the demo script, plus a few so lists and scores look real.
  await befriend(db, "demo_maya", "demo_jordan", "accepted");
  await befriend(db, "demo_maya", "demo_priya", "accepted");
  await befriend(db, "demo_priya", "demo_sam", "accepted");
  await befriend(db, "demo_jordan", "demo_sam", "accepted");
  await befriend(db, "demo_priya", FILLER[3].netid, "accepted"); // a YPU member
  await befriend(db, "demo_jordan", FILLER[0].netid, "accepted"); // a YSIG board member
  await befriend(db, "demo_maya", FILLER[2].netid, "pending"); // Maya added a YDN board member (one-sided)
  await befriend(db, FILLER[7].netid, "demo_maya", "pending"); // incoming request for Maya
  await befriend(db, FILLER[10].netid, "demo_jordan", "pending");

  return { clubs: clubIds.size, people: CORE.length + FILLER.length };
}

/** `pnpm db:seed --purge`: remove every demo person and everything hanging off them. Clubs stay. */
export async function purgeDemo(db: Db): Promise<{ people: number }> {
  const demo = await db.select({ netid: people.netid }).from(people).where(eq(people.isDemo, true));
  const netids = demo.map((d) => d.netid);
  if (netids.length === 0) return { people: 0 };
  await db.transaction(async (tx) => {
    await tx
      .delete(intros)
      .where(
        or(
          inArray(intros.requesterNetid, netids),
          inArray(intros.connectorNetid, netids),
          inArray(intros.targetNetid, netids),
        ),
      );
    await tx.delete(pathSearches).where(inArray(pathSearches.requesterNetid, netids));
    await tx
      .delete(friendships)
      .where(or(inArray(friendships.requesterNetid, netids), inArray(friendships.addresseeNetid, netids)));
    await tx.delete(memberships).where(inArray(memberships.netid, netids));
    const demoUsers = await tx.select({ id: users.id }).from(users).where(inArray(users.netid, netids));
    const userIds = demoUsers.map((u) => u.id);
    if (userIds.length > 0) {
      await tx.delete(experiences).where(inArray(experiences.userId, userIds));
      await tx.delete(phoneLinkCodes).where(inArray(phoneLinkCodes.userId, userIds));
      await tx.delete(users).where(inArray(users.id, userIds));
    }
    await tx.delete(people).where(inArray(people.netid, netids));
  });
  return { people: netids.length };
}
