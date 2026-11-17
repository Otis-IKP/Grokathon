import { expect, test, type Browser, type Page } from "@playwright/test";

const BOT = { Authorization: "Bearer e2e-bot-secret" };

async function signIn(browser: Browser, netid: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel(/Development sign-in/).fill(netid);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return page;
}

test("signed-out visitors are sent to sign in, and can read the privacy page", async ({ page }) => {
  await page.goto("/clubs/ysig");
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByRole("link", { name: "Sign in with Yale" })).toHaveAttribute("href", /\/api\/auth\/cas\/login/);
  await page.getByRole("link", { name: /What NEPO knows/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: /how to remove yourself/i })).toBeVisible();
});

test("the demo: sign in, link phone, add a friend, LinkedIn clubs, find a path, ask, accept", async ({ browser, request }) => {
  // 1. A new student signs in. Name, college and class year are already filled in from the directory.
  const bea = await signIn(browser, "bo107");
  await expect(bea).toHaveURL(/\/onboarding/);
  await expect(bea.getByText("Bea Okafor")).toBeVisible();
  await expect(bea.getByText(/Pierson/).first()).toBeVisible();
  await bea.getByRole("button", { name: /Looks right/ }).click();

  // 2. She links her phone by texting the 6-digit code to the NEPO number (the bot calls link-phone).
  const codeText = await bea.getByText(/^\d{6}$/).first().textContent();
  expect(codeText).toMatch(/^\d{6}$/);
  const linked = await request.post("/api/bot/link-phone", { headers: BOT, data: { phone: "+12035550177", code: codeText } });
  expect(linked.ok()).toBe(true);
  await expect(bea.getByText(/Phone linked/i)).toBeVisible({ timeout: 10_000 });

  // 3. Maya searches the directory for Bea and adds her; Bea accepts on her phone.
  const maya = await signIn(browser, "demo_maya");
  await maya.goto("/friends?tab=find");
  await maya.getByLabel("Search the Yale directory by name").fill("Bea Okafor");
  await maya.getByRole("button", { name: "Add Bea Okafor" }).click();
  await expect(maya.getByText("Requested")).toBeVisible();

  await bea.goto("/friends?tab=requests");
  await expect(bea.getByText("Maya Chen")).toBeVisible();
  await Promise.all([
    bea.waitForResponse((res) => /\/api\/friends\/.+\/accept$/.test(res.url()) && res.ok()),
    bea.getByRole("button", { name: "Accept", exact: true }).click(),
  ]);
  await bea.goto("/friends?tab=friends");
  await expect(bea.getByText("Maya Chen")).toBeVisible();

  // 4. Maya pastes her LinkedIn URL; her clubs appear with verified / self-reported badges.
  await maya.goto("/me");
  await maya.getByPlaceholder("linkedin.com/in/your-name").fill("https://www.linkedin.com/in/demo-maya-chen");
  await maya.getByRole("button", { name: "Read", exact: true }).click();
  await expect(maya.getByText("Yale Daily News").first()).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    await maya.reload();
    await expect(maya.getByText("Verified").first()).toBeVisible({ timeout: 2_000 });
    await expect(maya.getByText("Self-reported").first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });

  // 5. "I want to be on YSIG": two warm paths, Jordan first, then Priya through Sam.
  await maya.goto("/");
  await maya.getByRole("combobox").fill("ysig");
  await maya.getByRole("option", { name: /Yale Student Investment Group/ }).click();
  await expect(maya).toHaveURL(/\/paths\//);
  await expect(maya.getByText("Jordan is your friend and a YSIG analyst (confirmed on the club's site).")).toBeVisible();
  await expect(maya.getByText("Priya is your friend and is friends with Sam Wu, YSIG's president.")).toBeVisible();
  const asks = await maya.getByRole("button", { name: /^Ask / }).allTextContents();
  expect(asks.slice(0, 2)).toEqual(["Ask Jordan", "Ask Priya"]);

  // 6. NEPO drafts a message to Jordan; Maya sends it through NEPO.
  await maya.getByRole("button", { name: "Ask Jordan" }).click();
  const draft = maya.getByRole("textbox");
  await expect(draft).toHaveValue(/Jordan[\s\S]*YSIG/, { timeout: 15_000 });
  await maya.getByRole("button", { name: "Send through NEPO" }).click();
  await expect(maya).toHaveURL(/\/intros\//);

  // The intro appears in Jordan's inbox; he taps Accept.
  const jordan = await signIn(browser, "demo_jordan");
  await jordan.goto("/intros");
  await expect(jordan.getByText("Maya Chen").first()).toBeVisible();
  await Promise.all([
    jordan.waitForResponse((res) => /\/api\/intros\/.+\/respond$/.test(res.url()) && res.ok()),
    jordan.getByRole("button", { name: "Accept", exact: true }).first().click(),
  ]);
  await expect(jordan.getByText(/What next/).first()).toBeVisible();

  // Maya sees it was accepted.
  await maya.goto("/intros?box=outgoing");
  await expect(maya.getByText("Accepted").first()).toBeVisible();

  // 7. The path can be shared as a graph for the website: first names and last initials only.
  const paths = await maya.request.post("/api/paths", { data: { club_text: "ysig" } });
  const { search_id } = await paths.json();
  const share = await (await maya.request.post(`/api/paths/${search_id}/share`)).json();
  const graph = await (await request.get(`/api/public/graph/${share.share_token}`)).json();
  const labels = graph.nodes.map((n: { label: string }) => n.label);
  expect(labels).toEqual(expect.arrayContaining(["YSIG", "Maya C.", "Jordan L.", "Priya K.", "Sam W."]));
});
