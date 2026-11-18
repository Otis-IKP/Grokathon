/**
 * Wait for `work`, but no longer than `ms`. Resolves "done" or "timeout" and
 * never rejects; the caller handles the work's own errors. The work keeps
 * running after a timeout.
 */
export function settleWithin(work: Promise<unknown>, ms: number): Promise<"done" | "timeout"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), ms);
    const finish = () => {
      clearTimeout(timer);
      resolve("done");
    };
    work.then(finish, finish);
  });
}
