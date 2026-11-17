import type { Db } from "@/server/db/client";
import { upsertFromDirectory } from "@/server/people/service";
import { yaliesPeople } from "./client";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Bulk import Yale College from Yalies into `people` (section 6.2). This is
 * what makes roster name matching possible; run it once before the demo.
 * Pages are 0-based. If the API rejects a page size, it is halved.
 */
export async function syncDirectory(
  db: Db,
  opts: { schoolCode?: string; pageSize?: number; maxPages?: number; delayMs?: number; log?: (msg: string) => void } = {},
): Promise<{ people: number; pages: number }> {
  let pageSize = opts.pageSize ?? 100;
  const maxPages = opts.maxPages ?? 500;
  let total = 0;
  let page = 0;
  let previousFirst: string | null = null;
  for (; page < maxPages; page++) {
    let batch;
    try {
      batch = await yaliesPeople({ filters: { school_code: [opts.schoolCode ?? "YC"] }, page, page_size: pageSize });
    } catch (err) {
      if (page === 0 && pageSize > 10) {
        pageSize = Math.floor(pageSize / 2);
        opts.log?.(`Page size rejected; retrying with ${pageSize}.`);
        page = -1;
        continue;
      }
      throw err;
    }
    if (batch.length === 0) break;
    // Guard against an API that ignores `page` and repeats the first page forever.
    if (previousFirst && batch[0].netid === previousFirst) break;
    previousFirst = batch[0].netid;
    for (const person of batch) await upsertFromDirectory(db, person);
    total += batch.length;
    opts.log?.(`Page ${page}: ${batch.length} people (${total} total).`);
    await sleep(opts.delayMs ?? 250);
  }
  return { people: total, pages: page };
}
