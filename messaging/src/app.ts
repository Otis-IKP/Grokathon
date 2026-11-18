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
import { sameSecret } from "./util/secret";
import { settleWithin } from "./util/settle";
import { openRequesterPhone } from "./util/draftToken";
import { claimOnce, releaseClaim, setStateStore } from "./state/store";

export { sameSecret };

/** How long a tap-to-send link works after the draft is saved. */
export const DRAFT_LINK_TTL_MS = 24 * 60 * 60 * 1000;

const introResponded = z.object({
  event: z.literal("intro.responded"),
  intro_id: z.string().min(1).max(100),
  decision: z.enum(["accept", "decline"]),
  requester_phone: z.string().min(5).max(20),
  // These two go straight into a text message, so they are capped.
  connector_first_name: z.string().min(1).max(60),
  club_name: z.string().min(1).max(120),
});

/** How long /webhooks/app waits for the text to go out before answering anyway. */
const APP_WEBHOOK_MAX_WAIT_MS = 10_000;
const SEEN_APP_EVENTS_CAP = 500;

export function createApp(options?: { backend?: Backend }): express.Express {
  const config = getConfig();
  const backend =
    options?.backend ??
    (config.BACKEND_MODE === "http"
      ? new HttpBackend(config.BACKEND_URL, config.BACKEND_API_SECRET)
      : new MockBackend(process.env));
  setBackend(backend);
  // With the real app behind it, the bot keeps its per-phone state there instead of in this process.
  setStateStore(backend instanceof HttpBackend ? backend : null);
  /** intro id + decision already texted, so a repeated delivery does not text the requester twice. */
  const seenAppEvents = new Set<string>();
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
    // In http mode the link carries the requester's phone, encrypted, so any instance can look the intro up.
    const token = typeof req.query.k === "string" ? req.query.k : "";
    const requesterPhone = token ? openRequesterPhone(req.params.introId, token, config.WEBHOOK_SECRET) : null;
    const intro = await backend.getIntro(req.params.introId, requesterPhone ?? undefined).catch(() => null);
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
   * Answers after the text has gone out, so a serverless function is not frozen first.
   */
  app.post("/webhooks/app", async (req, res) => {
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
    const event = parsed.data;
    const eventKey = `${event.intro_id}|${event.decision}`;
    // Seen by this instance, or claimed first by another one.
    if (seenAppEvents.has(eventKey) || !(await claimOnce(`app-webhook:${eventKey}`))) {
      res.json({ ok: true, duplicate: true });
      return;
    }
    seenAppEvents.add(eventKey);
    while (seenAppEvents.size > SEEN_APP_EVENTS_CAP) {
      const oldest = seenAppEvents.values().next().value;
      if (oldest === undefined) break;
      seenAppEvents.delete(oldest);
    }
    const notice =
      event.decision === "accept"
        ? `${event.connector_first_name} accepted your intro request for ${event.club_name}! They'll reach out.`
        : `${event.connector_first_name} can't make the intro right now. Want me to try your next-best path?`;
    let failed = false;
    const job = sendText(event.requester_phone, notice).catch((error: unknown) => {
      failed = true;
      // The text did not go out, so a repeat of this event should be allowed to try again.
      seenAppEvents.delete(eventKey);
      void releaseClaim(`app-webhook:${eventKey}`);
      const message = error instanceof Error ? error.message : "send failed";
      console.error(`app webhook text failed: ${message}`);
    });
    await settleWithin(job, APP_WEBHOOK_MAX_WAIT_MS);
    if (failed) {
      res.status(502).json({ error: "text failed" });
      return;
    }
    res.json({ ok: true });
  });
  mountWebchat(app);
  mountSendblue(app, handleMessage);
  return app;
}
