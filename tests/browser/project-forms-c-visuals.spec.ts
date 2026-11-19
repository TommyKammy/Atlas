import { expect, test, type Page } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "atlas-dev-2026";
const LIST = "/projects/1?view=list";

async function login(page: Page): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(response.ok()).toBeTruthy();
}

async function openSettings(page: Page) {
  await page.goto(LIST);
  await page.locator("[data-project-actions-button]").first().click();
  await page.locator('[data-project-action="settings"]').first().click();
  const dialog = page.locator("[data-project-settings-dialog]");
  await expect(dialog).toBeVisible();
  return dialog;
}

const appearance = (select: ReturnType<Page["locator"]>) =>
  select.evaluate((element) => {
    const style = getComputedStyle(element);
    const container = element.parentElement!;
    const chevron = container.querySelector('svg[aria-hidden="true"]');
    return {
      tag: element.tagName,
      height: element.getBoundingClientRect().height,
      appearance: style.appearance,
      chevronColor: chevron ? getComputedStyle(chevron).color : "",
      chevronPointerEvents: chevron ? getComputedStyle(chevron).pointerEvents : "",
    };
  });

test("C workbench form controls, left nav selection and the 通知 tab", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 1000 });

  // The create screen's left nav uses the sidebar's current-page surface.
  await page.goto("/projects/new");
  const galleryNav = page.locator('[data-project-create-nav="gallery"]');
  await expect(galleryNav).toHaveAttribute("aria-current", "page");
  const selectedNav = await galleryNav.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color, shadow: style.boxShadow };
  });
  expect(selectedNav).toEqual({
    background: "rgb(239, 240, 242)",
    color: "rgb(26, 29, 33)",
    shadow: "none",
  });

  // Inputs are 32px tall on the field surface with a 6px radius.
  await page.locator('[data-project-create-nav="blank"]').click();
  const nameInput = page.locator("[data-project-create-name]");
  await expect(nameInput).toBeVisible();
  // The blank form autofocuses the name input; measure the resting border first.
  await nameInput.evaluate((element) => (element as HTMLInputElement).blur());
  // The control transitions its border color, so poll until it settles.
  await expect
    .poll(() => nameInput.evaluate((element) => getComputedStyle(element).borderColor))
    .toBe("rgb(228, 230, 234)");
  const inputMetrics = await nameInput.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      radius: style.borderRadius,
      background: style.backgroundColor,
      border: style.borderColor,
      labelSize: getComputedStyle(element.closest("label")!.querySelector("span")!).fontSize,
    };
  });
  expect(inputMetrics).toEqual({
    height: 32,
    radius: "6px",
    background: "rgb(255, 255, 255)",
    border: "rgb(228, 230, 234)",
    labelSize: "12px",
  });

  // Mouse focus shows the accent border only; no extra ring is added.
  await nameInput.click();
  await expect
    .poll(() => nameInput.evaluate((element) => getComputedStyle(element).borderColor))
    .toBe("rgb(26, 29, 33)");
  const focused = await nameInput.evaluate((element) => {
    const style = getComputedStyle(element);
    return { border: style.borderColor, shadow: style.boxShadow };
  });
  expect(focused.border).toBe("rgb(26, 29, 33)");
  // Only the shared 4px focus-visible halo; no extra 2px focus:ring layer.
  expect(focused.shadow).toContain("0px 0px 0px 4px");
  expect(focused.shadow).not.toContain("0px 0px 0px 2px");

  // Settings: native select wrapped with an appearance-none chevron, and the
  // selected tab uses the sidebar active surface without a card shadow.
  const settings = await openSettings(page);
  const detailsTab = settings.locator('[data-project-settings-tab="details"]');
  await expect(detailsTab).toHaveAttribute("aria-current", "page");
  const selectedTab = await detailsTab.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color, shadow: style.boxShadow };
  });
  expect(selectedTab).toEqual({
    background: "rgb(239, 240, 242)",
    color: "rgb(26, 29, 33)",
    shadow: "none",
  });

  const ownerSelect = settings.locator('[data-project-settings-panel="details"] select').first();
  await expect(ownerSelect).toBeVisible();
  expect(await appearance(ownerSelect)).toEqual({
    tag: "SELECT",
    height: 32,
    appearance: "none",
    chevronColor: "rgb(92, 100, 112)",
    chevronPointerEvents: "none",
  });

  const notificationsTab = settings.locator('[data-project-settings-tab="notifications"]');
  await expect(notificationsTab).toHaveText("通知");
  await notificationsTab.click();
  await expect(notificationsTab).toHaveAttribute("aria-current", "page");
  await expect(settings.locator('[data-project-settings-panel="notifications"]')).toBeVisible();

  await settings.getByRole("button", { name: "閉じる" }).click();

  // Field dialog: the type select uses the same control, the title input is
  // 32px, the label is 12px, and option rows keep their delete button label.
  await page.locator("[data-field-add-button]").click();
  await page.locator('[data-field-type-option="select"]').first().click();
  const fieldDialog = page.locator("[data-field-dialog]");
  await expect(fieldDialog).toBeVisible();

  const typeSelect = fieldDialog.locator("select").first();
  expect(await appearance(typeSelect)).toEqual({
    tag: "SELECT",
    height: 32,
    appearance: "none",
    chevronColor: "rgb(92, 100, 112)",
    chevronPointerEvents: "none",
  });

  const fieldName = fieldDialog.locator("[data-field-dialog-name]");
  expect(await fieldName.evaluate((element) => element.getBoundingClientRect().height)).toBe(32);
  const fieldLabel = await fieldDialog
    .locator("[data-field-dialog-name]")
    .evaluate((element) => {
      const style = getComputedStyle(element.closest("label")!.querySelector("span")!);
      return { size: style.fontSize, weight: style.fontWeight, color: style.color };
    });
  expect(fieldLabel).toEqual({ size: "12px", weight: "500", color: "rgb(58, 64, 73)" });

  const removeButtons = fieldDialog.getByRole("button", { name: "選択肢を削除" });
  await expect(removeButtons).toHaveCount(1);
  await fieldDialog.getByRole("button", { name: "＋ 選択肢を追加" }).click();
  await expect(removeButtons).toHaveCount(2);

  // At 375px both dialogs stay inside the viewport without horizontal overflow.
  await page.setViewportSize({ width: 375, height: 800 });
  const fieldPanel = fieldDialog.locator('[role="dialog"]');
  const fieldBox = (await fieldPanel.boundingBox())!;
  expect(fieldBox.x).toBeGreaterThanOrEqual(0);
  expect(fieldBox.x + fieldBox.width).toBeLessThanOrEqual(375);
  expect(
    await fieldPanel.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await fieldDialog.getByRole("button", { name: "閉じる" }).click();

  const narrowSettings = await openSettings(page);
  const settingsBox = (await narrowSettings.boundingBox())!;
  expect(settingsBox.x).toBeGreaterThanOrEqual(0);
  expect(settingsBox.x + settingsBox.width).toBeLessThanOrEqual(375);
  expect(
    await narrowSettings.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await expect(narrowSettings.locator('[data-project-settings-tab="notifications"]')).toHaveText("通知");
});
