import { adminRoute } from "@/server/api/route";
import { listAgentRuns } from "@/server/admin/service";

export const GET = adminRoute(async ({ db, url }) => ({
  runs: await listAgentRuns(db, url.searchParams.get("job_id") ?? undefined),
}));
