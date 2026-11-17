import dotenv from "dotenv";
import readline from "node:readline";
import { loadConfig } from "../src/config";
import { setBackend } from "../src/backend/Backend";
import { MockBackend } from "../src/backend/MockBackend";
import { handleMessage } from "../src/agent/handleMessage";
import { setOutboundObserver } from "../src/transport/sendblue";
import { normalizePhone } from "../src/util/phone";

dotenv.config();
process.env.DRY_RUN = "true";
process.env.BACKEND_MODE = "mock";
if (!process.env.WEBHOOK_SECRET) process.env.WEBHOOK_SECRET = "simulate-secret";
if (!process.env.XAI_API_KEY) {
  console.error("XAI_API_KEY is missing. Add it to messaging/.env from https://console.x.ai");
  process.exit(1);
}

loadConfig();
const backend = new MockBackend(process.env);
setBackend(backend);

const namesByPhone = new Map(backend.demoUsers().map((user) => [user.phone, user.name]));
setOutboundObserver((to, content) => {
  const name = namesByPhone.get(to) ?? to;
  console.log(`[to ${name}] ${content}`);
});

const rawPhone = process.argv[2];
if (!rawPhone) {
  console.error("Usage: npm run simulate -- +15550000001");
  process.exit(1);
}

const phone = normalizePhone(rawPhone);
const who = namesByPhone.get(phone) ?? phone;
console.log(`Texting NEPO as ${who} (${phone}). Type reset to clear. Ctrl-D to exit.`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
let chain = Promise.resolve();

rl.on("line", (line) => {
  chain = chain
    .then(async () => {
      if (!line.trim()) return;
      const replies = await handleMessage(phone, line);
      for (const reply of replies) console.log(reply);
      if (process.stdin.isTTY) rl.prompt();
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
    });
});

rl.on("close", () => {
  void chain.then(() => process.exit(0));
});

if (process.stdin.isTTY) rl.prompt();
