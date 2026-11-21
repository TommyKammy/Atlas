import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const run = randomUUID().slice(0, 8);
const prefix = `scim-conformance-${run}`;
const admin = { email: "admin@example.com", password: "atlas-dev-2026" };
const entraEmail = `${prefix}-entra@example.com`;
const entraUpdatedEmail = `${prefix}-entra-updated@example.com`;
const oktaEmail = `${prefix}-okta@example.com`;

type ConformanceResult = {
  profile: string;
  name: string;
  expected: string;
  actual: string;
  ok: boolean;
};

type ConformanceOptions = {
  baseUrl: string;
  token: string;
  profile: "entra" | "okta" | "all";
  prefix?: string;
  allowHttp?: boolean;
};

let api: APIRequestContext;
let runConformance: (options: ConformanceOptions) => Promise<ConformanceResult[]>;
let originalScimEnabled = false;
let entraToken = "";
let oktaToken = "";
const tokenIds: number[] = [];

async function login(context: APIRequestContext, email: string, password: string) {
  const response = await context.post("/api/auth/login", { data: { email, password } });
  expect(response.status(), `login ${email}`).toBe(200);
}

async function expectStatus(response: APIResponse, status: number) {
  expect(response.status(), `${response.url()} → ${response.status()}`).toBe(status);
  return response;
}

async function json<T>(response: APIResponse): Promise<T> {
  return await response.json() as T;
}

async function expectUserDeactivated(emails: string[]) {
  const response = await expectStatus(await api.get("/api/admin/users"), 200);
  const users = (await json<{
    users: { id: number; email: string; deactivated_at: string | null }[];
  }>(response)).users;
  const rows = users.filter((user) => emails.includes(user.email));
  expect(rows.length, `test users ${emails.join(", ")}`).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.deactivated_at, row.email).not.toBeNull();
  }
}

test.beforeAll(async ({ playwright, baseURL }) => {
  if (!baseURL) throw new Error("SCIM conformance tests require a base URL");
  api = await playwright.request.newContext({ baseURL });
  await login(api, admin.email, admin.password);

  const security = await expectStatus(await api.get("/api/admin/security"), 200);
  originalScimEnabled = (await json<{ settings: { scim_enabled: boolean } }>(security))
    .settings.scim_enabled;
  await expectStatus(await api.patch("/api/admin/security", {
    data: { scim_enabled: true },
  }), 200);
  const enabled = await expectStatus(await api.get("/api/admin/security"), 200);
  expect((await json<{ settings: { scim_enabled: boolean } }>(enabled)).settings.scim_enabled)
    .toBe(true);

  for (const idp of ["entra", "okta"] as const) {
    const issued = await expectStatus(await api.post("/api/admin/scim/tokens", {
      data: { name: `Phase3 conformance ${idp} ${run}`, idp },
    }), 201);
    const body = await json<{ id: number; token: string }>(issued);
    tokenIds.push(body.id);
    expect(body.token).toMatch(/^atlas_scim_[A-Za-z0-9_-]{43}$/);
    if (idp === "entra") entraToken = body.token;
    else oktaToken = body.token;
  }

  runConformance = (await import("../../scripts/scim-conformance.mjs")).runConformance;
});

test.beforeEach(async () => {
  // scim.spec.ts and scim-admin.spec.ts toggle the same workspace setting. The
  // browser suite runs with one worker, but re-enable in case a prior file
  // restored it to false before this spec started.
  await login(api, admin.email, admin.password);
  await expectStatus(await api.patch("/api/admin/security", {
    data: { scim_enabled: true },
  }), 200);
});

test.afterAll(async () => {
  if (!api) return;
  try { await login(api, admin.email, admin.password); } catch { /* best effort while cleaning */ }
  const usersResponse = await api.get("/api/admin/users").catch(() => null);
  if (usersResponse && usersResponse.status() === 200) {
    const users = (await usersResponse.json() as {
      users: { id: number; email: string }[];
    }).users;
    for (const user of users) {
      if (typeof user.email !== "string" || !user.email.startsWith(`${prefix}-`)) continue;
      const response = await api.delete(`/api/admin/users/${user.id}`).catch(() => null);
      if (response && ![200, 404].includes(response.status())) {
        console.error(`SCIM conformance cleanup failed for user ${user.id}: ${response.status()}`);
      }
    }
  }
  for (const id of tokenIds) {
    await api.delete(`/api/admin/scim/tokens/${id}`).catch(() => undefined);
  }
  await api.patch("/api/admin/security", { data: { scim_enabled: originalScimEnabled } })
    .catch(() => undefined);
  await api.dispose();
});

test("Entra profile passes every conformance check", async ({ baseURL }) => {
  expect(entraToken).not.toBe("");
  const results = await runConformance({
    baseUrl: baseURL!,
    token: entraToken,
    profile: "entra",
    prefix,
    allowHttp: true,
  });
  const failed = results.filter((result) => !result.ok);
  expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  expect(results).toHaveLength(19);
  expect(results.filter((result) => result.profile === "common").length).toBe(6);
  expect(results.some((result) => result.name.includes("DELETE returns 204"))).toBe(true);
  expect(results.some((result) => result.name.includes("POST after DELETE restores"))).toBe(true);

  await expectUserDeactivated([entraEmail, entraUpdatedEmail]);
});

test("Okta profile passes every conformance check", async ({ baseURL }) => {
  expect(oktaToken).not.toBe("");
  const results = await runConformance({
    baseUrl: baseURL!,
    token: oktaToken,
    profile: "okta",
    prefix,
    allowHttp: true,
  });
  const failed = results.filter((result) => !result.ok);
  expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  expect(results).toHaveLength(17);
  expect(results.filter((result) => result.profile === "common").length).toBe(6);
  expect(results.some((result) => result.name.includes("(AIW PUT) without active"))).toBe(true);
  expect(results.some((result) => result.name.includes("(OIN PATCH)")
    && result.name.includes("active=false"))).toBe(true);
  expect(results.some((result) => result.name.includes("(OIN PATCH)")
    && result.name.includes("active=true"))).toBe(true);
  expect(results.some((result) => result.name.includes("final PUT leaves the test user deactivated")))
    .toBe(true);

  await expectUserDeactivated([oktaEmail]);
});
