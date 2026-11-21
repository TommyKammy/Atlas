import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const run = randomUUID().slice(0, 8);
const admin = { email: "admin@example.com", password: "atlas-dev-2026" };
const limitedPassword = `Scim-Limited-${run}!A1`;
const selfPassword = `Scim-Self-${run}!A1`;
const disabledPassword = `Scim-Disabled-${run}!A1`;
const plainPassword = `Plain-Member-${run}!A1`;
const createdUserIds = new Set<number>();
const tokenIds = new Set<number>();

let api: APIRequestContext;
let originalScimEnabled = false;
let syncToken = "";
let syncTokenId = 0;
let refreshToken = "";
let scimUserId = 0;
let uiTokenId = 0;

async function login(context: APIRequestContext, email: string, password: string) {
  const response = await context.post("/api/auth/login", { data: { email, password } });
  expect(response.status(), `login ${email}`).toBe(200);
}

async function loginPage(page: Page, email = admin.email, password = admin.password) {
  const response = await page.request.post("/api/auth/login", { data: { email, password } });
  expect(response.status(), `login ${email}`).toBe(200);
}

function scimHeaders(token = syncToken) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/scim+json",
  };
}

async function openScimSection(page: Page) {
  await page.goto("/admin#security");
  await page.locator('[data-admin-tab="security"]').click();
  await page.locator('[data-security-tab="scim"]').click();
  const section = page.locator('[data-security-section="scim"]');
  await expect(section).toBeVisible();
  return section;
}

test.beforeAll(async ({ playwright, baseURL }) => {
  api = await playwright.request.newContext({ baseURL });
  await login(api, admin.email, admin.password);
  const security = await api.get("/api/admin/security");
  expect(security.status()).toBe(200);
  const body = await security.json() as { settings: { scim_enabled: boolean } };
  originalScimEnabled = body.settings.scim_enabled;
  expect((await api.patch("/api/admin/security", { data: { scim_enabled: false } })).status()).toBe(200);

  const issued = await api.post("/api/admin/scim/tokens", {
    data: { name: `R13 sync ${run}`, idp: "okta" },
  });
  expect(issued.status()).toBe(201);
  const tokenBody = await issued.json() as { id: number; token: string };
  syncToken = tokenBody.token;
  syncTokenId = tokenBody.id;
  tokenIds.add(syncTokenId);
  expect(syncToken.length).toBeGreaterThan(20);

  const refreshIssued = await api.post("/api/admin/scim/tokens", {
    data: { name: `R13 refresh ${run}`, idp: "entra" },
  });
  expect(refreshIssued.status()).toBe(201);
  const refreshBody = await refreshIssued.json() as { id: number; token: string };
  refreshToken = refreshBody.token;
  tokenIds.add(refreshBody.id);
});

test.afterAll(async () => {
  if (!api) return;
  try { await login(api, admin.email, admin.password); } catch { /* best effort */ }
  for (const id of createdUserIds) {
    await api.delete(`/api/admin/users/${id}`).catch(() => undefined);
  }
  for (const id of tokenIds) {
    await api.delete(`/api/admin/scim/tokens/${id}`).catch(() => undefined);
  }
  await api.patch("/api/admin/security", { data: { scim_enabled: originalScimEnabled } })
    .catch(() => undefined);
  await api.dispose();
});

test("super administrator enables SCIM, sees the tenant URL and issues a one-time token", async ({ page, baseURL }) => {
  await loginPage(page);
  const section = await openScimSection(page);

  await expect(section.locator("[data-scim-status]")).toHaveText("無効");
  await section.locator("[data-scim-toggle]").click();
  const confirm = page.locator("[data-confirm-message]");
  await expect(confirm).toContainText("SAML の自動作成（JIT）は停止");
  // Enabling SCIM stops JIT creation only; it must not promise to lock out
  // existing accounts that the IdP has not assigned.
  await expect(confirm).toContainText("既存のアカウントとセッションはそのまま残ります");
  await expect(confirm).not.toContainText("割り当てたユーザーだけ");
  await page.locator("[data-confirm-ok]").click();
  await expect(section.locator("[data-scim-status]")).toHaveText("有効");
  await expect(section.locator("[data-scim-toggle]")).toHaveText("SCIM を無効にする");

  const endpoint = section.locator("[data-scim-endpoint]");
  await expect(endpoint).toHaveValue(/\/scim\/v2$/);
  if ((baseURL ?? "").startsWith("http://")) {
    await expect(section.locator("[data-scim-https-warning]")).toBeVisible();
  }

  await section.locator("[data-scim-issue-open]").click();
  const name = `R13 UI ${run}`;
  await page.locator("[data-scim-token-name]").fill(name);
  await page.locator("[data-scim-token-idp]").selectOption("entra");
  await page.locator("[data-scim-token-issue]").click();

  const plaintext = page.locator("[data-scim-token-plaintext]");
  await expect(plaintext).toBeVisible();
  const token = await plaintext.inputValue();
  expect(token.startsWith("atlas_scim_")).toBe(true);
  await expect(page.locator("[data-scim-token-warning]")).toContainText("二度と表示できません");
  await expect(page.locator("[data-scim-token-copy]")).toBeVisible();

  await page.locator("[data-scim-token-close]").click();
  await expect(page.locator("[data-scim-token-plaintext]")).toHaveCount(0);
  expect(await page.evaluate((value) => document.body.innerText.includes(value), token)).toBe(false);

  // Reopening starts a new issuance form; the previous plaintext is gone.
  await section.locator("[data-scim-issue-open]").click();
  await expect(page.locator("[data-scim-token-plaintext]")).toHaveCount(0);
  await page.locator("[data-scim-token-close]").click();

  const row = section.locator("[data-scim-token-row]").filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await expect(row.locator("[data-scim-token-state-label]")).toHaveText("有効");
  uiTokenId = Number(await row.getAttribute("data-scim-token-id"));
  expect(uiTokenId).toBeGreaterThan(0);
  tokenIds.add(uiTokenId);

  await row.locator("[data-scim-token-revoke]").click();
  await expect(page.locator("[data-confirm-message]")).toContainText("失効");
  await page.locator("[data-confirm-ok]").click();
  await expect(row.locator("[data-scim-token-state-label]")).toHaveText("失効済み");
  await expect(row.locator("[data-scim-token-revoke]")).toHaveCount(0);
});

test("SCIM requests appear in recent sync logs and can be filtered to failures", async ({ page }) => {
  const email = `scim-admin-ui-${run}@example.test`;
  const created = await api.post("/scim/v2/Users", {
    headers: scimHeaders(),
    data: {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName: email,
      emails: [{ value: email, type: "work", primary: true }],
      name: { formatted: "SCIM UI User" },
      title: "Engineer",
      active: true,
    },
  });
  expect(created.status()).toBe(201);
  const createdBody = await created.json() as { id: string };
  scimUserId = Number(createdBody.id);
  createdUserIds.add(scimUserId);
  expect(scimUserId).toBeGreaterThan(0);

  const failureMarker = `scim-admin-bad-${run}`;
  const failed = await api.get(
    `/scim/v2/Users?filter=${encodeURIComponent(`displayName eq "${failureMarker}"`)}`,
    { headers: scimHeaders() },
  );
  expect(failed.status()).toBe(400);
  expect((await failed.json() as { scimType: string }).scimType).toBe("invalidFilter");

  await loginPage(page);
  const section = await openScimSection(page);
  const logs = section.locator("[data-scim-logs]");

  const successRow = logs.locator('[data-scim-log-row][data-scim-log-status="success"]')
    .filter({ hasText: "SCIM UI User" });
  await expect(successRow).toHaveCount(1);
  await expect(successRow.first()).toContainText("ユーザー作成");
  await expect(successRow.first()).toContainText("成功");

  const failureRow = logs.locator('[data-scim-log-row][data-scim-log-status="failure"]')
    .filter({ hasText: failureMarker });
  await expect(failureRow).toHaveCount(1);
  await expect(failureRow.first()).toContainText("ユーザー検索");
  await expect(failureRow.first()).toContainText("失敗");
  await expect(failureRow.first()).toContainText("unsupported filter");
  await expect(section.locator("[data-scim-load-more]")).toBeVisible();

  await section.locator("[data-scim-failures-only]").check();
  await expect(successRow).toHaveCount(0);
  await expect(failureRow).toHaveCount(1);
});

test("a 401 creates one log row and never stores the Authorization value", async () => {
  const before = await api.get("/api/admin/scim/logs?status=all");
  expect(before.status()).toBe(200);
  const beforeBody = await before.json() as { logs: { id: number }[] };
  const maxId = beforeBody.logs.reduce((max, row) => Math.max(max, row.id), 0);

  const missing = await api.get("/scim/v2/Users");
  expect(missing.status()).toBe(401);
  expect((await missing.json() as { detail: string }).detail).toBe("invalid or expired bearer token");

  const after = await api.get("/api/admin/scim/logs?status=all");
  expect(after.status()).toBe(200);
  const text = await after.text();
  expect(text).not.toContain("atlas_scim_");
  const afterBody = JSON.parse(text) as {
    logs: {
      id: number;
      method: string;
      path: string;
      status: number;
      token_id: number | null;
      idp: string | null;
      detail: string | null;
    }[];
  };
  const created = afterBody.logs.filter((row) => row.id > maxId);
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({
    method: "GET",
    path: "/scim/v2/Users",
    status: 401,
    token_id: null,
    idp: null,
    detail: "invalid or expired bearer token",
  });
});

test("log API pages 51+ rows and combines the failure filter with a cursor", async () => {
  for (let i = 0; i < 55; i += 1) {
    const response = await api.get("/scim/v2/Users?count=1", { headers: scimHeaders() });
    expect(response.status()).toBe(200);
  }

  const first = await api.get("/api/admin/scim/logs?status=all");
  expect(first.status()).toBe(200);
  const firstBody = await first.json() as {
    logs: { id: number }[];
    next_cursor: number | null;
  };
  expect(firstBody.logs).toHaveLength(50);
  expect(typeof firstBody.next_cursor).toBe("number");

  const second = await api.get(
    `/api/admin/scim/logs?status=all&cursor=${firstBody.next_cursor}`,
  );
  expect(second.status()).toBe(200);
  const secondBody = await second.json() as { logs: { id: number }[] };
  expect(secondBody.logs.length).toBeGreaterThan(0);
  const firstIds = new Set(firstBody.logs.map((row) => row.id));
  expect(secondBody.logs.some((row) => firstIds.has(row.id))).toBe(false);

  const failures = await api.get("/api/admin/scim/logs?status=failure");
  expect(failures.status()).toBe(200);
  const failureBody = await failures.json() as { logs: { id: number; status: number }[] };
  expect(failureBody.logs.length).toBeGreaterThan(1);
  const cursor = failureBody.logs[0].id;
  const older = await api.get(
    `/api/admin/scim/logs?status=failure&cursor=${cursor}`,
  );
  expect(older.status()).toBe(200);
  const olderBody = await older.json() as { logs: { id: number; status: number }[] };
  expect(olderBody.logs.length).toBeGreaterThan(0);
  expect(olderBody.logs.every((row) => row.status >= 400 && row.id < cursor)).toBe(true);
});

test("refresh reloads recent syncs and token last-used, keeping the failure filter", async ({ page }) => {
  const tokenName = `R13 refresh ${run}`;
  const marker = `scim-refresh-${run}@example.test`;
  const filter = `userName eq "${marker}"`;

  await loginPage(page);
  const section = await openScimSection(page);
  const tokenRow = section.locator("[data-scim-token-row]").filter({ hasText: tokenName });
  await expect(tokenRow).toHaveCount(1);
  await expect(tokenRow).toContainText("未使用");

  const newRow = section.locator('[data-scim-log-row][data-scim-log-status="success"]')
    .filter({ hasText: marker });
  await expect(newRow).toHaveCount(0);

  const request = await api.get(
    `/scim/v2/Users?filter=${encodeURIComponent(filter)}`,
    { headers: scimHeaders(refreshToken) },
  );
  expect(request.status()).toBe(200);

  await section.locator("[data-scim-refresh]").click();
  await expect(newRow).toHaveCount(1);
  await expect(newRow.first()).toContainText("ユーザー検索");
  await expect(tokenRow).not.toContainText("未使用");

  // Refreshing keeps the current failure-only filter.
  await section.locator("[data-scim-failures-only]").check();
  await expect(newRow).toHaveCount(0);
  await section.locator("[data-scim-refresh]").click();
  await expect(section.locator("[data-scim-failures-only]")).toBeChecked();
  await expect(newRow).toHaveCount(0);
});

test("SCIM-managed members are marked, profile fields are locked and deactivation stays available", async ({ page, browser, baseURL }) => {
  await loginPage(page);
  await page.goto("/admin");
  const row = page.locator(`[data-admin-user-id="${scimUserId}"]`);
  await expect(row).toBeVisible();
  const badge = row.locator("[data-scim-badge]");
  await expect(badge).toHaveText("SCIM");
  await expect(badge).toHaveAttribute("title", /Okta/);

  await row.getByRole("button", { name: /を編集/ }).click();
  const dialog = page.getByRole("dialog", { name: "ユーザー編集" });
  await expect(dialog.locator("[data-scim-managed-edit]")).toContainText("IdP で変更してください");
  await expect(dialog.getByLabel("名前")).not.toBeEditable();
  await expect(dialog.getByLabel("メール")).not.toBeEditable();
  await expect(dialog.getByLabel("役職")).not.toBeEditable();
  await expect(dialog.getByRole("combobox")).toBeEditable();
  await dialog.getByRole("button", { name: "キャンセル" }).click();

  const renamed = await api.patch(`/api/admin/users/${scimUserId}`, {
    data: { name: "Renamed by admin" },
  });
  expect(renamed.status()).toBe(409);
  expect((await renamed.json() as { error: string }).error).toContain("IdP");

  const passwordSet = await api.patch(`/api/admin/users/${scimUserId}`, {
    data: { password: selfPassword },
  });
  expect(passwordSet.status()).toBe(200);

  const selfContext = await browser.newContext({ baseURL });
  try {
    await login(selfContext.request, `scim-admin-ui-${run}@example.test`, selfPassword);
    const selfPage = await selfContext.newPage();
    const selfRename = await selfContext.request.patch("/api/me", { data: { name: "Self renamed" } });
    expect(selfRename.status()).toBe(409);
    expect((await selfRename.json() as { error: string }).error).toContain("IdP");
    await selfPage.goto("/profile");
    await expect(selfPage.locator("[data-scim-managed-profile]")).toBeVisible();
    await expect(selfPage.locator('[data-scim-profile-field="name"]')).not.toBeEditable();
    await expect(selfPage.locator('[data-scim-profile-field="email"]')).not.toBeEditable();
    await expect(selfPage.locator('[data-scim-profile-field="title"]')).not.toBeEditable();
  } finally {
    await selfContext.close();
  }

  await row.getByRole("button", { name: /を無効化/ }).click();
  await expect(page.getByText(/IdP からの次の同期で有効に戻ることがあります/)).toBeVisible();
  await expect(row.getByText("無効", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: /を有効化/ })).toBeDisabled();

  const reactivate = await api.patch(`/api/admin/users/${scimUserId}`, {
    data: { deactivated: false },
  });
  expect(reactivate.status()).toBe(409);
  expect((await reactivate.json() as { error: string }).error).toContain("有効化");

  await row.getByRole("combobox").selectOption("guest");
  await expect.poll(async () => {
    const response = await api.get("/api/admin/users");
    const body = await response.json() as { users: { id: number; role_key: string }[] };
    return body.users.find((user) => user.id === scimUserId)?.role_key ?? null;
  }).toBe("guest");
});

test("SCIM disable releases protection and DELETE keeps reactivation blocked", async ({ page, playwright, baseURL }) => {
  const email = `scim-deleted-${run}@example.test`;
  const created = await api.post("/scim/v2/Users", {
    headers: scimHeaders(),
    data: {
      userName: email,
      emails: [{ value: email, type: "work", primary: true }],
      name: { formatted: "SCIM Delete User" },
      active: true,
    },
  });
  expect(created.status()).toBe(201);
  const id = Number((await created.json() as { id: string }).id);
  createdUserIds.add(id);

  const blockedName = await api.patch(`/api/admin/users/${id}`, {
    data: { name: "Blocked while SCIM is on" },
  });
  expect(blockedName.status()).toBe(409);

  let scimDisabled = false;
  try {
    expect((await api.patch("/api/admin/security", { data: { scim_enabled: false } })).status()).toBe(200);
    scimDisabled = true;

    const disabledResponse = await api.get("/scim/v2/Users", { headers: scimHeaders() });
    expect(disabledResponse.status()).toBe(401);
    expect((await disabledResponse.json() as { detail: string }).detail).toBe("invalid or expired bearer token");
    const disabledLogs = await api.get("/api/admin/scim/logs?status=failure");
    expect(disabledLogs.status()).toBe(200);
    const disabledBody = await disabledLogs.json() as {
      logs: { token_id: number | null; idp: string | null; detail: string | null }[];
    };
    const disabledRow = disabledBody.logs.find((log) =>
      log.token_id === syncTokenId && log.detail === "SCIM provisioning is disabled");
    expect(disabledRow).toBeTruthy();
    expect(disabledRow?.idp).toBe("okta");

    expect((await api.patch(`/api/admin/users/${id}`, {
      data: { password: disabledPassword },
    })).status()).toBe(200);
    const selfContext = await playwright.request.newContext({ baseURL });
    try {
      await login(selfContext, email, disabledPassword);
      const selfEdit = await selfContext.patch("/api/me", {
        data: { name: `Self edit ${run}`, email, title: "Self title" },
      });
      expect(selfEdit.status()).toBe(200);
    } finally {
      await selfContext.dispose();
    }

    await loginPage(page);
    await page.goto("/admin");
    const row = page.locator(`[data-admin-user-id="${id}"]`);
    await expect(row.locator('[data-scim-badge="disabled"]')).toHaveText("SCIM（停止中）");

    await row.getByRole("button", { name: /を編集/ }).click();
    const dialog = page.getByRole("dialog", { name: "ユーザー編集" });
    await expect(dialog.getByLabel("名前")).toBeEditable();
    await dialog.getByLabel("名前").fill(`Admin edit ${run}`);
    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("ユーザーを更新しました", { exact: true })).toBeVisible();
    await expect.poll(async () => {
      const response = await api.get("/api/admin/users");
      const body = await response.json() as { users: { id: number; name: string }[] };
      return body.users.find((user) => user.id === id)?.name ?? null;
    }).toBe(`Admin edit ${run}`);

    await expect(row.getByRole("button", { name: /を無効化/ })).toBeEnabled();
    await row.getByRole("button", { name: /を無効化/ }).click();
    await expect(row.getByRole("button", { name: /を有効化/ })).toBeEnabled();
    await row.getByRole("button", { name: /を有効化/ }).click();
    await expect(row.getByRole("button", { name: /を無効化/ })).toBeEnabled();
  } finally {
    if (scimDisabled) {
      await api.patch("/api/admin/security", { data: { scim_enabled: true } })
        .catch(() => undefined);
    }
  }

  expect((await api.delete(`/scim/v2/Users/${id}`, { headers: scimHeaders() })).status()).toBe(204);
  const reactivate = await api.patch(`/api/admin/users/${id}`, { data: { deactivated: false } });
  expect(reactivate.status()).toBe(409);
  expect((await reactivate.json() as { error: string }).error).toContain("IdP で割り当て直");

  await page.goto("/admin");
  const row = page.locator(`[data-admin-user-id="${id}"]`);
  await expect(row.locator('[data-scim-badge="deleted"]')).toHaveText("SCIM（IdP で削除済み）");
  await expect(row.getByRole("button", { name: /を有効化/ })).toBeDisabled();
});

test("non-SCIM users keep normal admin and profile edits", async ({ playwright, baseURL }) => {
  const email = `plain-member-${run}@example.test`;
  const renamedEmail = `plain-member-renamed-${run}@example.test`;
  const created = await api.post("/api/admin/users", {
    data: { name: "Plain Member", email, password: plainPassword, role: "member" },
  });
  expect(created.status()).toBe(201);
  const id = (await created.json() as { id: number }).id;
  createdUserIds.add(id);

  const adminEdit = await api.patch(`/api/admin/users/${id}`, {
    data: { name: "Plain Admin Edit", email: renamedEmail, title: "Manager" },
  });
  expect(adminEdit.status()).toBe(200);

  const context = await playwright.request.newContext({ baseURL });
  try {
    await login(context, renamedEmail, plainPassword);
    const selfEdit = await context.patch("/api/me", {
      data: { name: "Plain Self Edit", email: renamedEmail, title: "Director" },
    });
    expect(selfEdit.status()).toBe(200);
    expect(await selfEdit.json()).toMatchObject({
      name: "Plain Self Edit",
      email: renamedEmail,
      title: "Director",
    });
  } finally {
    await context.dispose();
  }
});

test("a non-super administrator sees a read-only SCIM section and gets 403 from the API", async ({ browser, baseURL }) => {
  const email = `scim-limited-admin-${run}@example.test`;
  const created = await api.post("/api/admin/users", {
    data: { name: "SCIM limited admin", email, password: limitedPassword, role: "admin" },
  });
  expect(created.status()).toBe(201);
  const limitedId = (await created.json() as { id: number }).id;
  createdUserIds.add(limitedId);

  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    await loginPage(page, email, limitedPassword);
    const section = await openScimSection(page);
    await expect(section.locator("[data-scim-readonly]")).toContainText("super 管理者だけが変更できます");
    await expect(section.locator("[data-scim-toggle]")).toHaveCount(0);
    await expect(section.locator("[data-scim-issue-open]")).toHaveCount(0);
    await expect(section.locator("[data-scim-logs]")).toHaveCount(0);

    expect((await context.request.get("/api/admin/scim/tokens")).status()).toBe(403);
    expect((await context.request.get("/api/admin/scim/logs")).status()).toBe(403);
    expect((await context.request.patch("/api/admin/security", {
      data: { scim_enabled: false },
    })).status()).toBe(403);
  } finally {
    await context.close();
  }
});

test("the SCIM section fits a 375px viewport without horizontal scrolling", async ({ page }) => {
  await loginPage(page);
  await page.setViewportSize({ width: 375, height: 800 });
  const section = await openScimSection(page);
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport);
  const sectionWidth = await section.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(sectionWidth.scrollWidth).toBeLessThanOrEqual(sectionWidth.clientWidth + 1);
});
