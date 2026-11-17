/** Migrate and seed the e2e server's in-memory database through its dev task endpoint. */
export default async function globalSetup() {
  for (const task of ["migrate", "seed"]) {
    const res = await fetch("http://localhost:3100/api/internal/dev/task", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer e2e-cron-secret" },
      body: JSON.stringify({ task }),
    });
    if (!res.ok) throw new Error(`e2e setup: ${task} failed (${res.status}): ${await res.text()}`);
  }
}
