import { z } from "zod";
import { adminRoute, parseBody } from "@/server/api/route";
import { updateClub } from "@/server/admin/service";

const patch = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  short_name: z.string().trim().max(40).nullable().optional(),
  category: z.string().optional(),
  website: z.string().trim().url().nullable().optional(),
  description: z.string().trim().max(600).nullable().optional(),
  status: z.enum(["active", "unreviewed", "hidden"]).optional(),
});

export const PATCH = adminRoute(async ({ req, db, params }) => updateClub(db, params.id, await parseBody(req, patch)));
