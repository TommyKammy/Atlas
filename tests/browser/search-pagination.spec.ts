import { expect, test, type Page } from "@playwright/test";

const projects = new WeakMap<Page, number[]>();
const searches = new WeakMap<Page, number[]>();

test.afterEach(async ({ page }, info) => {
  info.setTimeout(20_000);
  for (const [kind, ids] of [["saved-searches", searches.get(page) ?? []], ["projects", projects.get(page) ?? []]] as const) {
    for (const id of ids) {
      try {
        expect((await page.request.delete(`/api/${kind}/${id}`, { timeout: 10_000 })).status()).toBe(200);
      } catch (error) {
        if (info.status === info.expectedStatus) throw error;
        info.annotations.push({ type: "cleanup", description: String(error) });
      }
    }
  }
});

async function fixture(page: Page) {
  const login = await page.request.post("/api/auth/login", { data: {
    email: process.env.E2E_EMAIL ?? "admin@example.com", password: process.env.E2E_PASSWORD ?? "atlas-dev-2026",
  } });
  expect(login.ok()).toBeTruthy();
  const prefix = `EV09 ${test.info().testId.slice(0, 30)} ${Date.now()}`;
  const response = await page.request.post("/api/projects", { data: { workspace_id: 1, name: prefix } });
  expect(response.status()).toBe(201);
  const { id } = await response.json() as { id: number };
  projects.set(page, [...projects.get(page) ?? [], id]);
  return { id, prefix };
}

async function ids(page: Page, kind: string) {
  return page.locator(`[data-search-section="${kind}"] [data-search-result-id]`).evaluateAll((rows) =>
    rows.map((row) => Number(row.getAttribute("data-search-result-id"))));
}

test("EV09 full search reaches every task, preserves filters and saves criteria without page position", async ({ page }) => {
  test.setTimeout(90_000);
  const f = await fixture(page);
  const keyword = `${f.prefix} task`;
  const cell = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const fieldName = `${f.prefix} Field`;
  const createdField = await page.request.post("/api/custom-fields", { data: { project_id: f.id, name: fieldName, field_type: "text" } });
  expect(createdField.status()).toBe(201);
  const csv = [["セクション", "種別", "名前", "完了", "担当者", "開始日", "期日", "進捗", "Status", "繰返し", "コメント", fieldName],
    ...Array.from({ length: 205 }, (_, n) => ["EV09", "タスク", `${keyword} ${n}`, "未完了", "", "", "2026-11-11", "0", "inbox", "", "", "Keep"]),
  ].map((row) => row.map(cell).join(",")).join("\n");
  const imported = await page.request.post(`/api/projects/${f.id}/import`, {
    multipart: { file: { name: "ev09.csv", mimeType: "text/csv", buffer: Buffer.from(csv) } }, timeout: 45_000,
  });
  expect(imported.status()).toBe(201);
  expect(await imported.json()).toMatchObject({ created: 205, skipped: 0 });
  const fieldResponse = await page.request.get(`/api/custom-fields?project_id=${f.id}`);
  expect(fieldResponse.ok()).toBeTruthy();
  const field = (await fieldResponse.json() as { id: number; name: string }[]).find((item) => item.name === fieldName);
  expect(field).toBeDefined();
  const filter = { q: keyword, project: String(f.id), completed: "open", assignee: "none", from: "2026-11-11", to: "2026-11-11", [`cf_${field!.id}`]: "Keep" };
  await page.goto(`/search?${new URLSearchParams(filter)}`);
  const section = page.locator('[data-search-section="tasks"]');
  const pager = page.locator('[data-search-pagination="tasks_page"]');
  await expect(section).toHaveAttribute("data-search-section-total", "205");
  const first = await ids(page, "tasks");
  expect(first).toHaveLength(100);
  await pager.getByRole("link", { name: /^次へ\s*（タスク）$/ }).focus();
  await page.keyboard.press("Enter");
  await expect(pager.locator("[data-search-current-page]")).toHaveText("2 / 3ページ");
  const second = await ids(page, "tasks");
  expect(second).toHaveLength(100);
  for (const [key, value] of Object.entries(filter)) expect(new URL(page.url()).searchParams.get(key)).toBe(value);
  await pager.locator('[data-search-page="next"]').click();
  await expect(pager.locator("[data-search-range]")).toHaveText("201–205 / 205件");
  const third = await ids(page, "tasks");
  expect(third).toHaveLength(5);
  expect(new Set([...first, ...second, ...third]).size).toBe(205);
  await expect(pager.locator('[data-search-page="next"]')).toHaveCount(0);

  const name = `${f.prefix} saved criteria`;
  page.once("dialog", (dialog) => void dialog.accept(name));
  const saving = page.waitForResponse((res) => new URL(res.url()).pathname === "/api/saved-searches" && res.request().method() === "POST");
  await page.locator("[data-saved-search-save]").click();
  const saved = await saving;
  expect(saved.status()).toBe(201);
  expect(saved.request().postDataJSON().params).toEqual(filter);
  const { id: savedId } = await saved.json() as { id: number };
  searches.set(page, [savedId]);
  const apply = page.locator(`[data-saved-search-apply="${savedId}"]`);
  await expect(apply).toBeVisible();
  await apply.click();
  await expect(pager.locator("[data-search-range]")).toHaveText("1–100 / 205件");
  expect(new URL(page.url()).searchParams.has("tasks_page")).toBe(false);
  expect(await ids(page, "tasks")).toEqual(first);
});

test("EV09 message pagination exposes the real total and keeps other result sections on their own page", async ({ page }) => {
  test.setTimeout(60_000);
  const f = await fixture(page);
  const keyword = `${f.prefix} message`;
  for (let i = 0; i < 21; i++) {
    const response = await page.request.post("/api/messages", { data: { project_id: f.id, title: `${keyword} ${i}`, body: "EV09 pagination fixture" } });
    expect(response.status()).toBe(201);
  }
  await page.goto(`/search?${new URLSearchParams({ q: keyword, projects_page: "2" })}`);
  const section = page.locator('[data-search-section="messages"]');
  const pager = page.locator('[data-search-pagination="messages_page"]');
  await expect(section).toHaveAttribute("data-search-section-total", "21");
  await expect(page.locator("[data-search-total]")).toHaveAttribute("data-search-total", "21");
  const first = await ids(page, "messages");
  expect(first).toHaveLength(20);
  await pager.locator('[data-search-page="next"]').click();
  await expect(pager.locator("[data-search-range]")).toHaveText("21–21 / 21件");
  const last = await ids(page, "messages");
  expect(last).toHaveLength(1);
  expect(first).not.toContain(last[0]);
  expect(new URL(page.url()).searchParams.get("projects_page")).toBe("2");
  await page.reload();
  expect(await ids(page, "messages")).toEqual(last);
  await pager.locator('[data-search-page="previous"]').click();
  await expect(pager.locator("[data-search-range]")).toHaveText("1–20 / 21件");
  expect(await ids(page, "messages")).toEqual(first);
});
