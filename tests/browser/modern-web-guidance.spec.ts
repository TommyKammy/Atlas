import { expect, test, type Page } from "@playwright/test";

const fixtures = new WeakMap<Page, { projectId: number; attachments: number[] }>();
const credentials = { email: "admin@example.com", password: "atlas-dev-2026" };

test.afterEach(async ({ page }) => {
  const fixture = fixtures.get(page);
  if (!fixture) return;
  for (const id of fixture.attachments) await page.request.delete(`/api/attachments/${id}`);
  expect((await page.request.delete(`/api/projects/${fixture.projectId}`)).status()).toBe(200);
});

async function fixture(page: Page) {
  expect((await page.request.post("/api/auth/login", { data: credentials })).status()).toBe(200);
  const project = await page.request.post("/api/projects", { data: { workspace_id: 1, name: `Modern Web ${test.info().testId}` } });
  expect(project.status()).toBe(201);
  const { id: projectId } = await project.json();
  fixtures.set(page, { projectId, attachments: [] });
  const task = await page.request.post("/api/tasks", { data: { project_id: projectId, name: "Modern web task" } });
  expect(task.status()).toBe(201);
  const { id: taskId } = await task.json();
  return { projectId: Number(projectId), taskId: Number(taskId) };
}

async function upload(page: Page, taskId: number, name = "modern-preview.txt", content = "プレビュー確認".repeat(2000)) {
  const res = await page.request.post("/api/attachments", { multipart: {
    task_id: String(taskId), file: { name, mimeType: "text/plain", buffer: Buffer.from(content) },
  } });
  expect(res.status()).toBe(201);
  const { id } = await res.json(); fixtures.get(page)!.attachments.push(Number(id)); return Number(id);
}


test("MW01 production CSP authorizes framework scripts and hydration without allowing injected scripts", async ({ page }) => {
  const violations: string[] = [];
  await page.exposeFunction("recordCspViolation", (directive: string) => violations.push(directive));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (event) => {
    (window as unknown as { recordCspViolation: (directive: string) => void }).recordCspViolation(event.effectiveDirective);
  }));
  const response = await page.goto("/login");
  const policy = response!.headers()["content-security-policy"];
  const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  const scripts = await page.locator("script").evaluateAll((elements) => elements.map((element) => (element as HTMLScriptElement).nonce));
  expect(scripts.length).toBeGreaterThan(0);
  expect(scripts.every((value) => value === nonce)).toBe(true);
  // Signed-out screens have no app chrome (and therefore no theme toggle).
  // Exercise the toggle on the signed-in shell instead.
  expect((await page.request.post("/api/auth/login", { data: credentials })).status()).toBe(200);
  await page.goto("/");
  const toggle = page.locator("[data-sidebar-footer] [data-theme-toggle]");
  await toggle.click(); await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(violations).toEqual([]);
  // Use a separate page so the theme's router.refresh cannot interrupt the
  // attack navigation; inject into HTTP HTML to exercise parser-enforced CSP.
  const attacked = await page.context().newPage();
  await attacked.exposeFunction("recordCspViolation", (directive: string) => violations.push(directive));
  await attacked.addInitScript(() => document.addEventListener("securitypolicyviolation", (event) => {
    (window as unknown as { recordCspViolation: (directive: string) => void }).recordCspViolation(event.effectiveDirective);
  }));
  try {
    await attacked.route("**/login", async (route) => {
      const result = await route.fetch();
      const html = (await result.text()).replace("</body>", "<script>document.body.dataset.untrustedExecuted='yes'</script></body>");
      await route.fulfill({ response: result, body: html });
    });
    await attacked.goto("/login");
    await expect.poll(() => violations.length).toBeGreaterThan(0);
    await expect(attacked.locator("body")).not.toHaveAttribute("data-untrusted-executed", "yes");
  } finally { await attacked.close(); }
});

test("MW02 conditional dialogs use native modality, contain keyboard navigation, dismiss and restore focus", async ({ page }) => {
  const { projectId } = await fixture(page);
  await page.goto(`/projects/${projectId}?view=forms`);
  const trigger = page.locator("[data-form-new]");
  await trigger.focus();
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name: "フォームを作成", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveJSProperty("open", true);
  expect(await dialog.evaluate((el) => el.matches(":modal"))).toBe(true);
  await trigger.evaluate((el) => (el as HTMLElement).focus());
  expect(await trigger.evaluate((el) => el === document.activeElement)).toBe(false);
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement === document.body || !!document.activeElement?.closest("dialog:modal"))).toBe(true);
  }
  await page.keyboard.press("Escape"); await expect(page.locator("[data-form-builder]")).toHaveCount(0); await expect(trigger).toBeFocused();
  await trigger.press("Enter"); await expect(dialog).toBeVisible();
  await page.mouse.click(4, 4); await expect(page.locator("[data-form-builder]")).toHaveCount(0); await expect(trigger).toBeFocused();
  await page.setViewportSize({ width: 390, height: 780 });
  await trigger.press("Enter"); await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  const screenshot = test.info().outputPath("mobile-form-dialog.png");
  await page.screenshot({ path: screenshot });
  await test.info().attach("mobile-form-dialog", { path: screenshot, contentType: "image/png" });
  await dialog.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(page.locator("[data-form-builder]")).toHaveCount(0); await expect(trigger).toBeFocused();
});

test("MW03 attachments can be added and deleted with the keyboard while a nested confirmation owns focus", async ({ page, browserName }) => {
  const { projectId, taskId } = await fixture(page);
  await page.goto(`/projects/${projectId}?view=list&task=${taskId}`);
  const pane = page.locator("[data-task-pane]");
  // macOS WebKit follows Safari: Option+Tab includes buttons by default.
  const nextControl = browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab";
  await expect(pane.locator('[data-task-draft-field="name"]')).toHaveAttribute("data-task-draft-ready", "true");
  const input = pane.locator('input[type="file"]').first();
  await input.focus(); await expect(input).toBeFocused();
  const chooser = page.waitForEvent("filechooser"); await input.press("Enter");
  const added = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/attachments" && r.request().method() === "POST");
  await (await chooser).setFiles({ name: "keyboard.txt", mimeType: "text/plain", buffer: Buffer.from("Keyboard upload") });
  const uploaded = await added; expect(uploaded.status()).toBe(201);
  const { id } = await uploaded.json(); fixtures.get(page)!.attachments.push(Number(id));
  const link = pane.getByRole("link", { name: "keyboard.txt", exact: true });
  await link.focus(); await link.press(nextControl);
  const remove = pane.getByRole("button", { name: "keyboard.txt を削除", exact: true });
  await expect(remove).toBeFocused(); await expect(remove).toBeVisible();
  await remove.press("Enter");
  const confirm = page.locator("dialog:modal"); await expect(confirm).toBeVisible();
  await expect(confirm.locator("[data-confirm-cancel]")).toBeFocused();
  await page.keyboard.press(nextControl); await expect(confirm.locator("[data-confirm-ok]")).toBeFocused();
  let returnedToCancel = false;
  for (let index = 0; index < 6; index++) {
    await page.keyboard.press(nextControl);
    const state = await page.evaluate(() => ({
      contained: document.activeElement === document.body || !!document.activeElement?.closest("dialog:modal"),
      cancel: document.activeElement?.hasAttribute("data-confirm-cancel"),
    }));
    expect(state.contained).toBe(true); returnedToCancel ||= state.cancel === true;
  }
  expect(returnedToCancel).toBe(true);
  await page.keyboard.press("Escape"); await expect(confirm).not.toBeVisible();
  await expect(pane).toBeVisible(); await expect(remove).toBeFocused();
  await remove.press("Enter"); await confirm.locator("[data-confirm-ok]").press("Enter");
  await expect(link).toHaveCount(0); fixtures.get(page)!.attachments = [];
});

function contrast(foreground: string, background: string) {
  const luminance = (color: string) => {
    const values = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return values.reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  };
  const a = luminance(foreground); const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("MW04 saved rich text remains readable in dark mode and persists through reload", async ({ page }) => {
  const { projectId, taskId } = await fixture(page);
  expect((await page.request.patch(`/api/tasks/${taskId}`, { data: { description_doc: { type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Dark heading" }] },
    { type: "paragraph", content: [{ type: "text", text: "Dark body" }] },
  ] } } })).status()).toBe(200);
  await page.context().addCookies([{ name: "atlas_theme", value: "dark", url: test.info().project.use.baseURL! }]);
  await page.goto(`/projects/${projectId}?view=list&task=${taskId}`);
  await page.reload();
  const rich = page.locator("[data-task-description] .atlas-rich-text");
  await expect(rich.getByText("Dark body", { exact: true })).toBeVisible();
  const colors = await rich.evaluate((el) => {
    let surface: Element | null = el; let background = "rgba(0, 0, 0, 0)";
    while (surface) { background = getComputedStyle(surface).backgroundColor; if (background !== "rgba(0, 0, 0, 0)") break; surface = surface.parentElement; }
    return { background, text: getComputedStyle(el.querySelector("p")!).color, heading: getComputedStyle(el.querySelector("h2")!).color };
  });
  expect(contrast(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(colors.heading, colors.background)).toBeGreaterThanOrEqual(4.5);
});

test("MW05 login and MFA labels stay visible after typing and select their associated inputs", async ({ page }) => {
  await page.goto("/login");
  const form = page.locator("[data-login-form]");
  for (const [label, value] of [["メールアドレス", "label@example.test"], ["パスワード", "Password-2026!"]]) {
    await form.getByLabel(label, { exact: true }).fill(value);
    const visibleLabel = form.locator("label").filter({ hasText: label });
    await expect(visibleLabel).toBeVisible(); await visibleLabel.click(); await expect(form.getByLabel(label, { exact: true })).toBeFocused();
  }
  await page.route("**/api/auth/login", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ two_factor_required: true }) }));
  await form.getByRole("button", { name: "ログイン", exact: true }).click();
  await form.getByLabel("認証アプリのコード", { exact: true }).fill("123456");
  await expect(form.locator("label").filter({ hasText: "認証アプリのコード" })).toBeVisible();
  await form.getByRole("button", { name: "リカバリーコードを使う", exact: true }).click();
  await form.getByLabel("リカバリーコード", { exact: true }).fill("ABCD-1234");
  await expect(form.locator("label").filter({ hasText: "リカバリーコード" })).toBeVisible();
});

test("MW06 required form fields block empty submission, associate server errors and preserve answers", async ({ page }) => {
  const { projectId } = await fixture(page);
  const created = await page.request.post("/api/forms", { data: { project_id: projectId, name: "Required answers", fields: [
    { key: "title", label: "依頼名", type: "text", required: true, options: [] },
    { key: "details", label: "詳細", type: "textarea", required: true, options: [] },
    { key: "kind", label: "種類", type: "select", required: true, options: ["相談", "依頼"] },
  ] } }); expect(created.status()).toBe(201); const { id: formId } = await created.json();
  expect((await page.request.patch(`/api/forms/${formId}`, { data: { published: true } })).status()).toBe(200);
  await page.goto(`/projects/${projectId}?view=forms`); await page.locator(`[data-form-answer="${formId}"]`).click();
  const dialog = page.getByRole("dialog", { name: "Required answers", exact: true });
  const title = dialog.getByLabel("依頼名", { exact: false }); const details = dialog.getByLabel("詳細", { exact: false }); const kind = dialog.getByLabel("種類", { exact: false });
  for (const control of [title, details, kind]) await expect(control).toHaveAttribute("required", "");
  let submits = 0; page.on("request", (req) => { if (req.url().endsWith(`/api/forms/${formId}/submit`)) submits++; });
  await dialog.getByRole("button", { name: "送信", exact: true }).click(); await expect(title).toBeFocused(); expect(submits).toBe(0);
  await title.fill("   "); await details.fill("保持される詳細"); await kind.selectOption("相談");
  const failed = page.waitForResponse((r) => r.url().endsWith(`/api/forms/${formId}/submit`));
  await dialog.getByRole("button", { name: "送信", exact: true }).click(); expect((await failed).status()).toBe(400);
  await expect(title).toBeFocused(); await expect(title).toHaveAttribute("aria-invalid", "true");
  const error = dialog.getByRole("alert"); await expect(error).toContainText("依頼名");
  expect(await title.getAttribute("aria-describedby")).toBe(await error.getAttribute("id"));
  await expect(details).toHaveValue("保持される詳細"); await expect(kind).toHaveValue("相談");
  await title.fill("修正済みの依頼"); await expect(title).not.toHaveAttribute("aria-invalid", "true");
  const success = page.waitForResponse((r) => r.url().endsWith(`/api/forms/${formId}/submit`));
  await dialog.getByRole("button", { name: "送信", exact: true }).click(); expect((await success).status()).toBe(201);
  await expect(dialog).toHaveCount(0); await expect(page.locator("[data-forms]").getByRole("status")).toContainText("回答を送信");
});

test("MW07 text snippets have a server byte limit, downloads stay complete and closing aborts pending previews", async ({ page }) => {
  const { projectId, taskId } = await fixture(page);
  const content = "プレビュー確認".repeat(20000); const id = await upload(page, taskId, "bounded.txt", content);
  const preview = await page.request.get(`/api/attachments/${id}?inline=1&preview=1`);
  expect(preview.status()).toBe(200); expect((await preview.body()).length).toBeLessThanOrEqual(4096);
  expect(preview.headers()["content-type"]).toContain("text/plain");
  expect((await page.request.get(`/api/attachments/${id}?inline=1&preview=1`, { headers: { Cookie: "" } })).status()).toBe(401);
  const download = await page.request.get(`/api/attachments/${id}`); expect(await download.text()).toBe(content);
  await page.goto(`/projects/${projectId}?view=list&task=${taskId}`);
  const pre = page.locator("[data-task-attachments] pre"); await expect(pre).not.toHaveText("読込中…");
  expect((await pre.textContent())!.length).toBe(800);
  let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; });
  let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/attachments/${id}?inline=1&preview=1`, async (route) => { entered(); await held; await route.fulfill({ contentType: "text/plain", body: "delayed" }).catch(() => undefined); });
  try {
    await page.reload(); await started;
    const aborted = page.waitForEvent("requestfailed", { predicate: (request) => request.url().endsWith(`/${id}?inline=1&preview=1`) });
    await page.locator("[data-task-pane]").getByRole("link", { name: "詳細を閉じる", exact: true }).click();
    await aborted; await expect(page.locator("[data-task-pane]")).toHaveCount(0);
  } finally { release(); await page.unrouteAll({ behavior: "wait" }); }
});
