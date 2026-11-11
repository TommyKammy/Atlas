import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const fixtures = new WeakMap<Page, { context: BrowserContext; userId: number }>();

test.afterEach(async ({ page }, info) => {
  info.setTimeout(15_000);
  const f = fixtures.get(page);
  if (!f) return;
  await f.context.close();
  const removed = await page.request.delete(`/api/admin/users/${f.userId}`);
  if (info.status === info.expectedStatus) expect(removed.status()).toBe(200);
});

for (const status of [429, 503]) {
  test(`authentication ${status} preserves login input and explains the failure without a false password error`, async ({ page }) => {
    await page.goto("/login");
    const email = page.getByPlaceholder("メールアドレス", { exact: true });
    const password = page.getByPlaceholder("パスワード", { exact: true });
    await email.fill("rate-ui@example.test");
    await password.fill("Retained-Rate-Fixture-2026!");
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let requests = 0;
    await page.route("**/api/auth/login", async (route) => {
      requests++;
      enter();
      await gate;
      await route.fulfill({ status, contentType: "application/json", headers: { "Retry-After": "30", "Cache-Control": "no-store" },
        body: JSON.stringify(status === 429 ? { error: "too_many_attempts", retry_after_seconds: 30 } : { error: "auth_temporarily_unavailable" }) });
    });
    try {
      await page.getByRole("button", { name: "ログイン", exact: true }).click();
      await entered;
      await expect(page.locator("[data-login-form]")).toHaveAttribute("aria-busy", "true");
      await expect(page.getByRole("button", { name: "ログイン", exact: true })).toBeDisabled();
      // Even a second submit event must not start another in-flight request.
      await page.locator("[data-login-form]").dispatchEvent("submit");
      expect(requests).toBe(1);
      release();
      const feedback = page.locator("[data-auth-feedback]");
      await expect(feedback).toBeVisible();
      await expect(feedback).toContainText(status === 429 ? "30秒後" : "一時的に利用できません");
      await expect(feedback).not.toContainText("メールアドレスまたはパスワードが違います");
      await expect(email).toHaveValue("rate-ui@example.test");
      await expect(password).toHaveValue("Retained-Rate-Fixture-2026!");
      await expect(page.locator("[data-login-form]")).toHaveAttribute("aria-busy", "false");
      await expect(page.getByRole("button", { name: "ログイン", exact: true })).toBeEnabled();
      expect(new URL(page.url()).pathname).toBe("/login");
    } finally { release(); await page.unrouteAll({ behavior: "wait" }); }
  });
}

test("authentication throttling retains both the TOTP and recovery-code step", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("メールアドレス", { exact: true }).fill("mfa-rate-ui@example.test");
  await page.getByPlaceholder("パスワード", { exact: true }).fill("Retained-Rate-Fixture-2026!");
  let calls = 0;
  await page.route("**/api/auth/login", async (route) => {
    calls++;
    await route.fulfill({ status: calls === 1 ? 401 : 429, contentType: "application/json",
      headers: { "Retry-After": "20" }, body: JSON.stringify(calls === 1
        ? { error: "two-factor code required", two_factor_required: true }
        : { error: "too_many_attempts", retry_after_seconds: 20 }) });
  });
  try {
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    const totp = page.locator("[data-login-totp]");
    await expect(totp).toBeVisible();
    await totp.fill("123456");
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await expect(page.locator("[data-auth-feedback]")).toContainText("20秒後");
    await expect(totp).toHaveValue("123456");
    await page.getByRole("button", { name: "リカバリーコードを使う", exact: true }).click();
    const recovery = page.locator("[data-login-recovery]");
    await recovery.fill("ABCDE-12345");
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await expect(page.locator("[data-auth-feedback]")).toContainText("20秒後");
    await expect(recovery).toHaveValue("ABCDE-12345");
    await expect(page.getByPlaceholder("メールアドレス", { exact: true })).toHaveValue("mfa-rate-ui@example.test");
    await expect(page.getByPlaceholder("パスワード", { exact: true })).toHaveValue("Retained-Rate-Fixture-2026!");
    expect(calls).toBe(3);
  } finally { await page.unrouteAll({ behavior: "wait" }); }
});

test("MFA enrollment keeps its confirmation input and setup visible after 429", async ({ page, browser }) => {
  const admin = { email: process.env.E2E_EMAIL ?? "admin@example.com", password: process.env.E2E_PASSWORD ?? "atlas-dev-2026" };
  expect((await page.request.post("/api/auth/login", { data: admin })).status()).toBe(200);
  const email = `mfa-rate-${randomUUID()}@example.test`;
  const password = "Rate-Browser-Fixture-2026!";
  const created = await page.request.post("/api/admin/users", { data: { name: "MFA rate feedback", email, password, role: "member" } });
  expect(created.status()).toBe(201);
  const { id: userId } = await created.json() as { id: number };
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  fixtures.set(page, { context, userId });
  expect((await context.request.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
  const profile = await context.newPage();
  await profile.goto("/profile#two-factor");
  const section = profile.locator("[data-two-factor-section]");
  await section.locator("[data-two-factor-begin]").click();
  await expect(section.locator("[data-two-factor-setup]")).toBeVisible();
  const input = section.locator("[data-two-factor-code]");
  await input.fill("123456");
  await profile.route("**/api/me/2fa", async (route) => {
    if (route.request().method() === "POST" && route.request().postDataJSON().action === "enable") {
      await route.fulfill({ status: 429, contentType: "application/json", headers: { "Retry-After": "15" },
        body: JSON.stringify({ error: "too_many_attempts", retry_after_seconds: 15 }) });
    } else await route.continue();
  });
  try {
    await section.locator("[data-two-factor-enable]").click();
    await expect(section.locator("[data-auth-feedback]")).toContainText("15秒後");
    await expect(input).toHaveValue("123456");
    await expect(section.locator("[data-two-factor-setup]")).toBeVisible();
    await expect(section.locator("[data-two-factor-status]")).toHaveText("未設定");
    await expect(section.locator("[data-two-factor-enable]")).toBeEnabled();
  } finally { await profile.unrouteAll({ behavior: "wait" }); }
});
