import { expect, test } from "@playwright/test";

test("a stale Status editor reloads the saved options before it can rename them", async ({ page }) => {
  const login = await page.request.post("/api/auth/login", {
    data: {
      email: process.env.E2E_EMAIL ?? "admin@example.com",
      password: process.env.E2E_PASSWORD ?? "atlas-dev-2026",
    },
  });
  expect(login.ok()).toBeTruthy();
  const created = await page.request.post("/api/projects", {
    data: { workspace_id: 1, name: "E2E Status conflict" },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: number };
  const projectPath = `/api/projects/${id}`;
  try {
    const initial = await page.request.patch(projectPath, { data: { status_options: ["Initial", "Done"] } });
    expect(initial.ok()).toBeTruthy();
    await page.goto(`/projects/${id}?view=list`);
    await page.locator("[data-project-customize]").click();
    const drawer = page.locator("[data-project-customize-drawer]");
    await drawer.getByRole("button", { name: /Status.*Initial/ }).click();
    const firstOption = drawer.locator("[data-customize-status-input]").first();
    const save = drawer.locator("[data-customize-status-save]");
    await expect(firstOption).toHaveValue("Initial");
    await firstOption.fill("Stale draft");

    const concurrent = await page.request.patch(projectPath, { data: { status_options: ["Remote edit", "Done"] } });
    expect(concurrent.ok()).toBeTruthy();
    const waitForSave = () => page.waitForResponse(
      (response) => new URL(response.url()).pathname === projectPath && response.request().method() === "PATCH",
    );
    const conflict = waitForSave();
    await save.click();
    expect((await conflict).status()).toBe(409);
    await expect(firstOption).toHaveValue("Remote edit");
    await expect(drawer.getByText(/別の操作でステータスが更新されました/)).toBeVisible();

    await firstOption.fill("Reviewed edit");
    const retried = waitForSave();
    await save.click();
    expect((await retried).status()).toBe(200);
    await expect(drawer.getByText("ステータスフィールドを更新しました")).toBeVisible();
  } finally {
    await page.request.delete(projectPath);
  }
});
