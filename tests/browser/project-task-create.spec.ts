import { expect, test, type Page } from "@playwright/test";

const projects = new WeakMap<Page, number>();
const views = ["list", "board", "timeline", "calendar"] as const;
test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: { email: "admin@example.com", password: "atlas-dev-2026" } })).status()).toBe(200);
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  const id = projects.get(page);
  if (id) { await page.goto("about:blank"); expect((await page.request.delete(`/api/projects/${id}`)).ok()).toBeTruthy(); }
});
async function fixture(page: Page, empty = false) {
  const res = await page.request.post("/api/projects", { data: { workspace_id: 1, name: `クイック追加検証 ${Date.now()}` } });
  expect(res.status()).toBe(201); const { id } = await res.json(); projects.set(page, id);
  const sections = await (await page.request.get(`/api/lookup?project_id=${id}`)).json() as { id: number; name: string }[];
  if (empty) for (const section of sections) expect((await page.request.delete(`/api/sections/${section.id}`)).ok()).toBeTruthy();
  return { id, sections: empty ? [] : sections };
}
async function tasks(page: Page, id: number) {
  return (await (await page.request.get(`/api/projects/${id}/export?format=json`)).json()).tasks as { id: number; name: string; section_id: number | null; start_on: string | null; due_on: string | null; is_milestone: boolean }[];
}
async function add(page: Page, view: string) {
  const input = page.getByRole("textbox", { name: "新しいタスク名", exact: true });
  // Wait for hydration using a harmless menu first, never repeat a mutating click.
  await expect(async () => {
    if (!await page.getByRole("menu", { name: "追加の種類" }).isVisible()) await page.getByRole("button", { name: "追加オプション" }).first().click();
    await expect(page.getByRole("menu", { name: "追加の種類" })).toBeVisible({ timeout: 500 });
  }).toPass();
  await page.keyboard.press("Escape");
  await page.locator(`[data-${view}-add]`).click();
  await expect(input).toBeFocused();
  return input;
}
for (const width of [1440, 390]) for (const view of views) test(`${view}: inserts immediately, inline name and persistence at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const f = await fixture(page);
  await page.goto(`/projects/${f.id}?view=${view}`);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/tasks", async route => { if (route.request().method() === "POST") await gate; await route.continue(); });
  const input = await add(page, view);
  try {
    await expect(page.getByRole("dialog", { name: "タスクを追加", exact: true })).toHaveCount(0);
    expect(await tasks(page, f.id)).toHaveLength(0);
    await input.fill("週次レビュー資料を準備");
    await page.screenshot({ path: test.info().outputPath(`${view}-quick-${width}.png`) });
    await input.press("Enter");
  } finally { release(); }
  await expect(input).toHaveCount(0);
  await expect.poll(async () => (await tasks(page, f.id))[0]?.name).toBe("週次レビュー資料を準備");
  const saved = await tasks(page, f.id); expect(saved).toHaveLength(1);
  expect(saved[0].section_id).toBe(f.sections[0].id);
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; });
  if (view === "timeline") {
    expect(saved[0].start_on).toBe(today);
    expect((Date.parse(saved[0].due_on!) - Date.parse(today)) / 86400000).toBe(4);
  } else expect(saved[0].due_on).toBe(view === "calendar" ? today : null);
  await expect(page.locator("[data-task-pane]")).toHaveCount(0);
  await page.reload(); expect(await tasks(page, f.id)).toEqual(saved);
});
for (const view of views) test(`${view}: abandoned blank composer makes no write and creates no empty task`, async ({ page }) => {
  const f = await fixture(page, true); await page.goto(`/projects/${f.id}?view=${view}`);
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/tasks")) posts += 1;
  });
  const input = await add(page, view);
  expect(posts).toBe(0);
  await input.press("Escape");
  await expect.poll(async () => (await tasks(page, f.id)).length).toBe(0);
  expect(posts).toBe(0);
  await page.reload();
  expect(await tasks(page, f.id)).toHaveLength(0);
});
test("four menu options create a milestone, section and approval setup", async ({ page }) => {
  const f = await fixture(page); await page.goto(`/projects/${f.id}?view=list`);
  await expect(async () => { await page.getByRole("button", { name: "追加オプション" }).click(); await expect(page.getByRole("menu")).toBeVisible({ timeout: 500 }); }).toPass();
  await expect(page.getByRole("menuitem")).toHaveText(["○タスク", "✓承認リクエスト", "◇マイルストーン", "☷セクション"]);
  await page.getByRole("menuitem", { name: "マイルストーン" }).click();
  await page.getByRole("textbox", { name: "新しいタスク名", exact: true }).fill("リリース判定");
  await page.getByRole("textbox", { name: "新しいタスク名", exact: true }).press("Enter");
  await expect.poll(async () => (await tasks(page, f.id))[0]?.name).toBe("リリース判定");
  const id = (await tasks(page, f.id))[0].id;
  await page.reload();
  await expect(page.locator(`[data-list-row="${id}"]`).getByRole("button", { name: "マイルストーンを完了にする" })).toBeVisible();
  await page.getByRole("button", { name: "追加オプション" }).click();
  await page.getByRole("menuitem", { name: "セクション" }).click();
  await page.getByRole("textbox", { name: "新しいセクション名" }).fill("リリース準備");
  await page.getByRole("textbox", { name: "新しいセクション名" }).press("Enter");
  await expect(page.getByRole("textbox", { name: "新しいセクション名" })).toHaveCount(0);
  await expect.poll(async () => (await (await page.request.get(`/api/lookup?project_id=${f.id}`)).json()).some((s: { name: string }) => s.name === "リリース準備")).toBe(true);
  await page.getByRole("button", { name: "追加オプション" }).click();
  await page.getByRole("menuitem", { name: "承認リクエスト" }).click();
  const approvalInput = page.getByRole("textbox", { name: "新しいタスク名", exact: true });
  await approvalInput.fill("リリース承認");
  await approvalInput.press("Enter");
  await expect(page).toHaveURL(/approval=1/);
  await expect(page.locator("[data-task-pane]")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "承認者", exact: true })).toBeVisible();
});
test("blank creation is rejected and failures retain typed text", async ({ page }) => {
  const f = await fixture(page);
  expect((await page.request.post("/api/tasks", { data: { project_id: f.id, name: "" } })).status()).toBe(400);
  expect((await page.request.post("/api/tasks", { data: { project_id: f.id, name: "   " } })).status()).toBe(400);
  await page.goto(`/projects/${f.id}?view=board`);
  await page.route("**/api/tasks", route => route.fulfill({ status: 503, json: { error: "unavailable" } }));
  const input = await add(page, "board"); await input.fill("通信失敗中のアイデア"); await input.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "追加を確認" })).toContainText("追加を確認できませんでした");
  await expect(input).toHaveValue("通信失敗中のアイデア");
  expect(await tasks(page, f.id)).toHaveLength(0);
});
test("timeline creates today even when viewing a historical range", async ({ page }) => {
  const f = await fixture(page); await page.goto(`/projects/${f.id}?view=timeline&from=2020-01-01`);
  const input = await add(page, "timeline"); await expect(input).toBeInViewport();
  await input.fill("今日からの作業"); await input.press("Enter");
  await expect.poll(async () => (await tasks(page, f.id))[0]?.name).toBe("今日からの作業");
  expect((await tasks(page, f.id))[0].start_on).not.toBe("2020-01-01");
});
test("timeline click creation keeps the draft and task in the clicked lane", async ({ page }) => {
  const f = await fixture(page, true);
  const sectionRes = await page.request.post("/api/sections", { data: { project_id: f.id, name: "行指定セクション" } });
  expect(sectionRes.status()).toBe(201);
  const { id: sectionId } = await sectionRes.json() as { id: number };
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  for (const name of ["行A", "行B"]) {
    const created = await page.request.post("/api/tasks", {
      data: { project_id: f.id, section_id: sectionId, name, start_on: today, due_on: today },
    });
    expect(created.status()).toBe(201);
  }
  await page.goto(`/projects/${f.id}?view=timeline`);
  await page.waitForSelector("[data-timeline-canvas]");
  const group = page.locator(`[data-timeline-group="${sectionId}"]`);
  const draft = page.locator("[data-timeline-draft]");
  const scroll = page.locator(".timeline-scroll");
  await expect(async () => {
    const box = await group.boundingBox();
    const viewport = await scroll.boundingBox();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    await page.mouse.click(viewport!.x + viewport!.width * 0.7, box!.y + 60);
    await expect(draft).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
  expect(await draft.evaluate((el) => (el as HTMLElement).style.top)).toBe("40px");
  const input = page.getByRole("textbox", { name: "新しいタスク名", exact: true });
  await input.fill("クリック行のタスク");
  const posted = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/tasks" &&
    response.request().method() === "POST" && response.status() === 201);
  const pinned = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/timeline-row") &&
    response.request().method() === "PUT" && response.status() === 200);
  await input.press("Enter");
  const { id } = await (await posted).json() as { id: number };
  await pinned;
  const bar = page.locator(`[data-timeline-bar="${id}"]`);
  await expect(bar).toHaveAttribute("data-timeline-lane", "1");
  await expect(bar).toHaveAttribute("data-timeline-row-locked", "true");
  await expect(bar).toContainText("クリック行のタスク");
});
for (const view of views) test(`${view}: new task stays visible under completed-only filtering`, async ({ page }) => {
  const f = await fixture(page); await page.goto(`/projects/${f.id}?view=${view}&completed_only=1&completed=done`);
  const input = await add(page, view); await expect(input).toBeInViewport();
  await input.fill("フィルター中に追加"); await input.press("Enter");
  await expect.poll(async () => (await tasks(page, f.id))[0]?.name).toBe("フィルター中に追加");
});
test("create failure retries from the same composer without duplicate creation", async ({ page }) => {
  const f = await fixture(page); await page.goto(`/projects/${f.id}?view=list`);
  let attempts = 0;
  await page.route("**/api/tasks", route => {
    if (route.request().method() === "POST" && ++attempts === 1) return route.fulfill({ status: 503, json: { error: "test" } });
    return route.continue();
  });
  const input = await add(page, "list"); await input.fill("再試行で保存"); await input.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "追加を確認できませんでした" })).toBeVisible();
  await expect(input).toHaveValue("再試行で保存");
  await input.press("Enter"); await expect(input).toHaveCount(0);
  await expect.poll(async () => (await tasks(page, f.id))[0]?.name).toBe("再試行で保存");
  expect(await tasks(page, f.id)).toHaveLength(1);
});
test("calendar returns to today from another month when adding", async ({ page }) => {
  const f = await fixture(page); await page.goto(`/projects/${f.id}?view=calendar&month=2020-01&weekends=0`);
  const input = await add(page, "calendar"); await expect(input).toBeInViewport();
  await input.fill("今日のアイデア"); await input.press("Enter");
  await expect.poll(async () => (await tasks(page, f.id))[0]?.name).toBe("今日のアイデア");
  expect(new URL(page.url()).searchParams.get("month")).not.toBe("2020-01");
});
test("viewers cannot quick-create tasks from any view or the API", async ({ page, browser }) => {
  const f = await fixture(page);
  expect((await page.request.post(`/api/projects/${f.id}/members`, { data: { user_id: 2, role: "viewer" } })).status()).toBe(201);
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    expect((await context.request.post("/api/auth/login", { data: { email: "tanaka@example.com", password: "atlas-dev-2026" } })).status()).toBe(200);
    const actor = await context.newPage();
    for (const view of views) {
      await actor.goto(`/projects/${f.id}?view=${view}`);
      await expect(actor.locator(`[data-${view}-add]`)).toBeDisabled();
      await expect(actor.getByRole("button", { name: "追加オプション" }).first()).toBeDisabled();
    }
    expect((await context.request.post("/api/tasks", { data: { project_id: f.id, name: "viewer attempt" } })).status()).toBe(403);
    expect(await tasks(page, f.id)).toHaveLength(0);
  } finally { await context.close(); }
});
test("quick list composer uses the row highlight instead of an input outline", async ({ page }) => {
  const f = await fixture(page); await page.goto(`/projects/${f.id}?view=list`);
  const input = await add(page, "list");
  expect(await input.evaluate((el) => getComputedStyle(el).borderWidth)).toBe("0px");
  expect(await page.locator("[data-list-row]").last().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--atlas-accent-soft)";
    document.body.append(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  }));
  await input.press("Escape");
});

test("blurring an empty list composer performs no write", async ({ page }) => {
  const f = await fixture(page); await page.goto(`/projects/${f.id}?view=list`);
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/tasks")) posts += 1;
  });
  const input = await add(page, "list");
  await page.getByRole("button", { name: "フィルター", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(input).toHaveCount(0);
  expect(posts).toBe(0);
  expect(await tasks(page, f.id)).toHaveLength(0);
});

test("context menu deletes a quick card immediately without confirmation and it stays gone", async ({ page }) => {
  const f = await fixture(page); await page.goto(`/projects/${f.id}?view=board`);
  const input = await add(page, "board");
  await input.fill("削除するクイックカード"); await input.press("Enter");
  const saved = await tasks(page, f.id);
  expect(saved).toHaveLength(1);
  const card = page.locator(`[data-board-card="${saved[0].id}"]`);
  await expect(card).toBeVisible();
  await expect.poll(async () => page.evaluate(() =>
    document.querySelector("[data-task-context-menu-host]")?.getAttribute("data-task-count"),
  )).toBe("1");
  await card.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, view: window,
      clientX: rect.x + 40, clientY: rect.y + 30, button: 2, buttons: 2,
    }));
  });
  const menu = page.locator("[data-task-context-menu]");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "タスクを削除" }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator("[data-confirm-message]")).toHaveCount(0);
  await expect(card).toHaveCount(0);
  await expect(page.locator("[data-toast]")).toContainText("タスクを削除しました");
  await expect.poll(async () => (await tasks(page, f.id)).length).toBe(0);
  await page.reload();
  await expect(page.locator("[data-board-view]")).toBeVisible();
  await expect(page.locator(`[data-board-card="${saved[0].id}"]`)).toHaveCount(0);
});

test("deleted task can be restored with Ctrl+Z and with the toast action", async ({ page }) => {
  const f = await fixture(page); await page.goto(`/projects/${f.id}?view=board`);
  const input = await add(page, "board");
  await input.fill("元に戻すカード"); await input.press("Enter");
  const saved = await tasks(page, f.id);
  expect(saved).toHaveLength(1);
  const card = page.locator(`[data-board-card="${saved[0].id}"]`);
  const deleteCard = async () => {
    await card.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, view: window,
        clientX: rect.x + 40, clientY: rect.y + 30, button: 2, buttons: 2,
      }));
    });
    const menu = page.locator("[data-task-context-menu]");
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "タスクを削除" }).click();
    await expect(card).toHaveCount(0);
  };
  await expect.poll(async () => page.evaluate(() =>
    document.querySelector("[data-task-context-menu-host]")?.getAttribute("data-task-count"),
  )).toBe("1");
  await deleteCard();
  await expect(page.locator("[data-toast]")).toContainText("タスクを削除しました");
  await expect(page.locator("[data-toast-action]")).toHaveText("元に戻す");
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await tasks(page, f.id)).length).toBe(1);
  await expect(card).toBeVisible();
  await expect.poll(async () => page.evaluate(() =>
    document.querySelector("[data-task-context-menu-host]")?.getAttribute("data-task-count"),
  )).toBe("1");
  await deleteCard();
  await page.locator("[data-toast-action]").click();
  await expect.poll(async () => (await tasks(page, f.id)).length).toBe(1);
  await expect(card).toBeVisible();
});

test("quick task stays at the end after persistence without moving existing tasks", async ({ page }) => {
  const f = await fixture(page);
  for (const name of ["既存タスクA", "既存タスクB"]) expect((await page.request.post("/api/tasks", { data: { project_id: f.id, section_id: f.sections[0].id, name } })).status()).toBe(201);
  const before = await tasks(page, f.id);
  await page.goto(`/projects/${f.id}?view=list`);
  const input = await add(page, "list"); await input.fill("末尾のアイデア"); await input.press("Enter");
  await expect.poll(async () => (await tasks(page, f.id)).at(-1)?.name).toBe("末尾のアイデア");
  await page.reload();
  expect((await tasks(page, f.id)).slice(0, -1)).toEqual(before);
  await expect(page.locator("[data-list-row]").last()).toContainText("末尾のアイデア");
});
