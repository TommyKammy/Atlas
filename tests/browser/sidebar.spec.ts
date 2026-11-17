import { expect, test, type Page } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "atlas-dev-2026";

async function login(page: Page): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(response.ok()).toBeTruthy();
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("sidebar invite button centers its icon and label", async ({ page }) => {
  await page.goto("/");
  const button = page.locator("[data-sidebar-invite]");
  await expect(button).toBeVisible();
  const style = await button.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      justifyContent: computed.justifyContent,
      textAlign: computed.textAlign,
    };
  });
  expect(style.justifyContent).toBe("center");
  expect(style.textAlign).toBe("center");
});

test("sidebar actions replace the global header and stay reachable at every width", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.locator("[data-sidebar]");
  const sidebarActions = page.locator("[data-sidebar-actions]");
  const mobileActions = page.locator("[data-mobile-actions]");
  const theme = page.locator("[data-sidebar-footer] [data-theme-toggle]");
  const projectOption = page.getByRole("button", { name: "プロジェクト", exact: true });

  await expect(page.getByRole("banner")).toHaveCount(0);
  await expect(page.locator("[data-global-search]")).toHaveCount(0);
  await expect(page.locator("[data-sidebar-rail]")).toHaveCount(0);
  await expect(page.locator("[data-sidebar-rail-footer]")).toHaveCount(0);
  await expect(page.locator("[data-sidebar-footer]")).toBeVisible();
  await expect(theme).toBeVisible();

  for (const width of [1440, 768, 375]) {
    await test.step(`${width}px viewport`, async () => {
      await page.setViewportSize({ width, height: 900 });
      const actions = width >= 768 ? sidebarActions : mobileActions;
      const create = actions.getByRole("button", { name: /作成/ });
      const search = actions.getByRole("button", { name: /^検索/ });

      await expect(create).toBeVisible();
      await expect(search).toBeVisible();
      if (width >= 768) {
        await expect(sidebar).toBeVisible();
        await expect(theme).toBeVisible();
        await expect(mobileActions).toBeHidden();
      } else {
        await expect(sidebar).toBeHidden();
        await expect(sidebarActions).toBeHidden();
      }

      const [createBox, searchBox] = await Promise.all([create.boundingBox(), search.boundingBox()]);
      if (!createBox || !searchBox) {
        throw new Error("sidebar action controls have no visible bounds");
      }
      const overlapX = Math.min(createBox.x + createBox.width, searchBox.x + searchBox.width) - Math.max(createBox.x, searchBox.x);
      const overlapY = Math.min(createBox.y + createBox.height, searchBox.y + searchBox.height) - Math.max(createBox.y, searchBox.y);
      expect(overlapX, "create and search bounds must not overlap").toBeLessThanOrEqual(0);
      expect(overlapY, "create and search must sit on the same row").toBeGreaterThan(0);
      expect(createBox.x).toBeGreaterThanOrEqual(0);
      expect(createBox.x + createBox.width).toBeLessThanOrEqual(width);
      expect(searchBox.x).toBeGreaterThanOrEqual(0);
      expect(searchBox.x + searchBox.width).toBeLessThanOrEqual(width);

      await create.click();
      await expect(projectOption).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(projectOption).toBeHidden();

      await search.click();
      const dialog = page.getByRole("dialog", { name: "コマンドパレット" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("combobox", { name: "コマンドを検索" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(search).toBeFocused();
    });
  }
});

test("collapsed rail keeps create and search without duplicating expanded controls", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.locator("[data-sidebar]");
  const sidebarActions = page.locator("[data-sidebar-actions]");
  const rail = page.locator("[data-sidebar-rail]");
  const railFooter = page.locator("[data-sidebar-rail-footer]");
  const footer = page.locator("[data-sidebar-footer]");
  const railActions = page.locator("[data-sidebar-rail-actions]");
  const projectOption = page.getByRole("button", { name: "プロジェクト", exact: true });

  await expect(sidebar).toHaveAttribute("data-sidebar-collapsed", "false");
  await expect(sidebarActions).toBeVisible();
  await expect(rail).toHaveCount(0);
  await expect(railFooter).toHaveCount(0);
  await expect(railActions).toHaveCount(0);
  await expect(footer).toBeVisible();
  await expect(footer.locator("[data-theme-toggle]")).toBeVisible();

  await page.locator("[data-sidebar-toggle]").click();
  await expect(sidebar).toHaveAttribute("data-sidebar-collapsed", "true");
  await expect(sidebarActions).toHaveCount(0);
  await expect(footer).toHaveCount(0);
  await expect(rail).toBeVisible();
  await expect(railFooter).toBeVisible();
  await expect(railFooter.locator("[data-theme-toggle]")).toBeVisible();
  await expect(railFooter.locator("[data-sidebar-help]")).toBeVisible();
  await expect(railFooter.locator("[data-sidebar-user-menu]")).toBeVisible();

  const create = railActions.getByRole("button", { name: "作成", exact: true });
  const search = railActions.getByRole("button", { name: /^検索/ });
  await expect(create).toBeVisible();
  await expect(search).toBeVisible();

  await create.click();
  await expect(projectOption).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(projectOption).toBeHidden();

  await search.click();
  const dialog = page.getByRole("dialog", { name: "コマンドパレット" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "コマンドを検索" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(search).toBeFocused();

  await page.locator("[data-sidebar-toggle]").click();
  await expect(sidebar).toHaveAttribute("data-sidebar-collapsed", "false");
  await expect(sidebarActions).toBeVisible();
  await expect(rail).toHaveCount(0);
  await expect(railFooter).toHaveCount(0);
  await expect(footer).toBeVisible();
  await expect(footer.locator("[data-theme-toggle]")).toBeVisible();
});

test.describe("resizable sidebar", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const sidebar = (page: Page) => page.locator("[data-sidebar]");
  const handle = (page: Page) => page.getByRole("separator", { name: "サイドバーの幅を変更" });
  const expectWidth = async (page: Page, width: number) => {
    await expect.poll(async () => (await sidebar(page).boundingBox())?.width).toBe(width);
  };
  const preference = async (page: Page) => (await page.context().cookies()).find(c => c.name === "atlas_sidebar_width")?.value;
  const startDrag = async (page: Page) => {
    const grip = handle(page);
    await expect(grip).toBeVisible();
    const box = (await grip.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 100);
    await page.mouse.down();
    await expect(sidebar(page)).toHaveAttribute("data-sidebar-resizing", "true");
    return { x: box.x + box.width / 2, y: box.y + 100 };
  };

  test("dragging follows the pointer outside the grip, persists on release and survives navigation/reload", async ({ page }) => {
    await page.goto("/");
    const refreshes: string[] = [];
    page.on("request", request => {
      // Next can prefetch other routes without next-router-prefetch. A resize
      // must not refresh the current page; unrelated prefetches are harmless.
      if (request.headers().rsc === "1" && new URL(request.url()).pathname === "/") refreshes.push(request.url());
    });
    await expectWidth(page, 252);
    const { x, y } = await startDrag(page);
    await page.mouse.move(x + 116, y + 150, { steps: 8 });
    await expectWidth(page, 368);
    expect(await preference(page)).toBeUndefined();
    await page.mouse.up();
    await expect(sidebar(page)).not.toHaveAttribute("data-sidebar-resizing");
    expect(await preference(page)).toBe("368");
    expect(refreshes).toEqual([]);
    await expect(page.locator("[data-sidebar-invite]")).toBeVisible();
    const main = (await page.getByRole("main").boundingBox())!;
    expect(main.x).toBe(368);
    expect(main.width).toBe(1072);
    await page.locator("#atlas-sidebar-content").getByRole("link", { name: "マイタスク", exact: true }).click();
    await expect(page).toHaveURL(/\/my-tasks/);
    await expectWidth(page, 368);
    await page.reload();
    await expectWidth(page, 368);
    // The saved width must also be used by SSR, before JavaScript runs.
    const ssr = await page.context().browser()!.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 }, storageState: await page.context().storageState() });
    try {
      const serverPage = await ssr.newPage();
      await serverPage.goto(page.url());
      await expectWidth(serverPage, 368);
    } finally { await ssr.close(); }
  });

  test("drag bounds, double-click reset and keyboard resizing have accessible values", async ({ page }) => {
    await page.goto("/");
    let point = await startDrag(page);
    await page.mouse.move(point.x + 800, point.y); await page.mouse.up();
    await expectWidth(page, 480);
    point = await startDrag(page);
    await page.mouse.move(0, point.y); await page.mouse.up();
    await expectWidth(page, 220);
    await handle(page).dblclick();
    await expectWidth(page, 252);
    await handle(page).focus();
    for (const [key, width] of [["ArrowRight", 262], ["Shift+ArrowRight", 312], ["ArrowLeft", 302], ["Home", 220], ["End", 480], ["Enter", 252]] as const) {
      await handle(page).press(key);
      await expectWidth(page, width);
      await expect(handle(page)).toHaveAttribute("aria-valuenow", String(width));
      expect(await preference(page)).toBe(String(width));
    }
    await expect(handle(page)).toBeFocused();
    await expect(handle(page)).toHaveAttribute("aria-orientation", "vertical");
  });

  for (const cancel of ["Escape", "pointercancel", "lostpointercapture", "blur", "resize"] as const) {
    test(`${cancel} restores the saved width and cleans up an active drag`, async ({ page }) => {
      await page.goto("/");
      await handle(page).press("Shift+ArrowRight");
      await expectWidth(page, 302);
      const { x, y } = await startDrag(page);
      await page.mouse.move(x + 60, y, { steps: 5 });
      await expectWidth(page, 362);
      if (cancel === "Escape") await page.keyboard.press("Escape");
      else if (cancel === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      else if (cancel === "resize") await page.setViewportSize({ width: 1300, height: 900 });
      else await handle(page).dispatchEvent(cancel, { pointerId: 1 });
      await page.mouse.up();
      await expectWidth(page, 302);
      expect(await preference(page)).toBe("302");
      await expect(sidebar(page)).not.toHaveAttribute("data-sidebar-resizing");
      expect(await page.evaluate(() => [document.documentElement.style.cursor, document.body.style.userSelect])).toEqual(["", ""]);
      await handle(page).press("ArrowRight");
      await expectWidth(page, 312);
    });
  }

  test("a secondary pointer cannot cancel the active resize", async ({ page }) => {
    await page.goto("/");
    const { x, y } = await startDrag(page);
    await page.mouse.move(x + 60, y, { steps: 5 });
    await handle(page).dispatchEvent("pointercancel", { pointerId: 2, isPrimary: false });
    await handle(page).dispatchEvent("lostpointercapture", { pointerId: 2, isPrimary: false });
    await expect(sidebar(page)).toHaveAttribute("data-sidebar-resizing", "true");
    await page.mouse.up();
    await expectWidth(page, 312);
    expect(await preference(page)).toBe("312");
  });

  test("collapse preserves the custom width and responsive bounds keep the main area usable", async ({ page }) => {
    await page.goto("/");
    await handle(page).press("End");
    await expectWidth(page, 480);
    await page.locator("[data-sidebar-toggle]").click();
    await expectWidth(page, 65);
    await expect(handle(page)).toHaveCount(0);
    await page.locator("[data-sidebar-toggle]").click();
    await expectWidth(page, 480);
    await page.setViewportSize({ width: 768, height: 900 });
    await expectWidth(page, 288);
    await expect(handle(page)).toHaveAttribute("aria-valuemax", "288");
    await expect(handle(page)).toHaveAttribute("aria-valuenow", "288");
    expect((await page.getByRole("main").boundingBox())!.width).toBe(480);
    await page.setViewportSize({ width: 375, height: 900 });
    await expect(sidebar(page)).toBeHidden();
    expect((await page.getByRole("main").boundingBox())!.width).toBe(375);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expectWidth(page, 480);
    expect(await preference(page)).toBe("480");
  });
});
