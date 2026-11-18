import { ZodError } from "zod";

/** Stable error codes. The bot and the UI branch on these; add, never rename. */
export const ERROR_CODES = {
  invalid_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  rate_limited: 429,
  internal_error: 500,
  upstream_error: 502,

  user_not_linked: 404,
  person_not_found: 404,
  club_not_found: 404,
  membership_not_found: 404,
  friendship_not_found: 404,
  intro_not_found: 404,
  search_not_found: 404,
  job_not_found: 404,

  invalid_code: 400,
  code_expired: 400,
  invalid_phone: 400,
  invalid_linkedin_url: 400,
  invalid_pdf: 400,
  pdf_too_large: 413,
  cannot_friend_self: 400,
  already_friends: 409,
  connector_not_in_search: 400,
  connector_not_user: 400,
  invalid_state: 409,
  nothing_to_confirm: 409,
  share_expired: 404,
  cas_failed: 401,
  dev_login_disabled: 403,
  demo_login_disabled: 403,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? code.replace(/_/g, " "));
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_CODES[code];
    this.details = details;
  }
}

export function errorBody(code: ErrorCode, message: string, details?: unknown) {
  return { error: { code, message, ...(details !== undefined ? { issues: details } : {}) } };
}

/**
 * What goes in the server log for an unexpected error. A failed database query
 * carries its SQL and bound parameters (phones, tokens, uploaded text) in both
 * its message and its stack, so for those only the driver's own reason is kept.
 */
export function describeForLog(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const isQueryError = "query" in err || "params" in err || err.message.startsWith("Failed query");
  if (isQueryError) {
    const cause = (err as { cause?: unknown }).cause;
    const reason = cause instanceof Error ? cause.message : "no cause given";
    return `database query failed: ${reason.slice(0, 300)}`;
  }
  return err.stack ?? err.message;
}

export function errorResponse(err: unknown, headers?: HeadersInit): Response {
  if (err instanceof AppError) {
    return Response.json(errorBody(err.code, err.message, err.details), {
      status: err.status,
      headers,
    });
  }
  if (err instanceof ZodError) {
    return Response.json(errorBody("invalid_request", "Request did not match the expected shape.", err.issues), {
      status: 400,
      headers,
    });
  }
  // Never leak internals. The message is logged without request bodies (privacy rule 11).
  console.error("[nepo] unhandled error:", describeForLog(err));
  return Response.json(errorBody("internal_error", "Something went wrong."), { status: 500, headers });
}
