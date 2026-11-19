import { expect, test, type Page } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "atlas-dev-2026";

async function fixture(page: Page) {
  const login = await page.request.post("/api/auth/login", { data: { email: EMAIL, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const project = await page.request.post("/api/projects", { data: {
    workspace_id: 1, name: `Rule C visuals ${test.info().testId} ${Date.now()}`,
  } });
  expect(project.status()).toBe(201);
  const { id: projectId } = await project.json() as { id: number };
  const base = `/api/projects/${projectId}/rules`;
  const definition = {
    version: 1 as const,
    triggers: [{ event: "task.created" as const }],
    conditions: [],
    actions: [{ capability: "task.add_comment", params: { body: "C visuals" } }],
  };
  const created = await page.request.post(base, { data: { name: "C visuals rule", definition } });
  expect(created.status()).toBe(201);
  const { id: ruleId } = await created.json() as { id: number };
  const draft = await page.request.post(`${base}/drafts`, { data: { rule_id: ruleId } });
  expect(draft.status()).toBe(201);
  const pending = await draft.json() as { draft: { id: string; revision: number } };
  const saved = await page.request.put(`${base}/drafts/${pending.draft.id}`, { data: {
    expected_revision: pending.draft.revision,
    name: "C visuals rule",
    definition: { ...definition, conditions: [
      { field: "task.name", op: "eq", value: "" },
      { field: "task.name", op: "eq", value: "  " },
    ] },
  } });
  expect(saved.ok()).toBeTruthy();
  return { projectId, ruleId, path: `/projects/${projectId}/rules/${ruleId}` };
}

const selectAppearance = (select: ReturnType<Page["locator"]>) =>
  select.evaluate((element) => {
    const style = getComputedStyle(element);
    const chevron = element.parentElement!.querySelector('svg[aria-hidden="true"]');
    return {
      tag: element.tagName,
      height: element.getBoundingClientRect().height,
      appearance: style.appearance,
      chevronColor: chevron ? getComputedStyle(chevron).color : "",
      chevronPointerEvents: chevron ? getComputedStyle(chevron).pointerEvents : "",
    };
  });

test("rule editor uses C form controls, surface tabs, validation count and a 375px inspector", async ({ page }) => {
  const f = await fixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(f.path);
  await expect(page.locator("[data-rule-workflow-editor]")).toBeVisible();

  // The editor tabs mark the current tab with a faint surface, not an underline.
  const editorTab = page.getByRole("button", { name: "エディター", exact: true });
  await expect(editorTab).toHaveAttribute("aria-current", "page");
  const selectedTab = await editorTab.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      color: style.color,
      borderBottomWidth: style.borderBottomWidth,
    };
  });
  expect(selectedTab).toEqual({
    background: "rgb(239, 240, 242)",
    color: "rgb(63, 107, 0)",
    borderBottomWidth: "0px",
  });
  const historyTab = page.getByRole("button", { name: "実行履歴", exact: true });
  const idleTab = await historyTab.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  expect(idleTab).toEqual({ background: "rgba(0, 0, 0, 0)", color: "rgb(58, 64, 73)" });

  // The publication check is a compact surface above the canvas with an exact count.
  const summary = page.locator("[data-rule-validation-summary]");
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("公開前に 2 件の入力が必要です");
  await expect(summary.getByRole("button").first()).toBeVisible();
  const geometry = await page.evaluate(() => {
    const summary = document.querySelector<HTMLElement>("[data-rule-validation-summary]")!;
    const canvas = document.querySelector<HTMLElement>("[data-rule-canvas]")!;
    return { summary: summary.getBoundingClientRect().toJSON(), canvas: canvas.getBoundingClientRect().toJSON() };
  });
  expect(geometry.summary.width).toBeLessThan(geometry.canvas.width);
  expect(geometry.summary.height).toBeLessThan(140);

  // Header primary action and quiet/secondary actions share the 32px height.
  const publishHeight = await page.getByRole("button", { name: "公開する", exact: true }).evaluate((element) => element.getBoundingClientRect().height);
  expect(publishHeight).toBe(32);
  const saveHeight = await page.getByRole("button", { name: "下書きを保存", exact: true }).evaluate((element) => element.getBoundingClientRect().height);
  expect(saveHeight).toBe(32);

  // The selected node carries a 2px accent border on the faint selection surface.
  const conditionsNode = page.locator('[data-rule-node="conditions"]');
  await conditionsNode.click();
  // The card animates its colors; wait for the selected surface before sampling.
  await expect
    .poll(() => conditionsNode.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(239, 240, 242)");
  await expect
    .poll(() => conditionsNode.evaluate((element) => getComputedStyle(element).borderTopColor))
    .toBe("rgb(26, 29, 33)");
  const selectedNode = await conditionsNode.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      borderTopWidth: style.borderTopWidth,
      borderTopColor: style.borderTopColor,
      pressed: element.getAttribute("aria-pressed"),
    };
  });
  expect(selectedNode).toEqual({
    background: "rgb(239, 240, 242)",
    borderTopWidth: "2px",
    borderTopColor: "rgb(26, 29, 33)",
    pressed: "true",
  });

  // The inspector uses the native select with the shared chevron and C field height.
  const inspector = page.locator("[data-rule-inspector]");
  await expect(inspector).toBeVisible();
  expect(await selectAppearance(inspector.locator("select").first())).toEqual({
    tag: "SELECT",
    height: 32,
    appearance: "none",
    chevronColor: "rgb(92, 100, 112)",
    chevronPointerEvents: "none",
  });
  const inspectorHeader = await inspector.evaluate((element) => {
    const heading = element.querySelector("h2")!;
    const close = element.querySelector<HTMLElement>('[aria-label="設定パネルを閉じる"]')!;
    return {
      headingSize: getComputedStyle(heading).fontSize,
      headingWeight: getComputedStyle(heading).fontWeight,
      closeWidth: close.getBoundingClientRect().width,
      closeHeight: close.getBoundingClientRect().height,
      paddingLeft: getComputedStyle(element.querySelector("fieldset")!).paddingLeft,
    };
  });
  expect(inspectorHeader).toEqual({
    headingSize: "16px",
    headingWeight: "600",
    closeWidth: 32,
    closeHeight: 32,
    paddingLeft: "20px",
  });

  // AI assist opens and closes without calling the suggestion endpoint.
  await page.getByRole("button", { name: "AIアシスト", exact: true }).click();
  const aiDialog = page.getByRole("dialog", { name: "AIアシスト", exact: true });
  await expect(aiDialog).toBeVisible();
  await aiDialog.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(aiDialog).toHaveCount(0);

  // At 375px the overlay panel stays inside the viewport and keeps its controls usable.
  await page.setViewportSize({ width: 375, height: 800 });
  const panelBox = (await inspector.boundingBox())!;
  expect(panelBox.x).toBeGreaterThanOrEqual(0);
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  const firstSelect = inspector.locator("select").first();
  const selectBox = (await firstSelect.boundingBox())!;
  expect(selectBox.x).toBeGreaterThanOrEqual(panelBox.x);
  expect(selectBox.x + selectBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width);
  await expect(page.getByRole("button", { name: "設定パネルを閉じる", exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("rule-editor-c-375.png") });
});
