import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import { z } from "zod";
import { getConfig } from "../config";
import { handleMessage } from "../agent/handleMessage";
import { sameSecret } from "../util/secret";

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");

const chatBody = z.object({
  phone: z.string().min(1),
  text: z.string(),
});

/**
 * Browser test chat. POST /chat acts as any phone and can trigger real texts,
 * so it needs WEBHOOK_SECRET as ?secret=. Open the page as /?secret=... and it
 * passes the secret along.
 */
export function mountWebchat(app: Express): void {
  app.get("/", (_req, res) => {
    res.sendFile(path.join(publicDir, "chat.html"));
  });

  app.post("/chat", async (req, res) => {
    const secret = typeof req.query.secret === "string" ? req.query.secret : "";
    if (!sameSecret(secret, getConfig().WEBHOOK_SECRET)) {
      res.status(401).json({ error: "bad secret" });
      return;
    }
    const parsed = chatBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Expected { phone, text }" });
      return;
    }
    const replies = await handleMessage(parsed.data.phone, parsed.data.text);
    res.json({ replies });
  });
}
