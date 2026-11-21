import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "atlas-dev-2026";

async function login(page: Page): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(response.status()).toBe(200);
}

const css = (locator: Locator) =>
  locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      color: style.color,
      borderTopWidth: style.borderTopWidth,
      borderTopColor: style.borderTopColor,
      borderBottomWidth: style.borderBottomWidth,
      borderBottomColor: style.borderBottomColor,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      height: element.getBoundingClientRect().height,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      appearance: style.appearance,
    };
  });

test("admin, profile, login and invite follow the C workbench treatment", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Admin uses the shared page skeleton: 15px bold screen name and a 13px
  // muted description, with the same 32px side padding as inbox and audit.
  await page.goto("/admin");
  const pageTitle = page.getByRole("heading", { name: "管理", exact: true });
  expect(await css(pageTitle)).toMatchObject({ fontSize: "15px", fontWeight: "700", color: "rgb(26, 29, 33)" });
  const pageDescription = page.getByText(/のメンバー、チーム、セキュリティを管理します。$/);
  expect(await css(pageDescription)).toMatchObject({ fontSize: "13px", color: "rgb(92, 100, 112)" });

  // The section nav is not a card. The selected item uses the sidebar's
  // current-page surface and strong text, with a 13px label and 12px muted
  // description; the audit actions are quiet 32px buttons outside a box.
  const membersTab = page.locator('[data-admin-tab="members"]');
  await expect(membersTab).toHaveAttribute("aria-current", "page");
  expect(await css(membersTab)).toMatchObject({
    background: "rgb(239, 240, 242)",
    color: "rgb(26, 29, 33)",
    boxShadow: "none",
    fontSize: "13px",
    fontWeight: "500",
  });
  expect(await css(membersTab.locator("span").nth(1))).toMatchObject({
    fontSize: "12px",
    fontWeight: "400",
    color: "rgb(92, 100, 112)",
  });
  expect(await css(page.locator('[data-admin-tab="teams"]'))).toMatchObject({
    background: "rgba(0, 0, 0, 0)",
    color: "rgb(58, 64, 73)",
    boxShadow: "none",
  });
  const auditLink = page.getByRole("link", { name: /監査ログを開く/ });
  expect(await css(auditLink)).toMatchObject({ height: 32, fontSize: "12px" });
  expect(await auditLink.evaluate((element) => {
    const aside = element.closest("aside")!;
    const wrapper = element.parentElement!;
    return {
      wrapperBorder: getComputedStyle(wrapper).borderTopWidth,
      wrapperBackground: getComputedStyle(wrapper).backgroundColor,
      asideBorder: getComputedStyle(aside).borderTopWidth,
      asideBackground: getComputedStyle(aside).backgroundColor,
    };
  })).toEqual({ wrapperBorder: "0px", wrapperBackground: "rgba(0, 0, 0, 0)", asideBorder: "0px", asideBackground: "rgba(0, 0, 0, 0)" });

  // Member table: audit-log rhythm, a 32px native role select with the quiet
  // chevron, and a borderless 28px danger delete action.
  const table = page.locator("[data-admin-users-table]");
  const header = table.locator(":scope > div > div").first();
  expect(await css(header)).toMatchObject({
    fontSize: "12px",
    fontWeight: "500",
    color: "rgb(92, 100, 112)",
    borderBottomColor: "rgb(228, 230, 234)",
  });
  const member = page.getByText("tanaka@example.com", { exact: true }).locator("..");
  expect(await css(member)).toMatchObject({ borderBottomColor: "rgb(239, 240, 242)" });
  const roleSelect = member.getByRole("combobox");
  expect(await css(roleSelect)).toMatchObject({
    height: 32,
    fontSize: "13px",
    appearance: "none",
    borderTopColor: "rgb(140, 149, 165)",
  });
  const roleChevron = roleSelect.locator("xpath=..").locator('svg[aria-hidden="true"]');
  expect(await css(roleChevron)).toMatchObject({ color: "rgb(92, 100, 112)" });
  expect(await roleChevron.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");
  const deleteButton = member.getByRole("button", { name: "田中 太郎 を削除", exact: true });
  expect(await css(deleteButton)).toMatchObject({
    height: 28,
    fontSize: "12px",
    color: "rgb(184, 50, 40)",
    borderTopWidth: "0px",
  });
  for (const name of ["田中 太郎 を編集", "田中 太郎 のパスワードを再設定", "田中 太郎 を無効化"]) {
    expect(await css(member.getByRole("button", { name, exact: true }))).toMatchObject({ height: 28, fontSize: "12px" });
  }

  // Security sub-tabs are borderless 32px tabs with the faint selected
  // surface. Role badges are 20px pills and 変更不可 stays 12px muted.
  await page.locator('[data-admin-tab="security"]').click();
  const rbacTab = page.locator('[data-security-tab="rbac"]');
  await expect(rbacTab).toHaveAttribute("aria-current", "page");
  expect(await css(rbacTab)).toMatchObject({
    background: "rgb(239, 240, 242)",
    color: "rgb(63, 107, 0)",
    borderBottomWidth: "0px",
    height: 32,
    fontSize: "13px",
    fontWeight: "500",
  });
  expect(await css(page.locator('[data-security-tab="saml"]'))).toMatchObject({
    background: "rgba(0, 0, 0, 0)",
    color: "rgb(58, 64, 73)",
    borderBottomWidth: "0px",
  });
  const superRole = page.locator('[data-role="super_admin"]');
  const privileged = superRole.getByText("特権", { exact: true });
  expect(await css(privileged)).toMatchObject({
    height: 20,
    fontSize: "11px",
    background: "rgb(250, 242, 223)",
    color: "rgb(138, 93, 0)",
  });
  const standard = page.locator('[data-role="admin"]').getByText("標準", { exact: true }).first();
  expect(await css(standard)).toMatchObject({ height: 20, fontSize: "11px", background: "rgb(239, 240, 242)", color: "rgb(58, 64, 73)" });
  expect(await css(superRole.getByText("変更不可", { exact: true }))).toMatchObject({
    fontSize: "12px",
    color: "rgb(92, 100, 112)",
  });

  // Profile: one skeleton, 16px section headings and visible labels on the
  // three password fields (the placeholders stay).
  await page.goto("/profile");
  expect(await css(page.getByRole("heading", { name: "プロフィール", exact: true, level: 1 }))).toMatchObject({
    fontSize: "15px",
    fontWeight: "700",
  });
  const passwordSection = page.locator("section").filter({ has: page.getByRole("heading", { name: "パスワード変更", exact: true }) });
  expect(await css(passwordSection.getByRole("heading", { name: "パスワード変更", exact: true }))).toMatchObject({
    fontSize: "16px",
    fontWeight: "600",
  });
  for (const label of ["現在のパスワード", "新しいパスワード（8文字以上）", "新しいパスワード（確認）"]) {
    const input = passwordSection.getByLabel(label, { exact: true });
    await expect(input).toBeVisible();
    expect(await css(input)).toMatchObject({ height: 32, fontSize: "13px" });
    expect(await css(passwordSection.getByText(label, { exact: true }))).toMatchObject({
      fontSize: "12px",
      fontWeight: "500",
      color: "rgb(58, 64, 73)",
    });
    expect(await input.getAttribute("placeholder")).toBe(label);
  }
  expect(await css(page.locator("[data-two-factor-status]"))).toMatchObject({
    height: 20,
    fontSize: "11px",
    background: "rgb(239, 240, 242)",
    color: "rgb(58, 64, 73)",
  });

  // Logged-out login: a flat 320px card with no shadow, 16px heading and
  // 12px labels; the development note keeps its exact text.
  const anonymous = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const loginPage = await anonymous.newPage();
    await loginPage.setViewportSize({ width: 1440, height: 1000 });
    await loginPage.goto("/login");
    const form = loginPage.locator("[data-login-form]");
    expect(await css(form)).toMatchObject({
      background: "rgb(255, 255, 255)",
      borderTopColor: "rgb(228, 230, 234)",
      borderRadius: "8px",
      boxShadow: "none",
    });
    expect((await form.boundingBox())!.width).toBe(320);
    expect(await css(form.getByRole("heading", { name: "Atlas にログイン", exact: true }))).toMatchObject({
      fontSize: "16px",
      fontWeight: "600",
    });
    const emailLabel = form.getByText("メールアドレス", { exact: true }).first();
    expect(await css(emailLabel)).toMatchObject({ fontSize: "12px", fontWeight: "500", color: "rgb(58, 64, 73)" });
    await expect(form.getByPlaceholder("メールアドレス", { exact: true })).toHaveValue("");
    // Default development credentials must never be shown on the login page.
    await expect(form.getByText(/開発用初期値|atlas-dev-2026/)).toHaveCount(0);

    // The rate-limit error keeps its role and data hook and uses danger text
    // on the faint danger surface.
    await loginPage.route("**/api/auth/login", (route) => route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: { "Retry-After": "30" },
      body: JSON.stringify({ error: "too_many_attempts", retry_after_seconds: 30 }),
    }));
    await form.getByPlaceholder("メールアドレス", { exact: true }).fill("visual-rate@example.test");
    await form.getByPlaceholder("パスワード", { exact: true }).fill("Retained-Visual-Fixture-2026!");
    await form.getByRole("button", { name: "ログイン", exact: true }).click();
    const feedback = form.locator("[data-auth-feedback]");
    await expect(feedback).toHaveAttribute("role", "alert");
    expect(await css(feedback)).toMatchObject({ background: "rgb(251, 233, 230)", color: "rgb(184, 50, 40)" });

    // The invite acceptance card shares the same flat card.
    const created = await page.request.post("/api/admin/invitations", {
      data: { email: `r36-invite-${randomUUID()}@example.test`, role: "member" },
    });
    expect(created.status()).toBe(201);
    const invitation = (await created.json() as { invitation: { id: number; url: string } }).invitation;
    try {
      const url = new URL(invitation.url);
      await loginPage.goto(url.pathname);
      const inviteCard = loginPage.getByRole("heading", { name: /への招待$/ }).locator("..");
      expect(await css(inviteCard)).toMatchObject({
        background: "rgb(255, 255, 255)",
        borderTopColor: "rgb(228, 230, 234)",
        borderRadius: "8px",
        boxShadow: "none",
      });
      expect(await css(loginPage.getByRole("heading", { name: /への招待$/ }))).toMatchObject({
        fontSize: "16px",
        fontWeight: "600",
      });
      for (const label of ["表示名", "パスワード（8文字以上）", "パスワード（確認）"]) {
        await expect(loginPage.getByLabel(label, { exact: true })).toBeVisible();
      }
      // Both auth cards fit the 375px viewport without widening the page.
      await loginPage.setViewportSize({ width: 375, height: 800 });
      await loginPage.goto("/login");
      const narrowLoginCard = (await loginPage.locator("[data-login-form]").boundingBox())!;
      expect(narrowLoginCard.x).toBeGreaterThanOrEqual(0);
      expect(narrowLoginCard.x + narrowLoginCard.width).toBeLessThanOrEqual(375);
      expect(await loginPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
      await loginPage.goto(url.pathname);
      const narrowInviteCard = (await loginPage.getByRole("heading", { name: /への招待$/ }).locator("..").boundingBox())!;
      expect(narrowInviteCard.x).toBeGreaterThanOrEqual(0);
      expect(narrowInviteCard.x + narrowInviteCard.width).toBeLessThanOrEqual(375);
      expect(await loginPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    } finally {
      expect((await page.request.delete(`/api/admin/invitations/${invitation.id}`)).status()).toBe(200);
    }
  } finally {
    await anonymous.close();
  }

  // 375px: the admin nav sits above the content and wraps instead of widening
  // the page; the login and invite cards stay inside the viewport.
  await page.setViewportSize({ width: 375, height: 800 });
  for (const route of ["/admin", "/admin#security", "/profile"]) {
    await page.goto(route);
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(overflow.document, route).toBeLessThanOrEqual(overflow.viewport);
  }
  await page.goto("/admin");
  const narrowNav = await page.locator("[data-admin-console] aside nav").boundingBox();
  expect(narrowNav!.x).toBeGreaterThanOrEqual(0);
  expect(narrowNav!.x + narrowNav!.width).toBeLessThanOrEqual(375);

  // Dark: the same token pairs (raised surface / strong text, lime accent
  // text, light danger text) and the flat cards.
  await page.context().addCookies([{ name: "atlas_theme", value: "dark", url: new URL(page.url()).origin }]);
  await page.goto("/admin");
  expect(await css(page.locator('[data-admin-tab="members"]'))).toMatchObject({
    background: "rgb(29, 34, 41)",
    color: "rgb(232, 234, 237)",
  });
  await page.locator('[data-admin-tab="security"]').click();
  expect(await css(page.locator('[data-security-tab="rbac"]'))).toMatchObject({
    background: "rgb(29, 34, 41)",
    color: "rgb(185, 242, 39)",
    borderBottomWidth: "0px",
  });
  await page.locator('[data-admin-tab="members"]').click();
  const darkDelete = page.getByText("tanaka@example.com", { exact: true }).locator("..").getByRole("button", { name: "田中 太郎 を削除", exact: true });
  expect(await css(darkDelete)).toMatchObject({ color: "rgb(255, 156, 143)", borderTopWidth: "0px" });
  expect(await css(page.getByText("tanaka@example.com", { exact: true }).locator("..").getByRole("combobox"))).toMatchObject({
    background: "rgb(20, 24, 29)",
    borderTopColor: "rgb(88, 101, 119)",
  });

  const darkAnonymous = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    await darkAnonymous.addCookies([{ name: "atlas_theme", value: "dark", url: new URL(page.url()).origin }]);
    const darkLogin = await darkAnonymous.newPage();
    await darkLogin.goto("/login");
    expect(await css(darkLogin.locator("[data-login-form]"))).toMatchObject({
      background: "rgb(20, 24, 29)",
      borderTopColor: "rgb(37, 43, 51)",
      boxShadow: "none",
    });
  } finally {
    await darkAnonymous.close();
  }
});
