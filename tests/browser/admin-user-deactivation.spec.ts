import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const run = randomUUID().slice(0, 8);
const admin = { email: "admin@example.com", password: "atlas-dev-2026" };
const password = `Admin-Deactivate-${run}!A1`;
const userIds = new Set<number>();
let api: APIRequestContext;
let adminId = 0;

async function login(context: APIRequestContext, email: string, pw: string) {
  const response = await context.post("/api/auth/login", { data: { email, password: pw } });
  expect(response.status()).toBe(200);
}

async function createUser(name: string, email: string, role: string) {
  const response = await api.post("/api/admin/users", {
    data: { name, email, password, role },
  });
  expect(response.status()).toBe(201);
  const id = (await response.json() as { id: number }).id;
  userIds.add(id);
  return id;
}

test.beforeAll(async ({ playwright, baseURL }) => {
  api = await playwright.request.newContext({ baseURL });
  await login(api, admin.email, admin.password);
  const users = await api.get("/api/admin/users");
  expect(users.status()).toBe(200);
  const me = (await users.json() as { users: { id: number; email: string }[] }).users
    .find((user) => user.email === admin.email);
  expect(me).toBeTruthy();
  adminId = me!.id;
});

test.afterAll(async () => {
  if (!api) return;
  try { await login(api, admin.email, admin.password); } catch { /* best effort */ }
  for (const id of userIds) {
    const response = await api.delete(`/api/admin/users/${id}`).catch(() => null);
    if (response && ![200, 404].includes(response.status())) {
      console.error(`admin deactivation cleanup failed for user ${id}: ${response.status()}`);
    }
  }
  await api.dispose();
});

test("the last active administrator cannot deactivate itself", async () => {
  const response = await api.patch(`/api/admin/users/${adminId}`, {
    data: { deactivated: true },
  });
  expect(response.status()).toBe(400);
  const combined = await api.patch(`/api/admin/users/${adminId}`, {
    data: { role: "member", deactivated: true },
  });
  expect(combined.status()).toBe(400);
  const me = await api.get("/api/me");
  expect(me.status()).toBe(200);
});

test("role change and deactivation in one PATCH both take effect", async () => {
  const email = `admin-combined-${run}@example.test`;
  const id = await createUser("Combined Admin", email, "admin");
  const response = await api.patch(`/api/admin/users/${id}`, {
    data: { role: "member", deactivated: true },
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    id,
    role_key: "member",
    is_admin: false,
    is_guest: false,
  });
  const users = await api.get("/api/admin/users");
  const row = (await users.json() as {
    users: { id: number; role_key: string; deactivated_at: string | null }[];
  }).users.find((user) => user.id === id);
  expect(row).toBeTruthy();
  expect(row!.role_key).toBe("member");
  expect(row!.deactivated_at).not.toBeNull();
});

test("admin deactivation revokes the target's session", async ({ playwright, baseURL }) => {
  const email = `admin-session-${run}@example.test`;
  const id = await createUser("Session Member", email, "member");
  const context = await playwright.request.newContext({ baseURL });
  try {
    await login(context, email, password);
    expect((await context.get("/api/users")).status()).toBe(200);
    const deactivated = await api.patch(`/api/admin/users/${id}`, {
      data: { deactivated: true },
    });
    expect(deactivated.status()).toBe(200);
    expect(await deactivated.json()).toMatchObject({ id });
    expect([401, 403]).toContain((await context.get("/api/users")).status());
    const page = await context.get("/inbox", { maxRedirects: 0 });
    expect(page.status()).toBe(307);
    expect(new URL(page.headers().location!, baseURL).pathname).toBe("/login");
  } finally {
    await context.dispose();
    await api.patch(`/api/admin/users/${id}`, { data: { deactivated: false } }).catch(() => undefined);
  }
});
