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

test("header search shrinks while keeping create independently usable", async ({ page }) => {
  await page.goto("/");
  const header = page.getByRole("banner");
  const create = header.getByRole("button", { name: /作成/ });
  const search = header.getByRole("combobox", { name: "グローバル検索", exact: true });
  const theme = header.locator("[data-theme-toggle]");
  const projectOption = header.getByRole("button", { name: "プロジェクト", exact: true });

  let previousSearchWidth = Infinity;
  for (const width of [1440, 768, 375]) {
    await test.step(`${width}px viewport`, async () => {
      await page.setViewportSize({ width, height: 900 });
      await expect(create).toBeVisible();
      await expect(search).toBeVisible();
      await expect(theme).toBeVisible();

      const [bannerBox, createBox, searchBox, themeBox] = await Promise.all([
        header.boundingBox(), create.boundingBox(), search.boundingBox(), theme.boundingBox(),
      ]);
      if (!bannerBox || !createBox || !searchBox || !themeBox) {
        throw new Error("header controls have no visible bounds");
      }
      expect(searchBox.width).toBeLessThan(previousSearchWidth);
      previousSearchWidth = searchBox.width;
      expect(searchBox.x).toBeGreaterThanOrEqual(bannerBox.x);
      expect(searchBox.y).toBeGreaterThanOrEqual(bannerBox.y);
      expect(searchBox.x + searchBox.width).toBeLessThanOrEqual(bannerBox.x + bannerBox.width);
      expect(searchBox.y + searchBox.height).toBeLessThanOrEqual(bannerBox.y + bannerBox.height);
      for (const [label, box] of [["create", createBox], ["theme", themeBox]] as const) {
        const overlapX = Math.min(box.x + box.width, searchBox.x + searchBox.width) - Math.max(box.x, searchBox.x);
        const overlapY = Math.min(box.y + box.height, searchBox.y + searchBox.height) - Math.max(box.y, searchBox.y);
        expect(Math.min(overlapX, overlapY), `${label} and search bounds must not overlap`).toBeLessThanOrEqual(0);
      }

      await create.click();
      await expect(projectOption).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(projectOption).toBeHidden();

      await search.click();
      await expect(search).toBeFocused();
      await search.fill(`Atlas ${width}`);
      await expect(search).toHaveValue(`Atlas ${width}`);
      await search.press("Escape");
    });
  }
});
