import { expect, test, type Locator, type Page } from "@playwright/test";

// A missing selector should fail one action, not consume the whole test
// timeout. This also keeps a controlled checkbox's server round-trip bounded.
test.use({ actionTimeout: 15_000 });

/**
 * End-to-end regression for the shared-portfolio investment plan.
 *
 * The portfolio itself is an isolated API fixture because it is pre-existing
 * shared data. Everything that makes the planning decision (period, roles,
 * estimates, allocation, A/B comparison, adoption and history) is exercised
 * through the Japanese UI, with no network or feature mocks.
 */

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "atlas-dev-2026";
const ROLES = ["DB担当", "開発担当", "QA担当"] as const;
const MONTHS = [1, 2, 3] as const;
const PERIOD_LABEL = "2027年 1月–3月";
const BUDGET_MAN_YEN = "1000";
const REASON =
  "1月のDB担当の配賦枠18人日を超えず、顧客分析で月20時間の削減効果を得るため。" +
  "申請自動化の効果は次期に再検討する。";

type Role = (typeof ROLES)[number];
type Month = (typeof MONTHS)[number];
type DaysByMonth = readonly [number, number, number];

const SUPPLY: Record<Role, DaysByMonth> = {
  DB担当: [18, 18, 16],
  開発担当: [22, 20, 20],
  QA担当: [8, 10, 10],
};

/** B adopted at 18 days, then the current quarter is edited to 12 days. */
const MUTATED_SUPPLY: Record<Role, DaysByMonth> = {
  ...SUPPLY,
  DB担当: [12, 18, 16],
};

type Initiative = {
  name: string;
  owner: string;
  effect: string;
  kind: "fixed" | "candidate";
  costManYen: number;
  demands: Record<Role, DaysByMonth>;
};

const INITIATIVES: Initiative[] = [
  {
    name: "基盤更改",
    owner: "佐藤",
    effect: "保守期限までに基盤を移行",
    kind: "fixed",
    costManYen: 600,
    demands: {
      DB担当: [12, 5, 3],
      開発担当: [8, 8, 5],
      QA担当: [2, 3, 4],
    },
  },
  {
    name: "申請自動化",
    owner: "田中",
    effect: "申請処理を平均5日から2日に短縮",
    kind: "candidate",
    costManYen: 400,
    demands: {
      DB担当: [10, 4, 2],
      開発担当: [8, 7, 5],
      QA担当: [2, 3, 4],
    },
  },
  {
    name: "顧客分析",
    owner: "鈴木",
    effect: "顧客レポートの集計を月20時間削減",
    kind: "candidate",
    costManYen: 300,
    demands: {
      DB担当: [6, 4, 2],
      開発担当: [6, 6, 4],
      QA担当: [2, 2, 3],
    },
  },
];

const portfoliosToRemove = new WeakMap<Page, number>();

test.beforeEach(async ({ page }) => {
  const response = await page.request.post("/api/auth/login", {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(response.status(), await response.text()).toBe(200);
});

test.afterEach(async ({ page }, info) => {
  info.setTimeout(15_000);
  const portfolioId = portfoliosToRemove.get(page);
  if (portfolioId === undefined) return;
  try {
    const response = await page.request.delete(`/api/portfolios/${portfolioId}`, { timeout: 10_000 });
    expect(response.status()).toBe(200);
  } catch (error) {
    if (info.status === info.expectedStatus) throw error;
    info.annotations.push({
      type: "cleanup",
      description: `Portfolio cleanup after the original failure: ${String(error)}`,
    });
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function waitForApi(page: Page, method: string, pathSuffix: string) {
  return page.waitForResponse((response) => {
    const pathname = new URL(response.url()).pathname;
    return response.request().method() === method && pathname.endsWith(pathSuffix);
  });
}

/** Start the API wait before the UI action, then await both together. */
async function runWithApiWait(
  page: Page,
  method: string,
  pathSuffix: string,
  action: () => Promise<void>,
) {
  const [response] = await Promise.all([waitForApi(page, method, pathSuffix), action()]);
  return response;
}

async function seedPortfolio(page: Page): Promise<{ id: number; name: string }> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const name = `投資計画E2E ${suffix}`;
  const response = await page.request.post("/api/portfolios", {
    data: { name, description: "投資計画の比較・採用・固定履歴を確認するE2E用ポートフォリオ" },
  });
  expect(response.status(), await response.text()).toBe(201);
  const { id } = await response.json() as { id: number };
  portfoliosToRemove.set(page, id);
  return { id, name };
}

function planningTab(page: Page, label: string): Locator {
  return page.getByRole("navigation", { name: "投資計画" }).getByRole("button", {
    name: label,
    exact: true,
  });
}

async function openTab(page: Page, label: string): Promise<void> {
  const tab = planningTab(page, label);
  await tab.click();
  await expect(tab).toHaveAttribute("aria-current", "page");
}

async function openPlanningFromPortfolio(page: Page, portfolio: { name: string }): Promise<void> {
  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { name: "共有ポートフォリオ", exact: true })).toBeVisible();

  // Select the existing shared portfolio by its visible name, not by its id.
  await page
    .getByRole("button", { name: new RegExp(escapeRegExp(portfolio.name)) })
    .click();
  await expect(page.getByRole("heading", { name: portfolio.name, exact: true })).toBeVisible();

  // This is the real entry point added to the existing portfolio workspace.
  await page.getByRole("link", { name: /投資計画を開く/ }).click();
  await expect(page).toHaveURL(/\/portfolio\/\d+\/planning\?view=ledger/);
  await expect(page.getByRole("navigation", { name: "投資計画" })).toBeVisible();
}

async function createQuarter(page: Page): Promise<void> {
  await page.getByRole("button", { name: "計画期間と予算を設定", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "計画期間と予算を設定", exact: true });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("年", { exact: true }).fill("2027");
  // The quarter select is wrapped by a <label>, so getByLabel(..., exact)
  // includes the option text. Scope from the visible label to the select and
  // use the actual option value.
  await dialog
    .locator("label")
    .filter({ hasText: "四半期" })
    .locator("select")
    .selectOption("1");
  await dialog.getByLabel("期間の予算上限（万円）", { exact: true }).fill(BUDGET_MAN_YEN);
  await dialog.getByLabel("職種（カンマ区切り・任意）", { exact: true }).fill(ROLES.join(", "));

  const response = await runWithApiWait(page, "POST", "/planning/periods", () =>
    dialog.getByRole("button", { name: "この四半期を作成", exact: true }).click(),
  );
  expect(response.status(), await response.text()).toBe(201);
  await expect(dialog).toHaveCount(0);

  const period = page.getByRole("combobox", { name: "対象四半期", exact: true });
  await expect(period).toBeVisible();
  await expect(period.locator("option:checked")).toHaveText(PERIOD_LABEL);
  await expect(page.getByRole("heading", { name: "案件台帳", exact: true })).toBeVisible();
}

async function createInitiative(page: Page, initiative: Initiative): Promise<void> {
  await page.getByRole("button", { name: "＋ 案件を登録", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "案件を登録", exact: true });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("案件名", { exact: true }).fill(initiative.name);
  await dialog.getByLabel("起案責任者", { exact: true }).fill(initiative.owner);
  await dialog.getByLabel("期間内の概算費用（万円）", { exact: true }).fill(String(initiative.costManYen));
  await dialog.getByLabel("期待効果", { exact: true }).fill(initiative.effect);
  // Same wrapping-label caveat as the quarter select: scope to the select and
  // use its option value.
  await dialog
    .locator("label")
    .filter({ hasText: "案件の扱い" })
    .locator("select")
    .selectOption(initiative.kind);

  for (const role of ROLES) {
    for (const month of MONTHS) {
      await dialog
        .getByLabel(`${role} ${month}月の需要（人日）`, { exact: true })
        .fill(String(initiative.demands[role][month - 1]));
    }
  }

  const response = await runWithApiWait(page, "POST", "/planning/initiatives", () =>
    dialog.getByRole("button", { name: "案件を登録", exact: true }).click(),
  );
  expect(response.status(), await response.text()).toBe(201);
  await expect(dialog).toHaveCount(0);

  await expect(page.getByRole("region", { name: "案件一覧" })).toContainText(initiative.name);
}

async function saveCapacities(page: Page, supply: Record<Role, DaysByMonth>): Promise<void> {
  await page.getByRole("button", { name: "配賦枠を編集", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "月別の配賦枠を編集", exact: true });
  await expect(dialog).toBeVisible();

  for (const role of ROLES) {
    for (const month of MONTHS) {
      await dialog
        .getByLabel(`${role} ${month}月の配賦枠（人日）`, { exact: true })
        .fill(String(supply[role][month - 1]));
    }
  }

  const response = await runWithApiWait(page, "PUT", "/capacity", () =>
    dialog.getByRole("button", { name: "配賦枠を保存", exact: true }).click(),
  );
  expect(response.status(), await response.text()).toBe(200);
  await expect(dialog).toHaveCount(0);
}

function capacityCell(page: Page, role: Role, month: Month): Locator {
  return page
    .getByRole("region", { name: "月別の職種別需給" })
    .getByRole("row")
    .filter({ hasText: role })
    .getByRole("button", { name: new RegExp(`${month}月の内訳`) });
}

function scenarioCard(page: Page, label: "A案" | "B案"): Locator {
  return page.getByRole("article").filter({
    has: page.getByRole("heading", { name: label, exact: true }),
  });
}

async function setScenarioInclusion(
  page: Page,
  slot: 0 | 1,
  initiativeName: string,
  included: boolean,
): Promise<void> {
  const label = `${slot === 0 ? "A" : "B"}案に${initiativeName}を含める`;
  const checkbox = page.getByRole("checkbox", { name: label, exact: true });
  if ((await checkbox.isChecked()) !== included) {
    // This is a controlled checkbox: it only reflects the new state after the
    // PUT and the following reload. Click normally and await the response in
    // parallel instead of using check()/uncheck(), which would wait on the
    // controlled state and race the server update.
    const response = await runWithApiWait(page, "PUT", `/scenarios/${slot}`, () =>
      checkbox.click(),
    );
    expect(response.status(), await response.text()).toBe(200);
  }
  await expect(checkbox).toBeChecked({ checked: included });
}

function compareSupplyRow(page: Page, role: Role, month: Month): Locator {
  return page
    .getByRole("region", { name: "月別・職種別の需給比較" })
    .getByRole("row")
    .filter({ hasText: role })
    .filter({ hasText: `${month}月` });
}

async function adoptB(page: Page): Promise<void> {
  const card = scenarioCard(page, "B案");
  await card.getByRole("button", { name: /B案を採用/ }).click();
  const dialog = page.getByRole("dialog", { name: "B案を採用", exact: true });
  await expect(dialog).toBeVisible();

  // The adoption dialog must show both the accepted and skipped scope.
  await expect(dialog).toContainText("投資額 900 万円");
  await expect(dialog).toContainText("予算 1,000 万円");
  await expect(dialog.getByRole("heading", { name: "今期に実施", exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "今期は見送り", exact: true })).toBeVisible();
  await expect(dialog).toContainText("基盤更改");
  await expect(dialog).toContainText("顧客分析");
  await expect(dialog.getByText("申請自動化", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("見送る効果: 申請処理を平均5日から2日に短縮", { exact: true }),
  ).toBeVisible();

  await dialog.getByLabel("採用理由", { exact: true }).fill(REASON);
  const response = await runWithApiWait(page, "POST", "/decisions", () =>
    dialog.getByRole("button", { name: "理由とともに採用", exact: true }).click(),
  );
  expect(response.status(), await response.text()).toBe(201);
  await expect(dialog).toHaveCount(0);

  await expect(page.getByText(/採用記録\s*B案/).first()).toBeVisible();
  await expect(page.locator("#decision-history")).toContainText(REASON);
}

async function expectFrozenDecision(page: Page): Promise<void> {
  const history = page.locator("#decision-history");
  await expect(history).toBeVisible();
  await expect(history.getByRole("heading", { name: "決定履歴", exact: true })).toBeVisible();
  await expect(history.getByText("1件", { exact: true })).toBeVisible();

  // Only the adoption created a decision; changing the live trial must not add
  // another row. Nested skipped-item <li> elements are deliberately excluded.
  const items = history.locator("ol > li");
  await expect(items).toHaveCount(1);
  const item = items.first();
  await expect(item.getByRole("heading", { name: "B案を採用", exact: true })).toBeVisible();
  await expect(item).toContainText(REASON);
  await expect(item).toContainText("予算 1,000 万円");

  const details = item.locator("details");
  await expect(details).toHaveCount(2);
  const aDetails = details.filter({ hasText: "A案" });
  const bDetails = details.filter({ hasText: "B案" });
  await expect(aDetails).toHaveCount(1);
  await expect(bDetails).toHaveCount(1);

  if (await aDetails.getAttribute("open") === null) await aDetails.locator("summary").click();
  if (await bDetails.getAttribute("open") === null) await bDetails.locator("summary").click();
  await expect(aDetails).toHaveAttribute("open", "");
  await expect(bDetails).toHaveAttribute("open", "");

  // A lost. Its frozen assumptions stay at 22/18 with 4 days short.
  const aRow = aDetails
    .getByRole("region", { name: "A案の採用時点の月別需給" })
    .getByRole("row")
    .filter({ hasText: "DB担当" });
  await expect(aRow.getByRole("cell").nth(0)).toHaveText(/22\s*\/\s*18（不足 4）/);
  await expect(aDetails).toContainText("投資額 1,000 万円");
  await expect(aDetails).toContainText("予算残 0 万円");
  await expect(aDetails).toContainText("申請自動化");
  await expect(aDetails).toContainText("見送る効果: 顧客レポートの集計を月20時間削減");

  // B was adopted. The live capacity change to 12 days must not rewrite it.
  const bRow = bDetails
    .getByRole("region", { name: "B案の採用時点の月別需給" })
    .getByRole("row")
    .filter({ hasText: "DB担当" });
  await expect(bRow.getByRole("cell").nth(0)).toHaveText(/18\s*\/\s*18（残り 0）/);
  await expect(bDetails).toContainText("投資額 900 万円");
  await expect(bDetails).toContainText("予算残 100 万円");
  await expect(bDetails).toContainText("顧客分析");
  await expect(bDetails).toContainText("見送る効果: 申請処理を平均5日から2日に短縮");
}

test("A/B comparison adopts B and freezes both alternatives after the live trial changes", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const portfolio = await seedPortfolio(page);

  // Entry through the existing shared-portfolio screen.
  await openPlanningFromPortfolio(page, portfolio);
  await createQuarter(page);

  // Three estimates through the ledger dialog.
  for (const initiative of INITIATIVES) await createInitiative(page, initiative);

  const ledger = page.getByRole("region", { name: "案件一覧" });
  await expect(ledger.getByRole("row")).toHaveCount(1 + INITIATIVES.length);
  for (const initiative of INITIATIVES) {
    const row = ledger.getByRole("row").filter({ hasText: initiative.name });
    await expect(row).toContainText(initiative.owner);
    await expect(row).toContainText(initiative.effect);
    await expect(row).toContainText(`${initiative.costManYen} 万円`);
    await expect(row).toContainText(initiative.kind === "fixed" ? "全案に固定" : "比較候補");
  }

  // Roles from the quarter dialog and the month-by-month allocation.
  await openTab(page, "職種別の余力");
  const capacityTable = page.getByRole("region", { name: "月別の職種別需給" });
  for (const role of ROLES) {
    await expect(capacityTable.getByRole("rowheader", { name: role, exact: true })).toBeVisible();
  }
  await saveCapacities(page, SUPPLY);

  // Before either candidate is selected, the fixed-only view is 12 / 18 with
  // 6 days remaining. This is the plan's fixed-case acceptance number.
  await expect(capacityCell(page, "DB担当", 1)).toContainText(/12\s*\/\s*18/);
  await expect(capacityCell(page, "DB担当", 1)).toContainText("残り 6 人日");

  // Build A = fixed + 申請自動化, B = fixed + 顧客分析.
  await openTab(page, "投資シナリオ比較");
  await setScenarioInclusion(page, 0, "申請自動化", true);
  await setScenarioInclusion(page, 0, "顧客分析", false);
  await setScenarioInclusion(page, 1, "申請自動化", false);
  await setScenarioInclusion(page, 1, "顧客分析", true);

  // With the combinations saved, A needs 22 DB days in January and B needs 18.
  await openTab(page, "職種別の余力");
  await expect(capacityCell(page, "DB担当", 1)).toContainText(/22\s*\/\s*18/);
  await expect(capacityCell(page, "DB担当", 1)).toContainText("不足 4 人日");
  await expect(capacityCell(page, "開発担当", 1)).toContainText(/16\s*\/\s*22/);

  const preview = page.getByRole("group", { name: "表示する案" });
  await preview.getByRole("button", { name: "B案", exact: true }).click();
  await expect(preview.getByRole("button", { name: "B案", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(capacityCell(page, "DB担当", 1)).toContainText(/18\s*\/\s*18/);
  await expect(capacityCell(page, "DB担当", 1)).toContainText("残り 0 人日");
  await expect(capacityCell(page, "開発担当", 1)).toContainText(/14\s*\/\s*22/);

  await openTab(page, "投資シナリオ比較");

  const aCard = scenarioCard(page, "A案");
  const bCard = scenarioCard(page, "B案");
  await expect(aCard).toContainText(/1,000\s*万円/);
  await expect(aCard).toContainText("要調整");
  await expect(aCard).toContainText("1月 DB担当 4人日");
  await expect(bCard).toContainText(/900\s*万円/);
  await expect(bCard).toContainText("予算残 100 万円");
  await expect(bCard).toContainText("制約内");

  // The comparison table states both 18 and 22 days explicitly.
  const january = compareSupplyRow(page, "DB担当", 1);
  await expect(january.getByRole("cell").nth(0)).toHaveText("1月");
  await expect(january.getByRole("cell").nth(1)).toContainText(/22\s*\/\s*18（不足 4）/);
  await expect(january.getByRole("cell").nth(2)).toContainText(/18\s*\/\s*18（残り 0）/);

  await adoptB(page);

  // Mutate the current trial only: reduce the January DB allocation to 12.
  await openTab(page, "職種別の余力");
  await saveCapacities(page, MUTATED_SUPPLY);
  await openTab(page, "投資シナリオ比較");

  const changedA = scenarioCard(page, "A案");
  const changedB = scenarioCard(page, "B案");
  await expect(changedA).toContainText("1月 DB担当 10人日");
  await expect(changedB).toContainText("1月 DB担当 6人日");
  await expect(compareSupplyRow(page, "DB担当", 1).getByRole("cell").nth(1)).toContainText(
    /22\s*\/\s*12（不足 10）/,
  );
  await expect(compareSupplyRow(page, "DB担当", 1).getByRole("cell").nth(2)).toContainText(
    /18\s*\/\s*12（不足 6）/,
  );

  // Reload against the server, then confirm the live trial is still changed and
  // the adopted decision still holds both original alternatives.
  await page.reload();
  await expect(planningTab(page, "投資シナリオ比較")).toHaveAttribute("aria-current", "page");
  await expect(scenarioCard(page, "B案")).toContainText("1月 DB担当 6人日");
  await expect(page.getByText(/採用記録\s*B案/).first()).toBeVisible();
  await expect(page.locator("#decision-history")).toContainText(REASON);
  await expectFrozenDecision(page);
});
