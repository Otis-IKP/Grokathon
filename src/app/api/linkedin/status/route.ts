import { appRoute } from "@/server/api/route";
import { linkedinStatus } from "@/server/linkedin/service";

/** Polled by the onboarding screen. */
export const GET = appRoute(async ({ db, me }) => linkedinStatus(db, me.user));
