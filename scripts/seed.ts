import { main, runTask } from "./_run";

// `pnpm db:seed` loads the demo data; `pnpm db:seed --purge` removes every demo row.
main(() => runTask(process.argv.includes("--purge") ? "seed-purge" : "seed"));
