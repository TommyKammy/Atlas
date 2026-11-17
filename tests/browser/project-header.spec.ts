import { expect, test, type Page } from "@playwright/test";

const credentials = { email: "admin@example.com", password: "atlas-dev-2026" };
const fixtures = new WeakMap<Page, number>();

test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: credentials })).status()).toBe(200);
});

test.afterEach(async ({ page }) => {
  const id = fixtures.get(page);
  if (id) {
    await page.goto("about:blank");
    await page.request.delete(`/api/projects/${id}`);
  }
});

async function fixture(page: Page, name: string) {
  const response = await page.request.post("/api/projects", { data: { workspace_id: 1, name } });
  expect(response.status()).toBe(201);
  const { id } = await response.json() as { id: number };
  fixtures.set(page, id);
  return id;
}

function overlaps(
  first: { y: number; height: number },
  second: { y: number; height: number },
) {
  return first.y < second.y + second.height && second.y < first.y + first.height;
}

type Box = { x: number; y: number; width: number; height: number };

function intersects(first: Box, second: Box) {
  return (
    first.x < second.x + second.width &&
    second.x < first.x + first.width &&
    first.y < second.y + second.height &&
    second.y < first.y + first.height
  );
}

/** The header's visual row items: the title group, the tab nav, and the actions. */
async function headerRowBoxes(page: Page): Promise<Box[]> {
  return page.locator("[data-project-header]").evaluate((header) => {
    const boxes: Box[] = [];
    const collect = (element: Element) => {
      if (getComputedStyle(element).display === "contents") {
        for (const child of Array.from(element.children)) collect(child);
        return;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        boxes.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      }
    };
    for (const child of Array.from(header.children)) collect(child);
    return boxes;
  });
}

async function expectHeaderControlsInside(page: Page, width: number) {
  const overflow = page.locator("[data-project-tab-overflow]");
  await expect(overflow).toBeVisible();
  const controls = [
    {
      name: "最後に表示されているタブ",
      locator: page.locator('[data-project-tab]:not([data-project-tab-hidden])').last(),
    },
    { name: "その他", locator: overflow },
    { name: "タブを追加", locator: page.locator("[data-project-tab-add]") },
    { name: "共有", locator: page.locator("[data-project-share]") },
    { name: "カスタマイズ", locator: page.locator("[data-project-customize]") },
  ];

  for (const control of controls) {
    await expect(control.locator, control.name).toBeVisible();
    const box = (await control.locator.boundingBox())!;
    expect(box.x, `${control.name} starts inside the viewport`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${control.name} ends inside the viewport`).toBeLessThanOrEqual(width);
  }
  return overflow;
}

test("name and view tabs share one header row at 1440px", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/projects/1?view=list");

  const header = page.locator("[data-project-header]");
  const title = page.locator("[data-project-title]");
  const listTab = page.locator('[data-project-tab="builtin:list"]');
  const share = page.locator("[data-project-share]");
  await expect(title).toBeVisible();
  await expect(listTab).toBeVisible();
  await expect(share).toBeVisible();

  const headerBox = (await header.boundingBox())!;
  const titleBox = (await title.boundingBox())!;
  const tabBox = (await listTab.boundingBox())!;
  const shareBox = (await share.boundingBox())!;

  expect(overlaps(titleBox, tabBox), "name and tab are on the same row").toBe(true);
  expect(overlaps(tabBox, shareBox), "tabs and actions are on the same row").toBe(true);
  expect(tabBox.y).toBeGreaterThanOrEqual(headerBox.y);
  expect(tabBox.y + tabBox.height).toBeLessThanOrEqual(headerBox.y + headerBox.height);
  expect(headerBox.height, "header is one row tall").toBeLessThanOrEqual(56);
});

test("a long project name truncates without wrapping the header", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = "非常に長いプロジェクト名".repeat(8);
  const projectId = await fixture(page, name);
  await page.goto(`/projects/${projectId}?view=list`);

  const header = page.locator("[data-project-header]");
  const title = page.locator("[data-project-title]");
  const share = page.locator("[data-project-share]");
  await expect(title).toHaveAttribute("title", name);
  await expect(share).toBeVisible();

  const metrics = await title.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(metrics.scrollWidth, "long name is ellipsized").toBeGreaterThan(metrics.clientWidth);

  const headerBox = (await header.boundingBox())!;
  const titleBox = (await title.boundingBox())!;
  const shareBox = (await share.boundingBox())!;
  expect(overlaps(titleBox, shareBox), "the header does not wrap").toBe(true);
  expect(headerBox.height, "header is one row tall").toBeLessThanOrEqual(56);
  expect(shareBox.x + shareBox.width, "share stays inside the viewport").toBeLessThanOrEqual(1440);
});

for (const width of [1024, 1440]) {
  test(`visible header controls stay inside the viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/projects/1?view=list");
    await expectHeaderControlsInside(page, width);
  });
}

test("larger text keeps header controls inside the viewport at 1024px", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/projects/1?view=list");

  const overflow = page.locator("[data-project-tab-overflow]");
  const add = page.locator("[data-project-tab-add]");
  const nav = page.locator("[data-project-tabs]");
  await expect(overflow).toBeVisible();
  const overflowWidth = (await overflow.boundingBox())!.width;
  const addWidth = (await add.boundingBox())!.width;

  await page.addStyleTag({ content: "html { font-size: 20px !important; }" });

  await expect.poll(async () => (await overflow.boundingBox())?.width ?? 0).toBeGreaterThan(overflowWidth);
  await expect.poll(async () => (await add.boundingBox())?.width ?? 0).toBeGreaterThan(addWidth);
  await expect.poll(async () =>
    Number.parseFloat(await nav.evaluate((element) => getComputedStyle(element).minWidth)),
  ).toBeGreaterThan(176);

  const visibleOverflow = await expectHeaderControlsInside(page, 1024);
  await visibleOverflow.click();
  const menu = page.getByRole("menu", { name: "その他のビュー" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem").first()).toBeVisible();
});

test("narrow desktop moves hidden views into the Other menu", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/projects/1?view=list");

  const overflow = page.locator("[data-project-tab-overflow]");
  await expect(overflow).toBeVisible();
  await expect(overflow).toHaveAttribute("aria-haspopup", "menu");
  await expect(page.locator('[data-project-tab="builtin:board"]')).toBeHidden();

  await overflow.click();
  const menu = page.getByRole("menu", { name: "その他のビュー" });
  await expect(menu).toBeVisible();
  const boardItem = menu.getByRole("menuitem", { name: "ボード", exact: true });
  await expect(boardItem).toBeVisible();
  await boardItem.click();

  await expect(page).toHaveURL(/\/projects\/1\?view=board/);
  const boardTab = page.locator('[data-project-tab="builtin:board"]');
  await expect(boardTab).toBeVisible();
  await expect(boardTab.getByRole("link", { name: "ボード", exact: true })).toHaveAttribute("aria-current", "page");
});

test("Other menu supports keyboard navigation and Escape restores focus", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/projects/1?view=list");

  const overflow = page.locator("[data-project-tab-overflow]");
  await expect(overflow).toBeVisible();
  await overflow.focus();
  await page.keyboard.press("Enter");

  const menu = page.getByRole("menu", { name: "その他のビュー" });
  await expect(menu).toBeVisible();
  const items = menu.getByRole("menuitem");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  if (await items.count() > 1) await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(items.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(items.first()).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(overflow).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await expect(items.first()).toBeFocused();
  const labels = await items.allTextContents();
  const boardIndex = labels.findIndex((label) => label.trim() === "ボード");
  expect(boardIndex, "board is available in the overflow menu").toBeGreaterThanOrEqual(0);
  for (let index = 0; index < boardIndex; index += 1) await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "ボード", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/projects\/1\?view=board/);
});

test("the active tab stays visible near the end of the tab order", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/projects/1?view=forms&tab=builtin%3Aforms");

  const activeTab = page.locator('[data-project-tab="builtin:forms"]').getByRole("link", {
    name: "フォーム",
    exact: true,
  });
  const overflow = page.locator("[data-project-tab-overflow]");
  await expect(activeTab).toBeVisible();
  await expect(activeTab).toHaveAttribute("aria-current", "page");
  await expect(overflow).toBeVisible();

  await overflow.click();
  const menu = page.getByRole("menu", { name: "その他のビュー" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "フォーム", exact: true })).toHaveCount(0);
});

test("mobile keeps the existing two-row header", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/projects/1?view=list");

  const title = page.locator("[data-project-title]");
  const tabs = page.locator("[data-project-tabs]");
  await expect(title).toBeVisible();
  await expect(tabs).toBeVisible();

  const titleBox = (await title.boundingBox())!;
  const tabsBox = (await tabs.boundingBox())!;
  expect(titleBox.y + titleBox.height, "tabs start below the name row").toBeLessThanOrEqual(tabsBox.y + 1);
  expect(await tabs.evaluate((element) => getComputedStyle(element).overflowX)).toBe("auto");
  await expect(page.locator("[data-project-tab-overflow]")).toHaveCount(0);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
  test(`task pane keeps the project header on one row at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/projects/1?view=list");
    const header = page.locator("[data-project-header]");
    await expect(header).toBeVisible();
    const closedHeight = (await header.boundingBox())!.height;

    await page.goto("/projects/1?view=list&task=2");
    const pane = page.locator("[data-task-pane]");
    await expect(pane).toBeVisible();
    const nav = page.locator("[data-project-tabs]");
    await expect(nav).toBeVisible();
    // ProjectTabs sets the nav's minimum width from a layout effect. Wait until
    // that measurement has produced a measurable tab row before sampling boxes.
    await expect.poll(
      async () => (await nav.boundingBox())?.width ?? 0,
      { message: "the tab nav has a measurable width" },
    ).toBeGreaterThan(0);
    const activeTab = page.locator('[data-project-header] [aria-current="page"]');
    await expect(activeTab).toBeVisible();
    // The overflow button only becomes visible after the tab measurement has
    // decided which tabs fit, so this also guards against sampling mid-measure.
    await expect(page.locator("[data-project-tab-overflow]")).toBeVisible();
    await expect.poll(
      async () => (await headerRowBoxes(page)).length,
      { message: "title, tabs, and actions are laid out" },
    ).toBeGreaterThanOrEqual(3);
    const paneBox = (await pane.boundingBox())!;

    const boxes = await headerRowBoxes(page);
    expect(boxes.length, "title, tabs, and actions are laid out").toBeGreaterThanOrEqual(3);
    for (let first = 0; first < boxes.length; first += 1) {
      for (let second = first + 1; second < boxes.length; second += 1) {
        expect(
          intersects(boxes[first], boxes[second]),
          `header row items ${first} and ${second} do not overlap`,
        ).toBe(false);
      }
    }

    const title = page.locator("[data-project-title]");
    const projectName = (await title.getAttribute("data-project-title"))!;
    await expect(title).toHaveText(projectName);
    const titleBox = (await title.boundingBox())!;
    expect(titleBox.width, "the project name keeps its minimum width").toBeGreaterThanOrEqual(60);

    for (const [name, control] of [
      ["share", page.locator("[data-project-share]")],
      ["customize", page.locator("[data-project-customize]")],
    ] as const) {
      const box = (await control.boundingBox())!;
      expect(box.x + box.width, `${name} stays left of the task pane`).toBeLessThanOrEqual(paneBox.x + 0.5);
    }

    const openHeight = (await header.boundingBox())!.height;
    // The closed header is taller when the member facepile (h-8) is visible.
    // A narrower header must not grow a second row, and the row items must
    // still share the same vertical center.
    expect(
      openHeight,
      "opening the task pane does not add a second header row",
    ).toBeLessThanOrEqual(closedHeight + 2);
    const centers = boxes.map((box) => box.y + box.height / 2);
    expect(
      Math.max(...centers) - Math.min(...centers),
      "title, tabs, and actions stay on the same row",
    ).toBeLessThanOrEqual(4);
    await expect(activeTab).toBeVisible();
  });
}

test("the task pane reaches the bottom of the viewport at 1440px", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/projects/1?view=list&task=2");
  const pane = page.locator("[data-task-pane]");
  await expect(pane).toBeVisible();

  const paneBox = (await pane.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(
    Math.abs(paneBox.y + paneBox.height - viewport.height),
    "the pane meets the bottom edge of the viewport",
  ).toBeLessThanOrEqual(1);
});
