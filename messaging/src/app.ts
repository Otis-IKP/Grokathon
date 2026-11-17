import express from "express";
import { getConfig } from "./config";
import { setBackend, type Backend } from "./backend/Backend";
import { HttpBackend } from "./backend/HttpBackend";
import { MockBackend } from "./backend/MockBackend";
import { clearAllSessions } from "./agent/session";
import { handleMessage } from "./agent/handleMessage";
import { mountSendblue } from "./transport/sendblue";
import { mountWebchat } from "./transport/webchat";
import { smsLink } from "./util/smsLink";

export function createApp(options?: { backend?: Backend }): express.Express {
  const config = getConfig();
  const backend =
    options?.backend ??
    (config.BACKEND_MODE === "http" ? new HttpBackend(config.BACKEND_URL) : new MockBackend(process.env));
  setBackend(backend);
  const app = express();
  app.use(express.json());
  app.get("/health", (_req, res) => {
    res.json({ ok: true, backend: config.BACKEND_MODE, dryRun: config.DRY_RUN });
  });
  app.post("/admin/reset", (req, res) => {
    const secret = typeof req.query.secret === "string" ? req.query.secret : "";
    if (secret !== config.WEBHOOK_SECRET) {
      res.status(401).json({ error: "bad secret" });
      return;
    }
    clearAllSessions();
    if (backend instanceof MockBackend) backend.resetIntros();
    res.json({ ok: true });
  });
  app.get("/d/:introId", async (req, res) => {
    const intro = await backend.getIntro(req.params.introId);
    const phone = intro ? await backend.getUserPhone(intro.connectorId) : null;
    if (!intro || !phone) {
      res.status(404).type("text/plain").send("Draft not found");
      return;
    }
    res.redirect(302, smsLink(phone, intro.message));
  });
  mountWebchat(app);
  mountSendblue(app, handleMessage);
  return app;
}
