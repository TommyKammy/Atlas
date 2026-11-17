import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  THEMES,
  auditPage,
  pageEntries,
  waitForPageReady,
  type ContrastViolation,
} from "./helpers/contrast-audit.mjs";

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "atlas-dev-2026";
const CLOCK = process.env.ATLAS_UI_NOW ?? "2026-11-17T10:00:00+09:00";
const BASELINE_PATH = resolve(process.cwd(), "tests/fixtures/contrast-baseline.json");

type Baseline = { violations?: Array<Pick<ContrastViolation, "key">> };

function readBaselineKeys(): Set<string> {
  let baseline: Baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
  } catch (error) {
    throw new Error(
      `contrast baseline is missing or invalid at ${BASELINE_PATH}; regenerate it with ` +
        `ATLAS_UI_CONTRAST_WRITE_BASELINE=1 bash tests/run-e2e.sh ui-contrast`,
      { cause: error },
    );
  }
  if (!Array.isArray(baseline.violations)) {
    throw new Error(`contrast baseline at ${BASELINE_PATH} has no violations array`);
  }
  return new Set(baseline.violations.map((violation) => violation.key));
}

async function login(page: Page): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(response.ok()).toBeTruthy();
}

test.describe("contrast audit", () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    reducedMotion: "reduce",
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("no new WCAG AA violations compared with the baseline", async ({ page }) => {
    test.setTimeout(300_000);
    const baseURL = test.info().project.use.baseURL;
    expect(baseURL, "baseURL must be set by playwright.config.ts").toBeTruthy();
    const baselineKeys = readBaselineKeys();
    const violations: ContrastViolation[] = [];

    await page.clock.setFixedTime(new Date(CLOCK));
    for (const theme of THEMES) {
      await page.context().addCookies([{ name: "atlas_theme", value: theme, url: baseURL! }]);
      for (const entry of pageEntries(process.env.ATLAS_UI_PAGES)) {
        await test.step(`${entry.name} (${theme})`, async () => {
          await waitForPageReady(page, `${baseURL}${entry.route}`);
          violations.push(...(await auditPage(page, { pageName: entry.name, theme })));
        });
      }
    }

    const newViolations = violations.filter((violation) => !baselineKeys.has(violation.key));
    console.log(
      `contrast audit: ${violations.length} violation(s) across ${THEMES.length * pageEntries(process.env.ATLAS_UI_PAGES).length} page/theme combinations; ${baselineKeys.size} baseline key(s)`,
    );
    const detail = newViolations.map((violation) => ({
      page: violation.page,
      theme: violation.theme,
      fg: violation.fg,
      bg: violation.bg,
      fontSize: violation.fontSize,
      fontWeight: violation.fontWeight,
      ratio: violation.ratio,
      threshold: violation.threshold,
      sample: violation.sample,
    }));
    expect(
      newViolations,
      `${newViolations.length} new contrast violation(s): ${JSON.stringify(detail, null, 2)}`,
    ).toEqual([]);
  });
});
