import { expect, test, type Locator, type Page } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "atlas-dev-2026";

async function login(page: Page) {
  const response = await page.request.post("/api/auth/login", { data: { email: EMAIL, password: PASSWORD } });
  expect(response.ok()).toBeTruthy();
}

async function tokenColor(page: Page, token: string) {
  return page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = `var(${name})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  }, token);
}

async function selectAppearance(select: Locator) {
  return select.evaluate((element) => {
    const style = getComputedStyle(element);
    const chevron = element.parentElement?.querySelector('svg[aria-hidden="true"]');
    return {
      appearance: style.appearance,
      height: element.getBoundingClientRect().height,
      chevronColor: chevron ? getComputedStyle(chevron).color : "",
      chevronPointerEvents: chevron ? getComputedStyle(chevron).pointerEvents : "",
    };
  });
}

async function projectFixture(page: Page) {
  const project = await page.request.post("/api/projects", {
    data: { workspace_id: 1, name: `C r3-4 ${test.info().testId} ${Date.now()}` },
  });
  expect(project.status()).toBe(201);
  const { id } = await project.json() as { id: number };
  const section = await page.request.post("/api/sections", { data: { project_id: id, name: "受付" } });
  expect(section.status()).toBe(201);
  const { id: sectionId } = await section.json() as { id: number };
  for (const [index, name] of ["受付A", "受付B", "受付C"].entries()) {
    const task = await page.request.post("/api/tasks", {
      data: {
        project_id: id,
        section_id: sectionId,
        name,
        due_on: `2026-11-${String(17 + index).padStart(2, "0")}`,
      },
    });
    expect(task.status()).toBe(201);
  }
  const notes = [] as { id: number; title: string }[];
  for (const title of ["議事録サンプル", "手順書サンプル"]) {
    const note = await page.request.post("/api/knowledge", { data: { project_id: id, title, body: "## 見出し\n\n本文" } });
    expect(note.status()).toBe(201);
    notes.push(await note.json() as { id: number; title: string });
  }
  return { id, notes };
}

test("knowledge, forms and dashboard follow the C workbench treatment", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  const project = await projectFixture(page);
  try {
    // Forms: the empty state is a quiet surface, not a dashed box, and uses Japanese copy.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/projects/${project.id}?view=forms`);
    const empty = page.locator('[data-empty-state="forms"]');
    await expect(empty).toBeVisible();
    await expect(empty.getByRole("heading", { name: "フォームで受付を自動化", exact: true })).toBeVisible();
    await expect(empty).not.toContainText("intake");
    expect(await empty.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe("0px");
    expect(await empty.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe(await tokenColor(page, "--atlas-surface-subtle"));
    await expect(page.locator("[data-form-new]")).toHaveCSS("height", "28px");

    const form = await page.request.post("/api/forms", {
      data: {
        project_id: project.id,
        name: "問い合わせフォーム",
        description: "受付の問い合わせ",
        fields: [
          { key: "title", label: "件名", type: "text", required: true },
          { key: "kind", label: "種別", type: "select", options: ["質問", "依頼"] },
        ],
      },
    });
    expect(form.status()).toBe(201);
    const formId = (await form.json() as { id: number }).id;
    expect((await page.request.patch(`/api/forms/${formId}`, { data: { published: true } })).status()).toBe(200);
    await page.reload();

    const card = page.locator(`[data-form-card="${formId}"]`);
    await expect(card).toBeVisible();
    await expect(card).toHaveCSS("border-radius", "8px");
    await expect(card).toHaveCSS("border-top-color", await tokenColor(page, "--atlas-line"));
    const cardTitle = card.getByRole("heading", { name: "問い合わせフォーム", exact: true });
    await expect(cardTitle).toHaveCSS("font-size", "13px");
    await expect(cardTitle).toHaveCSS("font-weight", "600");
    await expect(card).toContainText("公開中");
    await expect(card).toContainText("2 項目 ・ 回答 0 件");
    await expect(card.locator("[data-form-answer]")).toHaveCSS("height", "32px");

    // The builder rows are divider lines, not rounded boxes; the select is the
    // shared 32px native control with a quiet chevron.
    await page.locator("[data-form-new]").click();
    const builder = page.locator("[data-form-builder]");
    await expect(builder).toBeVisible();
    const typeSelect = builder.locator("[data-form-field-type]").first();
    expect(await selectAppearance(typeSelect)).toEqual({
      appearance: "none",
      height: 32,
      chevronColor: await tokenColor(page, "--atlas-text-muted"),
      chevronPointerEvents: "none",
    });
    const fieldRow = builder.locator('[data-form-field="1"]');
    expect(await fieldRow.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("0px");
    expect(await fieldRow.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe("1px");
    await expect(fieldRow.locator('input[type="checkbox"]')).toHaveCSS("width", "16px");
    const remove = fieldRow.getByRole("button", { name: "項目を削除", exact: true });
    await expect(remove).toHaveCSS("height", "32px");
    await expect(builder.getByRole("button", { name: "＋ 項目を追加", exact: true })).toHaveCSS("height", "32px");
    await builder.getByRole("button", { name: "キャンセル", exact: true }).click();
    await expect(builder).toHaveCount(0);

    // Knowledge: the selected row uses the sidebar current-page surface, and
    // the header actions are 32px with only 編集 as the primary button.
    await page.goto(`/projects/${project.id}?view=knowledge&note=${project.notes[0].id}`);
    const selectedRow = page.locator(`[data-note-row="${project.notes[0].id}"]`);
    await expect(selectedRow).toBeVisible();
    await expect(page.locator(`[data-knowledge-note="${project.notes[0].id}"]`)).toHaveAttribute("aria-current", "page");
    const selectedStyle = await selectedRow.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, color: style.color, shadow: style.boxShadow };
    });
    expect(selectedStyle).toEqual({
      background: await tokenColor(page, "--atlas-nav-active"),
      color: await tokenColor(page, "--atlas-sidebar-text-strong"),
      shadow: "none",
    });
    await expect(page.locator("[data-knowledge-note] [data-reorder-label]").first()).toHaveCSS("font-size", "13px");
    await expect(page.locator("[data-knowledge-note]").first().locator("span").last()).toHaveCSS("color", await tokenColor(page, "--atlas-text-muted"));
    await expect(page.getByRole("searchbox", { name: "ノートを検索" })).toHaveCSS("height", "32px");
    await expect(page.getByRole("button", { name: "ノートを追加", exact: true })).toHaveCSS("height", "28px");
    await expect(page.getByRole("button", { name: "ゴミ箱", exact: true })).toHaveCSS("height", "28px");
    await expect(page.getByRole("button", { name: "＋ 議事録", exact: true })).toHaveCSS("height", "32px");
    const editButton = page.locator("[data-knowledge-edit]");
    await expect(editButton).toHaveCSS("height", "32px");
    await expect(editButton).toHaveCSS("background-color", await tokenColor(page, "--atlas-accent"));
    await expect(page.getByRole("button", { name: "書き出す", exact: true })).toHaveCSS("height", "32px");
    await editButton.click();
    await expect(page.locator("[data-knowledge-composer]")).toBeVisible();
    await expect(page.locator("[data-knowledge-save]")).toHaveCSS("height", "32px");
    await expect(page.getByRole("button", { name: "編集を終了", exact: true })).toHaveCSS("height", "32px");
    await page.getByRole("button", { name: "編集を終了", exact: true }).click();

    // Dashboard: cards use an 8px radius and line border, the number is 34px,
    // and SVG axes read their labels from the muted token.
    await page.request.get(`/api/projects/${project.id}/dashboard/widgets`);
    await page.goto(`/projects/${project.id}?view=dashboard`);
    const cards = page.locator("[data-dashboard-widget]");
    await expect(cards.first()).toBeVisible();
    await expect(page.locator("[data-dashboard-add-button]")).toHaveCSS("height", "28px");
    await expect(page.getByRole("link", { name: "フィードバックを送る", exact: true })).toHaveCSS("height", "28px");
    await expect(page.locator("summary").filter({ hasText: "オプション" })).toHaveCSS("height", "28px");
    const numberCard = page.locator('[data-dashboard-widget-kind="number"]').first();
    await expect(numberCard).toHaveCSS("border-radius", "8px");
    await expect(numberCard).toHaveCSS("border-top-color", await tokenColor(page, "--atlas-line"));
    await expect(numberCard.locator("h3")).toHaveCSS("font-size", "13px");
    await expect(numberCard.locator("h3")).toHaveCSS("font-weight", "600");
    const numberValue = numberCard.locator(".tabular-nums").first();
    await expect(numberValue).toHaveCSS("font-size", "34px");
    await expect(numberValue).toHaveCSS("font-variant-numeric", "tabular-nums");

    const chartCard = page.locator('[data-dashboard-widget-kind="chart"]').filter({
      has: page.getByRole("heading", { name: "未完了のタスクの合計 (セクション別)", exact: true }),
    });
    await expect(chartCard).toBeVisible();
    const axisLabel = chartCard.locator("svg text").first();
    await expect(axisLabel).toHaveCSS("fill", await tokenColor(page, "--atlas-text-muted"));
    await expect(axisLabel).toHaveCSS("font-size", "11px");
    const strokes = await chartCard.locator("svg line").evaluateAll((lines) => lines.map((line) => getComputedStyle(line).stroke));
    expect(strokes).toContain(await tokenColor(page, "--atlas-line-subtle"));
    expect(strokes).toContain(await tokenColor(page, "--atlas-line"));
    await expect(chartCard.locator("[data-dashboard-chart-data] summary")).toHaveCSS("font-size", "12px");
    await expect(chartCard.locator("[data-dashboard-chart-data] summary")).toHaveCSS("color", await tokenColor(page, "--atlas-text-secondary"));
    await expect(chartCard.locator("[data-dashboard-show-all]")).toHaveCSS("height", "32px");

    const donutCard = page.locator('[data-dashboard-widget-kind="chart"]').filter({
      has: page.getByRole("heading", { name: "タスクの合計 (完了ステータス別)", exact: true }),
    });
    await expect(donutCard).toBeVisible();
    const donutTotal = donutCard.locator('[data-dashboard-chart-link="total"] text').first();
    await expect(donutTotal).toHaveCSS("font-size", "24px");
    await expect(donutTotal).toHaveCSS("font-weight", "600");
    await expect(donutTotal).toHaveCSS("font-variant-numeric", "tabular-nums");
    await expect(donutCard.locator('[data-dashboard-chart-link="total"] text').last()).toHaveCSS("font-size", "12px");

    // The widget dialog uses the shared controls, including the chevron select.
    await page.locator("[data-dashboard-add-button]").click();
    await page.locator("[data-dashboard-add-chart]").click();
    const widgetDialog = page.locator("[data-dashboard-dialog]");
    await expect(widgetDialog).toBeVisible();
    expect(await selectAppearance(widgetDialog.locator("[data-dashboard-group-by]"))).toEqual({
      appearance: "none",
      height: 32,
      chevronColor: await tokenColor(page, "--atlas-text-muted"),
      chevronPointerEvents: "none",
    });
    await expect(widgetDialog.getByRole("button", { name: "キャンセル", exact: true })).toHaveCSS("height", "32px");
    await widgetDialog.getByRole("button", { name: "キャンセル", exact: true }).click();
    await expect(widgetDialog).toHaveCount(0);

    // At 375px all three views and both dialogs stay inside the viewport.
    await page.setViewportSize({ width: 375, height: 800 });
    for (const view of ["knowledge", "forms", "dashboard"]) {
      await page.goto(`/projects/${project.id}?view=${view}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), view).toBe(true);
    }
    await page.goto(`/projects/${project.id}?view=forms`);
    await page.locator("[data-form-new]").click();
    const narrowBuilder = page.getByRole("dialog");
    await expect(narrowBuilder).toBeVisible();
    const builderBox = (await narrowBuilder.boundingBox())!;
    expect(builderBox.x).toBeGreaterThanOrEqual(0);
    expect(builderBox.x + builderBox.width).toBeLessThanOrEqual(375);
    expect(await narrowBuilder.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await narrowBuilder.getByRole("button", { name: "キャンセル", exact: true }).click();

    await page.goto(`/projects/${project.id}?view=dashboard`);
    await page.locator("[data-dashboard-add-button]").click();
    await page.locator("[data-dashboard-add-chart]").click();
    const narrowWidget = page.getByRole("dialog");
    await expect(narrowWidget).toBeVisible();
    const widgetBox = (await narrowWidget.boundingBox())!;
    expect(widgetBox.x).toBeGreaterThanOrEqual(0);
    expect(widgetBox.x + widgetBox.width).toBeLessThanOrEqual(375);
    expect(await narrowWidget.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  } finally {
    await page.request.delete(`/api/projects/${project.id}`);
  }
});
