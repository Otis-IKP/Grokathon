import { timingSafeEqual } from "node:crypto";
import express from "express";
import { z } from "zod";
import { getConfig } from "./config";
import { setBackend, type Backend } from "./backend/Backend";
import { HttpBackend } from "./backend/HttpBackend";
import { MockBackend } from "./backend/MockBackend";
import { clearAllSessions } from "./agent/session";
import { handleMessage } from "./agent/handleMessage";
import { mountSendblue, sendText } from "./transport/sendblue";
import { mountWebchat } from "./transport/webchat";
import { smsLink } from "./util/smsLink";

/** How long a tap-to-send link works after the draft is saved. */
export const DRAFT_LINK_TTL_MS = 24 * 60 * 60 * 1000;

const introResponded = z.object({
  event: z.literal("intro.responded"),
  intro_id: z.string(),
  decision: z.enum(["accept", "decline"]),
  requester_phone: z.string().min(5),
  connector_first_name: z.string(),
  club_name: z.string(),
});

export function createApp(options?: { backend?: Backend }): express.Express {
  const config = getConfig();
  const backend =
    options?.backend ??
    (config.BACKEND_MODE === "http"
      ? new HttpBackend(config.BACKEND_URL, config.BACKEND_API_SECRET)
      : new MockBackend(process.env));
  setBackend(backend);
  const app = express();
  // On Vercel the bot is served under /bot (see vercel.json) and the prefix reaches us intact,
  // so strip it here. Locally there is no prefix and this is a no-op.
  app.use((req, _res, next) => {
    if (req.url === "/bot" || req.url.startsWith("/bot/") || req.url.startsWith("/bot?")) {
      req.url = req.url.slice(4) || "/";
      if (req.url.startsWith("?")) req.url = `/${req.url}`;
    }
    next();
  });
  app.use(express.json());
  app.get("/health", (_req, res) => {
    res.json({ ok: true, backend: config.BACKEND_MODE, dryRun: config.DRY_RUN });
  });
  app.post("/admin/reset", (req, res) => {
    const secret = typeof req.query.secret === "string" ? req.query.secret : "";
    if (!sameSecret(secret, config.WEBHOOK_SECRET)) {
      res.status(401).json({ error: "bad secret" });
      return;
    }
    clearAllSessions();
    if (backend instanceof MockBackend) backend.resetIntros();
    res.json({ ok: true });
  });
  /**
   * Tap-to-send: redirects to an iMessage draft addressed to the connector.
   * Works only while the intro is still a draft and for 24 hours, so a
   * forwarded link stops revealing the connector's number.
   */
  app.get("/d/:introId", async (req, res) => {
    const intro = await backend.getIntro(req.params.introId).catch(() => null);
    const live = intro && intro.status === "drafted" && Date.now() - intro.createdAt < DRAFT_LINK_TTL_MS;
    const phone = live ? await backend.getConnectorPhone(intro).catch(() => null) : null;
    if (!intro || !phone) {
      res.status(404).type("text/plain").send("Draft not found");
      return;
    }
    res.redirect(302, smsLink(phone, intro.message));
  });
  /**
   * The NEPO app calls this when a connector answers in the app, so the
   * requester still gets a text. Authenticated with the app's BOT_API_SECRET.
   */
  app.post("/webhooks/app", (req, res) => {
    const token = (req.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
    if (!config.BACKEND_API_SECRET || !sameSecret(token, config.BACKEND_API_SECRET)) {
      res.status(401).json({ error: "bad secret" });
      return;
    }
    const parsed = introResponded.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "unsupported event" });
      return;
    }
    res.json({ ok: true });
    const event = parsed.data;
    const notice =
      event.decision === "accept"
        ? `${event.connector_first_name} accepted your intro request for ${event.club_name}! They'll reach out.`
        : `${event.connector_first_name} can't make the intro right now. Want me to try your next-best path?`;
    sendText(event.requester_phone, notice).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "send failed";
      console.error(`app webhook text failed: ${message}`);
    });
  });
  mountWebchat(app);
  mountSendblue(app, handleMessage);
  return app;
}

export function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
