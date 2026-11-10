import { expect, test } from "@playwright/test";

test("a project trigger disables actions that need a task subject", async ({ page }) => {
  const login = await page.request.post("/api/auth/login", {
    data: {
      email: process.env.E2E_EMAIL ?? "admin@example.com",
      password: process.env.E2E_PASSWORD ?? "atlas-dev-2026",
    },
  });
  expect(login.ok()).toBeTruthy();
  await page.goto("/projects/1?view=timeline");
  await page.locator("[data-project-customize]").click();
  const drawer = page.locator("[data-project-customize-drawer]");
  await drawer.getByRole("button", { name: /AIと自動化/ }).click();
  await drawer.locator("[data-customize-automation-add]").click();

  const builder = page.getByRole("dialog", { name: "ルールを作成" });
  const trigger = builder.locator("select").filter({
    has: page.locator('option[value="project.status_changed"]'),
  });
  const action = builder.locator("select").filter({
    has: page.locator('option[value="task.complete"]'),
  });
  const complete = action.locator('option[value="task.complete"]');
  await expect(complete).toBeEnabled();

  await trigger.selectOption("project.status_changed");
  await expect(complete).toBeDisabled();
  await expect(action.locator('option[value="task.create"]')).toBeEnabled();
  await expect(action.locator('option[value="project.set_status"]')).toBeEnabled();
  await expect(action.locator('option[value="webhook.post"]')).toBeEnabled();

  await trigger.selectOption("task.created");
  await expect(complete).toBeEnabled();
});
