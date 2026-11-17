import { z } from "zod";
import { AppError } from "@/lib/errors";
import { cronRoute, parseBody } from "@/server/api/route";
import { env } from "@/server/env";
import { isTaskName, tasks } from "@/server/tasks";

export const maxDuration = 300;

const body = z.object({ task: z.string(), args: z.object({ force: z.boolean().optional() }).optional() });

/**
 * Development only. The embedded database can be open in one process, so
 * while `pnpm dev` runs, the pnpm scripts (seed, migrate, …) send their task
 * here instead. Refused in production.
 */
export const POST = cronRoute(async ({ req, db }) => {
  if (env().NODE_ENV === "production") throw new AppError("forbidden", "Not available in production.");
  const { task, args } = await parseBody(req, body);
  if (!isTaskName(task)) throw new AppError("invalid_request", `Unknown task ${task}.`);
  return { task, result: await tasks[task](db, args) };
});
