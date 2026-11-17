import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import { z } from "zod";
import { handleMessage } from "../agent/handleMessage";

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");

const chatBody = z.object({
  phone: z.string().min(1),
  text: z.string(),
});

export function mountWebchat(app: Express): void {
  app.get("/", (_req, res) => {
    res.sendFile(path.join(publicDir, "chat.html"));
  });

  app.post("/chat", async (req, res) => {
    const parsed = chatBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Expected { phone, text }" });
      return;
    }
    const replies = await handleMessage(parsed.data.phone, parsed.data.text);
    res.json({ replies });
  });
}
