import { adminRoute } from "@/server/api/route";
import { listJobs } from "@/server/admin/service";

export const GET = adminRoute(async ({ db, url }) =>
  listJobs(db, { status: url.searchParams.get("status") ?? undefined }),
);
