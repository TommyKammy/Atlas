import { expect, test, type Page } from "@playwright/test";

const credentials = { email: "admin@example.com", password: "atlas-dev-2026" };
const PANE_URL = "/projects/1?view=list&task=2";
const CLOCK = new Date("2026-11-17T10:00:00+09:00");

test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: credentials })).status()).toBe(200);
  await page.clock.setFixedTime(CLOCK);
});

async function openPane(page: Page, url = PANE_URL) {
  await page.goto(url);
  const pane = page.locator("[data-task-pane]");
  await expect(pane).toBeVisible();
  await expect(pane.locator('[data-task-draft-field="name"]')).toHaveAttribute("data-task-draft-ready", "true");
  return pane;
}

test("the pane uses the 440px C workbench width and surface at the large breakpoints", async ({ page }) => {
  const pane = await openPane(page);

  for (const [width, expected] of [
    [1440, 440],
    [1280, 440],
    [1024, 440],
    [900, 480],
    [768, 480],
  ] as const) {
    await page.setViewportSize({ width, height: 1000 });
    const box = (await pane.boundingBox())!;
    expect(Math.round(box.width), `pane width at ${width}px`).toBe(expected);
  }

  const styles = await pane.evaluate((element) => {
    const style = getComputedStyle(element);
    const header = element.firstElementChild as HTMLElement;
    const headerStyle = getComputedStyle(header);
    return {
      background: style.backgroundColor,
      borderLeftWidth: style.borderLeftWidth,
      borderTopWidth: style.borderTopWidth,
      headerPaddingLeft: headerStyle.paddingLeft,
      headerPaddingTop: headerStyle.paddingTop,
    };
  });
  expect(styles.background).toBe("rgb(250, 250, 251)");
  expect(styles.borderLeftWidth).toBe("1px");
  expect(styles.borderTopWidth).toBe("0px");
  expect(styles.headerPaddingLeft).toBe("26px");
  expect(styles.headerPaddingTop).toBe("18px");

  const contentPadding = await pane
    .locator("[data-task-pane-content]")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { left: style.paddingLeft, top: style.paddingTop };
    });
  expect(contentPadding).toEqual({ left: "26px", top: "18px" });
});

test("the top row summarizes the list state and marks overdue days with text and a shape", async ({ page }) => {
  const pane = await openPane(page);
  await page.setViewportSize({ width: 1440, height: 1000 });

  const summary = pane.locator("[data-task-state-summary]");
  await expect(summary).toHaveText("遅延 ・ 20%");

  const badge = pane.locator("[data-task-overdue-badge]");
  await expect(badge).toHaveText("3日 超過");
  await expect(badge.locator("svg")).toHaveCount(1);
  await expect(badge).toHaveAttribute("data-overdue-days", "3");
  expect(await badge.evaluate((element) => getComputedStyle(element).color)).toBe("rgb(184, 50, 40)");
  expect(await badge.evaluate((element) => getComputedStyle(element).borderColor)).toBe("rgb(233, 182, 176)");

  const notOverdue = await openPane(page, "/projects/1?view=list&task=3");
  await expect(notOverdue.locator("[data-task-state-summary]")).toHaveText("未着手 ・ 0%");
  await expect(notOverdue.locator("[data-task-overdue-badge]")).toHaveCount(0);
});

test("the title, property grid and section spacing follow the mockup", async ({ page }) => {
  // The seed has no custom fields or attachments, so create one of each for
  // the rows this test measures and remove them afterwards.
  const field = await page.request.post("/api/custom-fields", {
    data: { project_id: 1, name: `レイアウト確認 ${test.info().testId}`, field_type: "text" },
  });
  expect(field.status()).toBe(201);
  const { id: fieldId } = await field.json() as { id: number };
  const attachment = await page.request.post("/api/attachments", { multipart: {
    task_id: "2", file: { name: "layout-check.txt", mimeType: "text/plain", buffer: Buffer.from("layout check") },
  } });
  expect(attachment.status()).toBe(201);
  const { id: attachmentId } = await attachment.json() as { id: number };
  try {
    await checkTitleGridAndSections(page);
  } finally {
    expect((await page.request.delete(`/api/attachments/${attachmentId}`)).status()).toBe(200);
    expect((await page.request.delete(`/api/custom-fields/${fieldId}`)).status()).toBe(200);
  }
});

async function checkTitleGridAndSections(page: Page) {
  const pane = await openPane(page);
  await page.setViewportSize({ width: 1440, height: 1000 });

  const title = pane.getByRole("textbox", { name: "タスク名", exact: true });
  const titleStyle = await title.evaluate((element) => {
    const style = getComputedStyle(element);
    return { size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight };
  });
  expect(titleStyle).toEqual({ size: "20px", weight: "700", lineHeight: "28px" });

  const fields = pane.locator("[data-task-fields]");
  const grid = await fields.evaluate((element) => {
    const style = getComputedStyle(element);
    const row = element.firstElementChild as HTMLElement;
    const rowStyle = getComputedStyle(row);
    const label = row.firstElementChild as HTMLElement;
    return {
      rowGap: style.rowGap,
      columns: rowStyle.gridTemplateColumns,
      labelWidth: label.getBoundingClientRect().width,
      rowBorderBottom: rowStyle.borderBottomWidth,
    };
  });
  expect(grid.rowGap).toBe("12px");
  expect(grid.columns.split(" ")[0]).toBe("80px");
  expect(grid.labelWidth).toBe(80);
  expect(grid.rowBorderBottom).toBe("0px");

  const customLabel = pane.locator("[data-task-custom-fields] > div").first().locator("span").first();
  expect(Math.round((await customLabel.boundingBox())!.width)).toBe(80);

  const subtaskHeading = pane.locator("[data-task-subtasks] h3");
  await expect(subtaskHeading).toHaveText("子タスク 1 / 2");
  const subtaskRow = pane.locator("[data-subtask-row]").first();
  expect(await subtaskRow.evaluate((element) => getComputedStyle(element).borderBottomWidth)).toBe("0px");

  const attachment = pane.locator("[data-attachment-id]").first();
  expect(await attachment.evaluate((element) => getComputedStyle(element).borderWidth)).toBe("0px");

  const feed = pane.locator("[data-task-feed]");
  expect(await feed.evaluate((element) => getComputedStyle(element.firstElementChild!).borderBottomWidth)).toBe("0px");
  expect(await feed.evaluate((element) => getComputedStyle(element).marginTop)).toBe("20px");
}

test("the status row shows status and progress together and the comment field is pinned at 44px", async ({ page }) => {
  const pane = await openPane(page);
  await page.setViewportSize({ width: 1440, height: 1000 });

  const statusRow = pane.locator("[data-task-status-row]");
  await expect(statusRow.locator("summary")).toHaveText("進行中");
  await expect(statusRow.locator('[data-task-draft-field="progress"]')).toHaveValue("20");

  const chipBox = (await statusRow.locator("summary").boundingBox())!;
  const progressBox = (await statusRow.locator('[data-task-draft-field="progress"]').boundingBox())!;
  expect(Math.abs(chipBox.y + chipBox.height / 2 - (progressBox.y + progressBox.height / 2))).toBeLessThanOrEqual(2);

  const field = pane.locator("[data-comment-field]");
  await expect(field).toBeVisible();
  const fieldBox = (await field.boundingBox())!;
  const fieldStyle = await field.evaluate((element) => {
    const style = getComputedStyle(element);
    return { radius: style.borderRadius, border: style.borderWidth, background: style.backgroundColor };
  });
  expect(Math.abs(fieldBox.height - 44)).toBeLessThanOrEqual(1);
  expect(fieldStyle).toEqual({ radius: "8px", border: "1px", background: "rgb(255, 255, 255)" });

  const viewport = page.viewportSize()!;
  expect(Math.abs(fieldBox.y + fieldBox.height - (viewport.height - 22))).toBeLessThanOrEqual(1);
});

test("the pane still fills the viewport at 375px and keeps its header actions reachable", async ({ page }) => {
  const pane = await openPane(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(100);

  const paneBox = (await pane.boundingBox())!;
  expect(Math.round(paneBox.width)).toBe(375);
  expect(Math.round(paneBox.height)).toBe(812);
  await expect(pane.locator("[data-task-state-summary]")).toBeVisible();
  await expect(pane.locator("[data-task-overdue-badge]")).toBeVisible();
  await expect(pane.getByRole("link", { name: "詳細を閉じる", exact: true })).toBeVisible();

  // The copy and fullscreen shortcuts move into the overflow menu at this width.
  const copy = pane.locator('button[aria-label="タスクのリンクをコピー"]');
  await expect(copy).toBeHidden();
  await expect(pane.locator('button[aria-label="フルスクリーン"]')).toBeHidden();
  await expect(pane.locator('summary[aria-label="このタスクの他のアクション"]')).toBeVisible();

  const scroll = pane.locator("[data-task-pane-scroll]");
  const scrollBox = (await scroll.boundingBox())!;
  expect(scrollBox.width).toBeLessThanOrEqual(375.5);
  expect(await scroll.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

  const field = pane.locator("[data-comment-field]");
  const fieldBox = (await field.boundingBox())!;
  expect(Math.abs(fieldBox.height - 44)).toBeLessThanOrEqual(1);
  expect(fieldBox.x).toBeGreaterThanOrEqual(0);
  expect(fieldBox.x + fieldBox.width).toBeLessThanOrEqual(375);
});

test("fullscreen still expands the pane and returns to the 440px dock", async ({ page }) => {
  const pane = await openPane(page);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await pane.getByRole("button", { name: "フルスクリーン", exact: true }).click();
  const expanded = (await pane.boundingBox())!;
  expect(Math.round(expanded.x)).toBe(0);
  expect(Math.round(expanded.y)).toBe(0);
  expect(Math.round(expanded.width)).toBe(1440);
  expect(Math.round(expanded.height)).toBe(1000);

  await pane.getByRole("button", { name: "全画面を終了", exact: true }).click();
  const restored = (await pane.boundingBox())!;
  expect(Math.round(restored.width)).toBe(440);
});
