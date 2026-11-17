// Tests never hit the network (section 16): everything external is mocked.
process.env.MOCK_EXTERNAL = "1";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-test";
process.env.BOT_API_SECRET = "test-bot-secret";
process.env.CRON_SECRET = "test-cron-secret";
process.env.BOT_PHONE_DISPLAY = "+1 203 555 0100";
process.env.ADMIN_NETIDS = "admin1";
process.env.DEV_LOGIN_ENABLED = "1";
delete process.env.BOT_WEBHOOK_URL;
