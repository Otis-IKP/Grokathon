import { adminRoute } from "@/server/api/route";
import { retryJob } from "@/server/admin/service";

export const POST = adminRoute(async ({ db, params }) => retryJob(db, params.id));
