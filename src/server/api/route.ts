import { after } from "next/server";
import type { z } from "zod";
import { AppError, errorResponse } from "@/lib/errors";
import { requireAdmin, requireBot, requireCron, requireUser, type CurrentUser } from "@/server/auth/guards";
import { getDb, type Db } from "@/server/db/client";
import { drainJobs } from "@/server/jobs/run";

/**
 * Route handlers only parse, authorise, call a service and shape the response.
 * Every handler in src/app/api must be built with one of the wrappers below;
 * tests/unit/privacy.routes.test.ts fails if one is not.
 */

type Params = Record<string, string>;
type NextCtx = { params: Promise<Params> };
type Base = { req: Request; params: Params; db: Db; url: URL };
type Result = unknown | Response;

function toResponse(result: Result, headers?: HeadersInit): Response {
  if (result instanceof Response) {
    if (!headers) return result;
    // Keep per-route headers (CORS) on hand-built responses such as a preflight 204.
    const merged = new Headers(result.headers);
    new Headers(headers).forEach((value, key) => {
      if (!merged.has(key)) merged.set(key, value);
    });
    return new Response(result.body, { status: result.status, statusText: result.statusText, headers: merged });
  }
  return Response.json(result ?? { ok: true }, { headers });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Path segments that are row ids. Anything else in them can't match a row, so it is a 404, not a failed query. */
const UUID_PARAMS = new Set(["id", "searchId"]);

function checkParams(params: Params): void {
  for (const [key, value] of Object.entries(params)) {
    if (UUID_PARAMS.has(key) && !UUID.test(value)) throw new AppError("not_found", "Not found.");
  }
}

/** Run any jobs the handler queued once the response is sent, so users don't wait for the cron. */
function kickJobs(db: Db) {
  try {
    after(async () => {
      try {
        await drainJobs(db, 5);
      } catch (err) {
        console.error("[jobs] post-response drain failed:", err instanceof Error ? err.message : err);
      }
    });
  } catch {
    // Outside a Next request scope (unit tests): nothing to schedule.
  }
}

function build<Extra>(
  authorise: (req: Request, db: Db) => Promise<Extra>,
  handler: (ctx: Base & Extra) => Promise<Result>,
  opts: { headers?: (req: Request) => HeadersInit | undefined; kick?: boolean } = {},
) {
  return async (req: Request, nextCtx: NextCtx): Promise<Response> => {
    const headers = opts.headers?.(req);
    try {
      const db = getDb();
      const extra = await authorise(req, db);
      const params = (await nextCtx?.params) ?? {};
      checkParams(params);
      const result = await handler({ req, params, db, url: new URL(req.url), ...extra });
      if (opts.kick !== false && req.method !== "GET") kickJobs(db);
      return toResponse(result, headers);
    } catch (err) {
      return errorResponse(err, headers);
    }
  };
}

/** App API: requires the session cookie. */
export function appRoute(handler: (ctx: Base & { me: CurrentUser }) => Promise<Result>) {
  return build(async (_req, db) => ({ me: await requireUser(db) }), handler);
}

/** Admin API: session cookie and a NetID in ADMIN_NETIDS. */
export function adminRoute(handler: (ctx: Base & { me: CurrentUser }) => Promise<Result>) {
  return build(async (_req, db) => ({ me: await requireAdmin(db) }), handler);
}

/** Bot API: `Authorization: Bearer {BOT_API_SECRET}`. */
export function botRoute(handler: (ctx: Base) => Promise<Result>) {
  return build(async (req) => {
    requireBot(req);
    return {};
  }, handler);
}

/** Internal: `Authorization: Bearer {CRON_SECRET}`. */
export function cronRoute(handler: (ctx: Base) => Promise<Result>) {
  return build(
    async (req) => {
      requireCron(req);
      return {};
    },
    handler,
    { kick: false },
  );
}

/**
 * No authentication. Allowed only for the CAS routes and the token-gated
 * graph endpoint (privacy rule 1); the route test keeps an explicit allowlist.
 */
export function publicRoute(
  handler: (ctx: Base) => Promise<Result>,
  opts: { headers?: (req: Request) => HeadersInit | undefined } = {},
) {
  return build(async () => ({}), handler, { ...opts, kick: false });
}

export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new AppError("invalid_request", "Body must be JSON.");
  }
  return schema.parse(raw);
}

export function parseQuery<S extends z.ZodType>(url: URL, schema: S): z.infer<S> {
  return schema.parse(Object.fromEntries(url.searchParams.entries()));
}
