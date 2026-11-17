import "server-only";
import { getIronSession, type IronSession } from "iron-session";
import { cookies } from "next/headers";
import { env, requireEnv } from "@/server/env";

export type SessionData = { userId?: string; netid?: string; via?: "cas" | "dev" };

export const SESSION_COOKIE = "nepo_session";

export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), {
    password: requireEnv("SESSION_SECRET"),
    cookieName: SESSION_COOKIE,
    ttl: 60 * 60 * 24 * 30,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: env().APP_URL.startsWith("https://"),
      path: "/",
    },
  });
}
