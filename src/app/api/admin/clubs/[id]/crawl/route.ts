import { adminRoute } from "@/server/api/route";
import { crawlClub } from "@/server/admin/service";

export const POST = adminRoute(async ({ db, params }) => crawlClub(db, params.id));
