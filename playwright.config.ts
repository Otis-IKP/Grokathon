import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;

/**
 * One end-to-end happy path (the demo script in section 2), on a phone-sized
 * viewport. It starts its own dev server on port 3100 with an in-memory
 * database and every external service mocked, so it never touches your local
 * data and can run while `pnpm dev` is up.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: BASE,
    ...devices["iPhone 13"],
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: `${BASE}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_DIST_DIR: ".next-e2e",
      DATABASE_URL: "pglite://memory",
      APP_URL: BASE,
      SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e-secret",
      BOT_API_SECRET: "e2e-bot-secret",
      CRON_SECRET: "e2e-cron-secret",
      BOT_PHONE_DISPLAY: "+1 203 555 0100",
      ADMIN_NETIDS: "demo_maya",
      MOCK_EXTERNAL: "1",
      DEV_LOGIN_ENABLED: "1",
    },
  },
});
