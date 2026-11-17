import { main, runTask } from "./_run";

// Queue a roster crawl for every club. `--force` ignores the per-club TTL.
// The jobs run in `pnpm worker` (or the cron tick in production).
main(() => runTask("crawl-clubs", { force: process.argv.includes("--force") }));
