import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import { totpCode } from "../../lib/totp";

const run = randomUUID().slice(0, 8);
const password = "Atlas-Test-" + run + "!";
const seedAdmin = { email: "admin@example.com", password: "atlas-dev-2026" };
const accounts = {
  guest: { email: `guest-${run}@example.test`, role: "guest", id: 0 },
  member: { email: `member-${run}@example.test`, role: "member", id: 0 },
  admin: { email: `admin-${run}@example.test`, role: "admin", id: 0 },
  super: { email: `super-${run}@example.test`, role: "super_admin", id: 0 },
};
const sharedName = "Shared-" + run;
const secretName = "Private-" + run;
const deletedName = "Deleted-project-" + run;
const archivedName = "Archived-project-" + run;
const projectIds: number[] = [];
let shared: number, secret: number, sharedTask: number, secretTask: number;

async function status(response: APIResponse, expected: number) {
  expect(response.status(), `${response.url()} → ${response.status()}`).toBe(expected);
}
async function login(api: APIRequestContext, email: string, pw = password) {
  await status(await api.post("/api/auth/login", { data: { email, password: pw } }), 200);
}
async function project(api: APIRequestContext, name: string) {
  const response = await api.post("/api/projects", { data: { workspace_id: 1, name } });
  await status(response, 201);
  const { id } = await response.json();
  projectIds.push(id);
  return id as number;
}
async function addMember(api: APIRequestContext, projectId: number, id: number, role: string) {
  await status(await api.post(`/api/projects/${projectId}/members`, { data: { user_id: id, role } }), 201);
}
async function deletedTask(api: APIRequestContext, project_id: number, name: string) {
  const response = await api.post("/api/tasks", { data: { project_id, name } });
  await status(response, 201);
  const { id } = await response.json();
  await status(await api.delete(`/api/tasks/${id}`), 200);
  return id as number;
}

test.beforeAll(async ({ request, playwright, baseURL }) => {
  await login(request, seedAdmin.email, seedAdmin.password);
  for (const user of Object.values(accounts)) {
    const response = await request.post("/api/admin/users", {
      data: { role: user.role, name: user.role + "-" + run, email: user.email, password },
    });
    await status(response, 201);
    user.id = (await response.json()).id;
  }
  const protectedUser = await playwright.request.newContext({ baseURL });
  try {
    await login(protectedUser, accounts.super.email);
    const begin = await protectedUser.post("/api/me/2fa", { data: { action: "begin" } });
    await status(begin, 200);
    const { secret } = await begin.json();
    await status(await protectedUser.post("/api/me/2fa", { data: { action: "enable", code: totpCode(secret) } }), 200);
  } finally {
    await protectedUser.dispose();
  }
  shared = await project(request, sharedName);
  secret = await project(request, secretName);
  sharedTask = await deletedTask(request, shared, sharedName + "-task");
  secretTask = await deletedTask(request, secret, secretName + "-task");
  await addMember(request, shared, accounts.guest.id, "viewer");
  await addMember(request, shared, accounts.member.id, "editor");
  const archived = await project(request, archivedName);
  const deleted = await project(request, deletedName);
  await addMember(request, archived, accounts.member.id, "editor");
  await addMember(request, deleted, accounts.member.id, "editor");
  await status(await request.patch(`/api/projects/${archived}`, { data: { archived: true } }), 200);
  await status(await request.post(`/api/projects/${deleted}/trash`), 200);
});

test.afterAll(async ({ request }) => {
  await login(request, seedAdmin.email, seedAdmin.password);
  for (const id of projectIds) await status(await request.delete(`/api/projects/${id}/trash`), 200);
  for (const { id } of Object.values(accounts)) {
    if (id) await status(await request.delete(`/api/admin/users/${id}`), 200);
  }
});

for (const forged of [false, true]) {
  test(forged ? "forged session cookie" : "signed out", async ({ page, baseURL }) => {
    if (forged) await page.context().addCookies([{ name: "atlas_session", value: "x".repeat(43), url: baseURL! }]);
    for (const path of ["/audit", "/trash", "/portfolio", "/projects/new", "/admin"]) {
      const raw = await page.request.get(path, { maxRedirects: 0 });
      await status(raw, 307);
      expect(new URL(raw.headers().location, baseURL).pathname).toBe("/login");
      expect(await raw.text()).not.toContain(secretName);
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    }
    for (const path of ["/api/users", "/api/projects", "/api/portfolio", "/api/admin/audit/export", "/api/admin/users"]) {
      const res = await page.request.get(path);
      expect([401, 403]).toContain(res.status());
      expect(await res.text()).not.toContain(secretName);
    }
    for (const res of [
      await page.request.post("/api/projects", { data: { workspace_id: 1, name: "denied" } }),
      await page.request.post("/api/portfolio", { data: { project_id: secret } }),
      await page.request.post(`/api/tasks/${secretTask}/restore`),
      await page.request.patch(`/api/admin/users/${accounts.super.id}`, { data: { password } }),
    ]) expect([401, 403]).toContain(res.status());
  });
}

for (const role of ["guest", "member", "admin"] as const) {
  test(`${role} page and API access`, async ({ page }) => {
    const user = accounts[role];
    const admin = role === "admin";
    await login(page.request, user.email);
    const auditHtml = await page.request.get("/audit", { maxRedirects: 0 });
    expect((await auditHtml.text()).includes(secretName)).toBe(admin);
    await page.goto("/audit");
    if (admin) await expect(page.locator("main")).toContainText(secretName);
    else await expect(page).toHaveURL(/\/$/);
    const audit = await page.request.get("/api/admin/audit/export?format=json");
    await status(audit, admin ? 200 : 403);
    expect((await audit.text()).includes(secretName)).toBe(admin);

    const trash = await page.goto("/trash");
    await expect(page.locator("main")).toContainText(sharedName + "-task");
    const html = await trash!.text();
    expect(html.includes(secretName)).toBe(admin);
    expect(html.includes(archivedName)).toBe(role !== "guest");
    expect(html.includes(deletedName)).toBe(role !== "guest");
    const row = page.getByText(sharedName + "-task", { exact: true }).locator("..");
    await expect(row.getByRole("button", { name: "復元" })).toBeEnabled({ enabled: role !== "guest" });
    if (role === "guest") await status(await page.request.post(`/api/tasks/${sharedTask}/restore`), 403);
    else {
      await row.getByRole("button", { name: "復元" }).click();
      await expect(row).toHaveCount(0);
      await status(await page.request.delete(`/api/tasks/${sharedTask}`), 200);
    }
    if (!admin) await status(await page.request.post(`/api/tasks/${secretTask}/restore`), 403);

    const directory = await page.request.get("/api/users");
    await status(directory, 200);
    const emails = (await directory.json()).users.map((u: { email: string }) => u.email);
    expect(emails).toContain(user.email);
    expect(emails).toContain(accounts.member.email);
    expect(emails.includes(accounts.super.email)).toBe(role !== "guest");
    if (role === "guest") {
      const home = await page.goto("/");
      expect(await home!.text()).not.toContain("super_admin-" + run);
    }

    const portfolio = await page.request.post("/api/portfolio", { data: { project_id: secret } });
    await status(portfolio, admin ? 200 : 404);
    await status(await page.request.post("/api/portfolio", { data: { project_id: shared } }), 200);
    const saved = await page.request.get("/api/portfolio");
    expect((await saved.text()).includes(secretName)).toBe(admin);
    await page.goto("/portfolio");
    await expect(page.locator("main")).toContainText(sharedName);
    if (!admin) await expect(page.locator("main")).not.toContainText(secretName);

    await page.goto("/projects/new");
    if (role === "guest") {
      await expect(page).toHaveURL(/\/$/);
      await expect(page.locator('a[href="/projects/new"]')).toHaveCount(0);
      await status(await page.request.post("/api/projects", { data: { workspace_id: 1, name: "denied" } }), 403);
      await status(await page.request.post("/api/project-templates/1", { data: { name: "denied" } }), 403);
    } else {
      await expect(page.locator("[data-project-create-screen]")).toBeVisible();
      await page.locator("[data-project-create-nav=blank]").click();
      await page.locator("[data-project-create-name]").fill(role + "-created-" + run);
      const created = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/projects" && r.request().method() === "POST");
      await page.locator("[data-project-create-submit]").click();
      const response = await created;
      expect(response.status()).toBe(201);
      const { id } = await response.json();
      projectIds.push(id);
      await expect(page).toHaveURL(new RegExp("/projects/" + id + "[?]"));
    }

    await page.goto("/admin");
    if (admin) {
      const target = page.getByText(accounts.super.email, { exact: true }).locator("..");
      const targetName = `${accounts.super.role}-${run}`;
      for (const name of [`${targetName} を編集`, `${targetName} のパスワードを再設定`, `${targetName} を無効化`, `${targetName} を削除`]) {
        await expect(target.getByRole("button", { name, exact: true })).toBeDisabled();
      }
      await expect(target.getByRole("combobox")).toBeDisabled();
      const member = page.getByText(accounts.member.email, { exact: true }).locator("..");
      await expect(member.getByRole("button", { name: `${accounts.member.role}-${run} を編集`, exact: true })).toBeEnabled();
      await expect(member.locator('option[value="super_admin"]')).toBeDisabled();
      await page.locator('[data-admin-tab="security"]').click();
      await expect(page.locator(`[data-totp-user="${accounts.super.id}"] button`)).toBeDisabled();
    } else {
      await expect(page.getByText("管理者権限が必要です。")).toBeVisible();
      await expect(page.locator("[data-admin-console]")).toHaveCount(0);
    }
    const target = `/api/admin/users/${accounts.super.id}`;
    for (const data of [{ password }, { password: "x" }, { email: role + "@example.test" }, { role: "member" }, { is_admin: false }, { deactivated: true }]) {
      await status(await page.request.patch(target, { data }), 403);
    }
    await status(await page.request.delete(target + "/2fa"), 403);
    await status(await page.request.delete(target), 403);
  });
}

test("saved projects and directory follow live membership", async ({ page, request }) => {
  await login(request, seedAdmin.email, seedAdmin.password);
  await login(page.request, accounts.guest.email);
  const id = await project(request, "Revoked-" + run);
  await addMember(request, id, accounts.guest.id, "editor");
  await addMember(request, id, accounts.admin.id, "viewer");
  await status(await page.request.post("/api/portfolio", { data: { project_id: id } }), 200);
  await status(await page.request.post(`/api/projects/${id}/duplicate`, { data: { name: "denied" } }), 403);
  await page.goto(`/projects/${id}`);
  const before = await page.request.get("/api/users");
  expect(await before.text()).toContain(accounts.admin.email);
  await status(await request.delete(`/api/projects/${id}/members/${accounts.guest.id}`), 200);
  expect(await (await page.request.get("/api/portfolio")).text()).not.toContain("Revoked-" + run);
  expect(await (await page.request.get("/api/users")).text()).not.toContain(accounts.admin.email);
  const response = await page.goto("/portfolio");
  expect(await response!.text()).not.toContain("Revoked-" + run);
});

test("portfolio entry points follow portfolio visibility", async ({ page, request }) => {
  await login(request, seedAdmin.email, seedAdmin.password);
  const created = await request.post("/api/portfolios", { data: { name: "Nav-" + run } });
  await status(created, 201);
  const portfolioId = (await created.json()).id as number;
  const sidebar = page.locator("[data-sidebar]");
  const sidebarToggle = page.locator("[data-sidebar-toggle]");
  const sidebarNavigation = page.locator("[data-sidebar-navigation]");
  const sidebarLink = sidebarNavigation.locator('a[href="/portfolio"]');
  const rail = page.locator("[data-sidebar-rail]");
  const railLink = rail.locator('a[href="/portfolio"]:not([data-sidebar-flyout-link])');
  const railFlyoutLink = page.locator('[data-sidebar-flyout="/portfolio"] a[href="/portfolio"]');
  const expectPortfolioEntryPoints = async (count: number) => {
    await expect(sidebar).toHaveAttribute("data-sidebar-collapsed", "false");
    await expect(sidebarNavigation).toBeVisible();
    await expect(sidebarLink).toHaveCount(count);
    await expect(rail).toHaveCount(0);

    await sidebarToggle.click();
    try {
      await expect(sidebar).toHaveAttribute("data-sidebar-collapsed", "true");
      await expect(sidebarNavigation).toHaveCount(0);
      await expect(rail).toBeVisible();
      await expect(railLink).toHaveCount(count);
      await expect(railFlyoutLink).toHaveCount(count);
      if (count > 0) {
        await railLink.hover();
        await expect(railFlyoutLink).toBeVisible();
      }
    } finally {
      await sidebarToggle.click();
    }
    await expect(sidebar).toHaveAttribute("data-sidebar-collapsed", "false");
    await expect(sidebarNavigation).toBeVisible();
    await expect(sidebarLink).toHaveCount(count);
    await expect(rail).toHaveCount(0);
  };
  try {
    await login(page.request, accounts.member.email);
    await page.goto("/");
    await expectPortfolioEntryPoints(0);

    await login(page.request, accounts.admin.email);
    await page.goto("/");
    await expectPortfolioEntryPoints(1);

    await status(await request.post(`/api/portfolios/${portfolioId}/planning/viewers`, { data: { userId: accounts.member.id } }), 200);
    await login(page.request, accounts.member.email);
    await page.goto("/");
    await expectPortfolioEntryPoints(1);
  } finally {
    await login(request, seedAdmin.email, seedAdmin.password);
    await status(await request.delete(`/api/portfolios/${portfolioId}/planning/viewers/${accounts.member.id}`), 200);
    await status(await request.delete(`/api/portfolios/${portfolioId}`), 200);
  }
});

test("admin can reset a member password and revoked sessions cannot return", async ({ page, request }) => {
  await login(request, accounts.admin.email);
  await login(page.request, accounts.member.email);
  const target = `/api/admin/users/${accounts.member.id}`;
  await status(await request.patch(target, { data: { password: password + "-changed" } }), 200);
  await page.goto("/trash");
  await expect(page).toHaveURL(/\/login$/);
  expect([401, 403]).toContain((await page.request.get("/api/users")).status());
  await login(page.request, accounts.member.email, password + "-changed");
  await status(await request.patch(target, { data: { deactivated: true } }), 200);
  await status(await request.patch(target, { data: { deactivated: false } }), 200);
  expect([401, 403]).toContain((await page.request.get("/api/users")).status());
  await status(await request.patch(target, { data: { password } }), 200);
});

test("custom administrator without audit or creation grants", async ({ page, request }) => {
  await login(request, seedAdmin.email, seedAdmin.password);
  const name = "limited-" + run;
  const response = await request.post("/api/admin/roles", {
    data: { name, base_level: "admin", permissions: ["members.manage"] },
  });
  await status(response, 201);
  const role = (await response.json()).roles.find((r: { name: string }) => r.name === name);
  let userId: number | undefined;
  try {
    const email = name + "@example.test";
    const user = await request.post("/api/admin/users", { data: { name, email, password, role: role.key } });
    await status(user, 201);
    userId = (await user.json()).id;
    await login(page.request, email);
    await page.goto("/portfolio");
    await expect(page.locator('a[href="/audit"]')).toHaveCount(0);
    for (const path of ["/audit", "/projects/new"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/$/);
    }
    await status(await page.request.get("/api/admin/audit/export?format=csv"), 403);
    await status(await page.request.get("/api/admin/users"), 200);
    await status(await page.request.post("/api/projects", { data: { workspace_id: 1, name } }), 403);
    await status(await page.request.patch(`/api/admin/users/${accounts.admin.id}`, { data: { password } }), 403);
    await status(await page.request.patch(`/api/admin/users/${accounts.member.id}`, { data: { is_admin: true } }), 403);
  } finally {
    if (userId) await status(await request.delete(`/api/admin/users/${userId}`), 200);
    await status(await request.delete(`/api/admin/roles/${role.id}`), 200);
  }
});

test("trash shows a shared task without disclosing its private primary project", async ({ page, request }) => {
  await login(request, seedAdmin.email, seedAdmin.password);
  const name = "Multi-home-" + run;
  const task = await request.post("/api/tasks", { data: { project_id: secret, name } });
  await status(task, 201);
  const { id } = await task.json();
  const added = await request.post("/api/memberships", { data: { task_id: id, project_id: shared } });
  expect(added.ok()).toBeTruthy();
  await status(await request.delete(`/api/tasks/${id}`), 200);
  await login(page.request, accounts.member.email);
  const html = await page.goto("/trash");
  expect(await html!.text()).not.toContain(secretName);
  const row = page.getByText(name, { exact: true }).locator("..");
  await expect(row).toContainText(sharedName);
  await expect(row.getByRole("button", { name: "復元" })).toBeDisabled();
  await status(await page.request.post(`/api/tasks/${id}/restore`), 403);
});

test("super administrator can recover a protected account", async ({ page }) => {
  await login(page.request, seedAdmin.email, seedAdmin.password);
  await page.goto("/admin");
  const user = page.getByText(accounts.super.email, { exact: true }).locator("..");
  await expect(user.getByRole("button", { name: `${accounts.super.role}-${run} を編集`, exact: true })).toBeEnabled();
  await page.locator('[data-admin-tab="security"]').click();
  await page.locator('[data-security-tab="two-factor"]').click();
  const row = page.locator(`[data-totp-user="${accounts.super.id}"]`);
  await expect(row.getByRole("button", { name: "リセット" })).toBeEnabled();
  await status(await page.request.delete(`/api/admin/users/${accounts.super.id}/2fa`), 200);
  await page.reload();
  await page.locator('[data-admin-tab="security"]').click();
  await page.locator('[data-security-tab="two-factor"]').click();
  await expect(row).toContainText("未設定");
});
