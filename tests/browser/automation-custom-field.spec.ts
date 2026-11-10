import { expect, test } from "@playwright/test";

test("a custom-field action uses typed editors and saves people as IDs", async ({ page }) => {
  const login = await page.request.post("/api/auth/login", {
    data: { email: process.env.E2E_EMAIL ?? "admin@example.com", password: process.env.E2E_PASSWORD ?? "atlas-dev-2026" },
  });
  expect(login.ok()).toBeTruthy();
  const created = await page.request.post("/api/projects", { data: { workspace_id: 1, name: "E2E typed rule values" } });
  expect(created.status()).toBe(201);
  const { id } = await created.json() as { id: number };
  const fields: Record<string, number> = {};
  try {
    for (const [field_type, extra] of [
      ["number", {}], ["date", {}], ["people", {}],
      ["multi_select", { options: ["Red", "Blue"] }],
      ["reference", { config: { source_project_ids: [id] } }],
      ["formula", { config: { expression: "1" } }],
    ] as const) {
      const response = await page.request.post("/api/custom-fields", {
        data: { project_id: id, name: `Typed ${field_type}`, field_type, ...extra },
      });
      expect(response.status()).toBe(201);
      fields[field_type] = (await response.json() as { id: number }).id;
    }
    await page.goto(`/projects/${id}?view=list`);
    await page.locator("[data-project-customize]").click();
    const drawer = page.locator("[data-project-customize-drawer]");
    await drawer.getByRole("button", { name: /AIと自動化/ }).click();
    await drawer.locator("[data-customize-automation-add]").click();
    const builder = page.getByRole("dialog", { name: "ルールを作成" });
    const action = builder.locator("select").filter({ has: page.locator('option[value="task.set_custom_field"]') });
    await action.selectOption("task.set_custom_field");
    const field = builder.locator("select").filter({ has: page.locator(`option[value="${fields.date}"]`) });
    await expect(field.locator(`option[value="${fields.formula}"]`)).toHaveCount(0);

    await field.selectOption(String(fields.number));
    await expect(builder.locator('[data-automation-custom-value="number"] input')).toHaveAttribute("type", "number");
    await field.selectOption(String(fields.date));
    await expect(builder.locator('[data-automation-custom-value="date"] input')).toHaveAttribute("type", "date");
    await field.selectOption(String(fields.multi_select));
    await expect(builder.locator('[data-automation-custom-value="multi_select"]').getByLabel("Red")).toBeVisible();
    await field.selectOption(String(fields.reference));
    await expect(builder.locator('[data-automation-custom-value="reference"]').getByRole("button", { name: /参照タスクを選択/ })).toBeVisible();

    await field.selectOption(String(fields.people));
    const people = builder.locator('[data-automation-custom-value="people"]');
    await people.locator('input[type="checkbox"]').first().check();
    const name = builder.getByLabel("ルール名", { exact: true });
    await name.fill("Typed people rule");
    const saved = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/projects/${id}/rules` && response.request().method() === "POST");
    await builder.getByRole("button", { name: "ルールを作成", exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    const body = response.request().postDataJSON() as { definition: { actions: { capability: string; params: { field_id: string; value: unknown } }[] } };
    const selected = body.definition.actions.find((entry) => entry.capability === "task.set_custom_field");
    expect(Number(selected?.params.field_id)).toBe(fields.people);
    expect(Array.isArray(selected?.params.value)).toBe(true);
    expect((selected?.params.value as unknown[]).every((value) => typeof value === "number" && value > 0)).toBe(true);
    await expect(builder).toBeHidden();
  } finally {
    await page.request.delete(`/api/projects/${id}`);
  }
});
