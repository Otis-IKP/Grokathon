import { main, runTask } from "./_run";

// Bulk import Yale College from Yalies into `people`. Needs YALIES_API_KEY (or MOCK_EXTERNAL=1).
main(() => runTask("sync-directory"));
