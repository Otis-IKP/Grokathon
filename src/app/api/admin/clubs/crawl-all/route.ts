import { adminRoute } from "@/server/api/route";
import { crawlAllClubs } from "@/server/admin/service";

export const POST = adminRoute(async ({ db, url }) => crawlAllClubs(db, url.searchParams.get("force") === "1"));
