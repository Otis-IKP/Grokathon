import type { getMe } from "@/server/me/service";
import type { linkedinStatus } from "@/server/linkedin/service";
import type { MyMembership } from "@/server/memberships/service";

/** Response shapes of GET /api/me, /api/linkedin/status and /api/memberships. Type-only imports. */
export type Me = Awaited<ReturnType<typeof getMe>>;
export type LinkedinState = Awaited<ReturnType<typeof linkedinStatus>>;
export type { MyMembership };
