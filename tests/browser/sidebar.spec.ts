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
