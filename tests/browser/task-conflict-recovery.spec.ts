import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const fixtures = new WeakMap<Page, { projectId: number; other: BrowserContext }>();

test.afterEach(async ({ page }, info) => {
  info.setTimeout(15_000);
  const fixture = fixtures.get(page);
  if (!fixture) return;
  await fixture.other.close();
  const response = await page.request.delete(`/api/projects/${fixture.projectId}`);
  if (info.status === info.expectedStatus) expect(response.status()).toBe(200);
});

async function fixture(page: Page, other: BrowserContext) {
  const credentials = { email: process.env.E2E_EMAIL ?? "admin@example.com", password: process.env.E2E_PASSWORD ?? "atlas-dev-2026" };
  expect((await page.request.post("/api/auth/login", { data: credentials })).status()).toBe(200);
  const project = await page.request.post("/api/projects", { data: { workspace_id: 1, name: `Conflict recovery ${test.info().testId}` } });
  expect(project.status()).toBe(201);
  const { id: projectId } = await project.json() as { id: number };
  fixtures.set(page, { projectId, other });
  expect((await page.request.post(`/api/projects/${projectId}/members`, { data: { user_id: 2, role: "editor" } })).status()).toBe(201);
  expect((await other.request.post("/api/auth/login", { data: { email: "tanaka@example.com", password: credentials.password } })).status()).toBe(200);
  const created = await page.request.post("/api/tasks", { data: { project_id: projectId, name: "Original title", progress: 10 } });
  expect(created.status()).toBe(201);
  const { id: taskId } = await created.json() as { id: number };
  await page.goto(`/projects/${projectId}?view=list&task=${taskId}`);
  await expect(page.locator("[data-task-pane]")).toBeVisible();
  await expect(page.locator('[data-task-draft-field="name"]')).toHaveAttribute("data-task-draft-ready", "true");
  return { projectId, taskId };
}

async function readTask(page: Page, projectId: number, taskId: number) {
  const response = await page.request.get(`/api/projects/${projectId}/export?format=json`);
  expect(response.status()).toBe(200);
  const data = await response.json() as { tasks: { id: number; name: string; progress: number }[] };
  return data.tasks.find((task) => Number(task.id) === taskId)!;
}

async function holdRefresh(page: Page, projectId: number) {
  let resume!: () => void;
  let holding = true;
  const gate = new Promise<void>((resolve) => { resume = resolve; });
  const pattern = `**/projects/${projectId}?*`;
  await page.route(pattern, async (route) => {
    if (holding && route.request().headers().rsc === "1") await gate;
    await route.continue();
  });
  return async () => {
    holding = false;
    resume();
    // Wait for released handlers before removing them. Plain unroute can mark
    // held requests handled while their continuation is still pending.
    await page.unrouteAll({ behavior: "wait" });
  };
}

for (const field of ["name", "progress"] as const) {
  test(`EV02 discarding ${field} restores the current value before refresh and never resaves the discarded edit`, async ({ page, browser }) => {
    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const { projectId, taskId } = await fixture(page, other);
    const pane = page.locator("[data-task-pane]");
    const input = pane.locator(`[data-task-draft-field="${field}"]`);
    const latest = field === "name" ? "A newer colleague title" : 70;
    const attempted = field === "name" ? "An edit to discard" : 25;
    const release = await holdRefresh(page, projectId);
    const writes: number[] = [];
    page.on("response", (response) => {
      if (response.url().endsWith(`/api/tasks/${taskId}`) && response.request().method() === "PATCH") writes.push(response.status());
    });
    try {
      expect((await other.request.patch(`/api/tasks/${taskId}`, { data: { [field]: latest } })).status()).toBe(200);
      await input.fill(String(attempted));
      const conflict = page.waitForResponse((response) => response.url().endsWith(`/api/tasks/${taskId}`) && response.status() === 409);
      await input.blur();
      await conflict;
      const discard = pane.getByRole("button", { name: "破棄して最新表示", exact: true });
      await expect(discard).toBeVisible();
      // Refocusing the failed draft and clicking discard must not issue another
      // blur-save before the recovery action runs.
      await input.focus();
      await discard.click();
      await expect(input).toHaveValue(String(latest));
      await input.focus();
      await input.blur();
      expect(writes).toEqual([409]);
    } finally {
      await release();
    }
    await expect(input).toHaveValue(String(latest));
    await input.focus();
    await input.blur();
    await expect(async () => expect((await readTask(page, projectId, taskId))[field]).toBe(latest)).toPass();
    expect(writes).toEqual([409]);
    // A genuinely new edit after recovery still saves normally.
    const intended = field === "name" ? "Intentional edit after discard" : 80;
    await input.fill(String(intended));
    const saved = page.waitForResponse((response) => response.url().endsWith(`/api/tasks/${taskId}`) && response.request().method() === "PATCH" && response.status() === 200);
    await input.blur();
    await saved;
    await expect(async () => expect((await readTask(page, projectId, taskId))[field]).toBe(intended)).toPass();
  });
}

test("EV02 live refresh preserves a focused draft and its original lock version", async ({ page, browser }) => {
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const { projectId, taskId } = await fixture(page, other);
  const pane = page.locator("[data-task-pane]");
  const input = pane.getByRole("textbox", { name: "タスク名", exact: true });
  await input.fill("Draft while the colleague edits");
  const element = await input.elementHandle();
  const refreshed = page.waitForResponse((response) => response.request().headers().rsc === "1" && new URL(response.url()).pathname === `/projects/${projectId}`);
  expect((await other.request.patch(`/api/tasks/${taskId}`, { data: { progress: 65 } })).status()).toBe(200);
  await refreshed;
  await expect(pane.getByRole("spinbutton", { name: "進捗", exact: true })).toHaveValue("65");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Draft while the colleague edits");
  expect(await input.evaluate((node, previous) => node === previous, element)).toBe(true);
  const conflict = page.waitForResponse((response) => response.url().endsWith(`/api/tasks/${taskId}`) && response.status() === 409);
  await input.blur();
  await conflict;
  expect((await readTask(page, projectId, taskId)).name).toBe("Original title");
  await pane.getByRole("button", { name: "破棄して最新表示", exact: true }).click();
  await expect(input).toHaveValue("Original title");
});

for (const field of ["name", "progress"] as const) {
  test(`EV02 normalized ${field} is acknowledged without a second blur write or self-conflict`, async ({ page, browser }) => {
    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const { projectId, taskId } = await fixture(page, other);
    const pane = page.locator("[data-task-pane]");
    const input = pane.locator(`[data-task-draft-field="${field}"]`);
    const raw = field === "name" ? "  Trimmed title  " : "150";
    const normalized = field === "name" ? "Trimmed title" : "100";
    const writes: number[] = [];
    page.on("response", (response) => {
      if (response.url().endsWith(`/api/tasks/${taskId}`) && response.request().method() === "PATCH") writes.push(response.status());
    });
    const previousVersion = await input.getAttribute("data-task-draft-version");
    await input.fill(raw);
    const saved = page.waitForResponse((response) => response.url().endsWith(`/api/tasks/${taskId}`) && response.request().method() === "PATCH");
    await input.blur();
    expect((await saved).status()).toBe(200);
    await expect(input).toHaveValue(normalized);
    await expect(async () => expect(String((await readTask(page, projectId, taskId))[field])).toBe(normalized)).toPass();
    // Normalization is immediate, but it does not acknowledge the save's lock version.
    // Wait for the server refresh to reach the editor before testing a second blur.
    await expect(input).not.toHaveAttribute("data-task-draft-version", previousVersion!);
    await input.focus();
    await input.blur();
    await expect(pane.getByRole("button", { name: "破棄して最新表示", exact: true })).toHaveCount(0);
    expect(writes).toEqual([200]);
  });
}
