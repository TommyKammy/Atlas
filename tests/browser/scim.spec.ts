import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const run = randomUUID().slice(0, 8);
const admin = { email: "admin@example.com", password: "atlas-dev-2026" };
const password = `Scim-Test-${run}!A1`;
const cleanupUserIds = new Set<number>();
const temporarilyDeactivatedAdmins: number[] = [];

let api: APIRequestContext;
let scimToken = "";
let scimTokenId = 0;
const additionalTokenIds: number[] = [];

async function login(context: APIRequestContext, email: string, pw: string) {
  const response = await context.post("/api/auth/login", { data: { email, password: pw } });
  expect(response.status(), `login ${email}`).toBe(200);
}

function scim(path: string, init: { method?: string; data?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/scim+json" };
  const token = init.token ?? scimToken;
  if (token !== "") headers.Authorization = `Bearer ${token}`;
  return api.fetch(`/scim/v2${path}`, {
    method: init.method ?? "GET",
    headers,
    data: init.data,
  });
}

async function expectStatus(response: APIResponse, status: number) {
  expect(response.status(), `${response.url()} → ${response.status()}`).toBe(status);
  return response;
}

async function json<T>(response: APIResponse): Promise<T> {
  return await response.json() as T;
}

async function filterUsers(filter: string) {
  const params = new URLSearchParams({ filter });
  return api.fetch(`/scim/v2/Users?${params}`, {
    headers: { Authorization: `Bearer ${scimToken}` },
  });
}

async function createScimUser(data: Record<string, unknown>): Promise<{ id: number; body: Record<string, unknown> }> {
  const response = await expectStatus(await scim("/Users", { method: "POST", data }), 201);
  const body = await json<Record<string, unknown>>(response);
  const id = Number(body.id);
  cleanupUserIds.add(id);
  return { id, body };
}

test.beforeAll(async ({ playwright, baseURL }) => {
  api = await playwright.request.newContext({ baseURL });
  await login(api, admin.email, admin.password);
  await expectStatus(await api.patch("/api/admin/security", { data: { scim_enabled: true } }), 200);
  const security = await expectStatus(await api.get("/api/admin/security"), 200);
  expect((await json<{ settings: { scim_enabled: boolean } }>(security)).settings.scim_enabled).toBe(true);
  const issued = await expectStatus(await api.post("/api/admin/scim/tokens", {
    data: { name: `R12-1 Entra ${run}`, idp: "entra" },
  }), 201);
  const issuedBody = await json<{ id: number; token: string }>(issued);
  scimToken = issuedBody.token;
  scimTokenId = issuedBody.id;
  expect(scimToken).toMatch(/^atlas_scim_[A-Za-z0-9_-]{43}$/);
  const listed = await expectStatus(await api.get("/api/admin/scim/tokens"), 200);
  const rows = (await json<{ tokens: Record<string, unknown>[] }>(listed)).tokens;
  expect(rows.some((row) => row.id === scimTokenId)).toBe(true);
  expect(rows.every((row) => !("token_hash" in row))).toBe(true);
});

test.afterAll(async () => {
  if (!api) return;
  // Restore temporary administrators first so the admin session cannot be locked out.
  try { await login(api, admin.email, admin.password); } catch { /* best effort while cleaning */ }
  for (const id of temporarilyDeactivatedAdmins) {
    await api.patch(`/api/admin/users/${id}`, { data: { deactivated: false } }).catch(() => undefined);
  }
  for (const id of cleanupUserIds) {
    const response = await api.delete(`/api/admin/users/${id}`).catch(() => null);
    if (response && ![200, 404].includes(response.status())) {
      console.error(`SCIM cleanup failed for user ${id}: ${response.status()}`);
    }
  }
  if (scimTokenId) {
    await api.delete(`/api/admin/scim/tokens/${scimTokenId}`).catch(() => undefined);
  }
  for (const id of additionalTokenIds) {
    await api.delete(`/api/admin/scim/tokens/${id}`).catch(() => undefined);
  }
  await api.patch("/api/admin/security", { data: { scim_enabled: false } }).catch(() => undefined);
  await api.dispose();
});

test("missing, invalid, revoked and SCIM-disabled tokens return 401", async () => {
  const missing = await expectStatus(await scim("/Users", { token: "" }), 401);
  expect(missing.headers()["content-type"]).toContain("application/scim+json");
  expect((await json<{ status: string }>(missing)).status).toBe("401");

  await expectStatus(await scim("/Users", { token: `atlas_scim_${"a".repeat(43)}` }), 401);

  const extra = await expectStatus(await api.post("/api/admin/scim/tokens", {
    data: { name: `R12-1 revoked ${run}`, idp: "okta" },
  }), 201);
  const extraBody = await json<{ id: number; token: string }>(extra);
  await expectStatus(await api.delete(`/api/admin/scim/tokens/${extraBody.id}`), 200);
  await expectStatus(await scim("/Users", { token: extraBody.token }), 401);

  await expectStatus(await api.patch("/api/admin/security", { data: { scim_enabled: false } }), 200);
  await expectStatus(await scim("/Users"), 401);
  await expectStatus(await api.patch("/api/admin/security", { data: { scim_enabled: true } }), 200);
  await expectStatus(await scim("/Users"), 200);
});

test("only a super administrator can manage SCIM tokens or change scim_enabled", async ({ playwright, baseURL }) => {
  const email = `scim-limited-admin-${run}@example.test`;
  const created = await expectStatus(await api.post("/api/admin/users", {
    data: { name: "SCIM limited admin", email, password, role: "admin" },
  }), 201);
  cleanupUserIds.add((await json<{ id: number }>(created)).id);
  const context = await playwright.request.newContext({ baseURL });
  try {
    await login(context, email, password);
    await expectStatus(await context.get("/api/admin/scim/tokens"), 403);
    await expectStatus(await context.post("/api/admin/scim/tokens", {
      data: { name: "not allowed", idp: "entra" },
    }), 403);
    await expectStatus(await context.delete(`/api/admin/scim/tokens/${scimTokenId}`), 403);
    await expectStatus(await context.patch("/api/admin/security", {
      data: { scim_enabled: false },
    }), 403);
    // The denied request did not revoke the working token or disable SCIM.
    await expectStatus(await scim("/Users"), 200);
  } finally {
    await context.dispose();
  }
});

test("ServiceProviderConfig, ResourceTypes and Schemas describe the supported surface", async () => {
  const config = await expectStatus(await scim("/ServiceProviderConfig"), 200);
  expect(config.headers()["content-type"]).toContain("application/scim+json");
  const configBody = await json<{
    patch: { supported: boolean };
    bulk: { supported: boolean };
    filter: { supported: boolean; maxResults: number };
    sort: { supported: boolean };
    etag: { supported: boolean };
    authenticationSchemes: { type: string }[];
  }>(config);
  expect(configBody.patch.supported).toBe(true);
  expect(configBody.bulk.supported).toBe(false);
  expect(configBody.filter).toEqual({ supported: true, maxResults: 200 });
  expect(configBody.sort.supported).toBe(false);
  expect(configBody.etag.supported).toBe(false);
  expect(configBody.authenticationSchemes[0].type).toBe("oauthbearertoken");

  const types = await expectStatus(await scim("/ResourceTypes"), 200);
  const typesBody = await json<{ totalResults: number; Resources: { id: string }[] }>(types);
  expect(typesBody.totalResults).toBe(1);
  expect(typesBody.Resources[0].id).toBe("User");

  const schemas = await expectStatus(await scim("/Schemas"), 200);
  const schemasBody = await json<{
    Resources: { attributes: { name: string }[] }[];
  }>(schemas);
  const attributes = schemasBody.Resources[0].attributes.map((attribute) => attribute.name);
  for (const name of ["userName", "name", "displayName", "emails", "title", "externalId", "active", "id", "meta"]) {
    expect(attributes).toContain(name);
  }
});

test("create, filter, get, Entra PATCH deactivation and session revocation", async ({ playwright, baseURL }) => {
  const email = `scim-create-${run}@example.test`;
  const externalId = `entra-${run}`;
  const created = await createScimUser({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    userName: email,
    externalId,
    name: { formatted: "SCIM Created" },
    title: "Engineer",
    active: true,
  });
  const id = created.id;
  expect(created.body).toMatchObject({
    id: String(id),
    externalId,
    userName: email,
    displayName: "SCIM Created",
    title: "Engineer",
    active: true,
  });

  for (const filter of [
    `userName eq "${email}"`,
    `externalId eq "${externalId}"`,
    `emails.value eq "${email}"`,
    `emails[type eq "work"].value eq "${email}"`,
    `id eq "${id}"`,
  ]) {
    const response = await expectStatus(await filterUsers(filter), 200);
    const body = await json<{ totalResults: number; Resources: { id: string }[] }>(response);
    expect(body.totalResults, filter).toBe(1);
    expect(body.Resources[0].id).toBe(String(id));
  }

  await expectStatus(await scim(`/Users/${id}`), 200);

  const zeroPage = await expectStatus(await scim("/Users?startIndex=0&count=0"), 200);
  const zeroPageBody = await json<{
    startIndex: number; totalResults: number; itemsPerPage: number; Resources: unknown[];
  }>(zeroPage);
  expect(zeroPageBody.startIndex).toBe(1);
  expect(zeroPageBody.totalResults).toBeGreaterThan(0);
  expect(zeroPageBody.itemsPerPage).toBe(0);
  expect(zeroPageBody.Resources).toEqual([]);

  // Give the SCIM-created account a password so it can hold a real session.
  await expectStatus(await api.patch(`/api/admin/users/${id}`, {
    data: { password, title: "Engineer" },
  }), 200);
  const userContext = await playwright.request.newContext({ baseURL });
  try {
    await login(userContext, email, password);
    await expectStatus(await userContext.get("/api/users"), 200);

    const disabled = await expectStatus(await scim(`/Users/${id}`, {
      method: "PATCH",
      data: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "Replace", path: "active", value: "False" }],
      },
    }), 200);
    const disabledBody = await json<{ active: boolean }>(disabled);
    expect(disabledBody.active).toBe(false);
    // Atlas has historically answered 403 when a well-formed session cookie no
    // longer resolves; the important contract is that the revoked session
    // cannot reach user data and a page navigation falls back to /login.
    expect([401, 403]).toContain((await userContext.get("/api/users")).status());
    const pageAfterDeactivation = await userContext.get("/inbox", { maxRedirects: 0 });
    expect(pageAfterDeactivation.status()).toBe(307);
    expect(new URL(pageAfterDeactivation.headers().location!, baseURL).pathname).toBe("/login");

    const enabled = await expectStatus(await scim(`/Users/${id}`, {
      method: "PATCH",
      data: { Operations: [{ op: "replace", path: "active", value: true }] },
    }), 200);
    expect((await json<{ active: boolean }>(enabled)).active).toBe(true);

    const replaced = await expectStatus(await scim(`/Users/${id}`, {
      method: "PUT",
      data: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        id: String(id),
        userName: email,
        externalId,
        name: { givenName: "Updated", familyName: "Person" },
        title: "Staff Engineer",
        active: true,
      },
    }), 200);
    expect(await json<{ displayName: string; title: string }>(replaced)).toMatchObject({
      displayName: "Updated Person",
      title: "Staff Engineer",
    });
  } finally {
    await userContext.dispose();
  }
});

test("POST with an existing email binds the existing account instead of creating a new one", async () => {
  const email = `scim-existing-${run}@example.test`;
  const existing = await expectStatus(await api.post("/api/admin/users", {
    data: { name: "Existing Member", email, password, role: "member" },
  }), 201);
  const existingId = (await json<{ id: number }>(existing)).id;
  cleanupUserIds.add(existingId);

  await expectStatus(await api.patch(`/api/admin/users/${existingId}`, { data: { title: "Old Title" } }), 200);

  const bound = await createScimUser({
    userName: email,
    externalId: `okta-${run}`,
    name: { formatted: "Existing Member" },
    title: "Account Manager",
    active: true,
  });
  expect(bound.id).toBe(existingId);
  expect(bound.body.title).toBe("Account Manager");
  const filtered = await expectStatus(await filterUsers(`externalId eq "okta-${run}"`), 200);
  expect((await json<{ totalResults: number }>(filtered)).totalResults).toBe(1);

  // A binding POST without title keeps the title already stored in Atlas.
  const keepEmail = `scim-existing-keep-${run}@example.test`;
  const keep = await expectStatus(await api.post("/api/admin/users", {
    data: { name: "Keep Title", email: keepEmail, password, role: "member" },
  }), 201);
  const keepId = (await json<{ id: number }>(keep)).id;
  cleanupUserIds.add(keepId);
  await expectStatus(await api.patch(`/api/admin/users/${keepId}`, { data: { title: "Kept Title" } }), 200);
  const kept = await createScimUser({ userName: keepEmail, externalId: `okta-keep-${run}`, active: true });
  expect(kept.id).toBe(keepId);
  expect(kept.body.title).toBe("Kept Title");
});

test("a UPN userName stays separate from the work email and survives renames", async () => {
  const email = `scim-upn-mail-${run}@example.test`;
  const upn = `scim-upn-${run}@corp.onmicrosoft.com`;
  const renamed = `scim-upn-renamed-${run}@corp.onmicrosoft.com`;
  const created = await createScimUser({
    userName: upn,
    emails: [{ value: email, type: "work", primary: true }],
    name: { formatted: "UPN User" },
    active: true,
  });
  const id = created.id;
  expect(created.body.userName).toBe(upn);
  expect((created.body.emails as { value: string }[])[0].value).toBe(email);

  const byUpn = await expectStatus(await filterUsers(`userName eq "${upn}"`), 200);
  expect((await json<{ totalResults: number; Resources: { id: string }[] }>(byUpn)).totalResults).toBe(1);
  const byUpperUpn = await expectStatus(await filterUsers(`userName eq "${upn.toUpperCase()}"`), 200);
  expect((await json<{ totalResults: number }>(byUpperUpn)).totalResults).toBe(1);
  const byEmailAsUserName = await expectStatus(await filterUsers(`userName eq "${email}"`), 200);
  expect((await json<{ totalResults: number }>(byEmailAsUserName)).totalResults).toBe(0);
  const byEmail = await expectStatus(await filterUsers(`emails.value eq "${email}"`), 200);
  expect((await json<{ totalResults: number }>(byEmail)).totalResults).toBe(1);

  const patched = await expectStatus(await scim(`/Users/${id}`, {
    method: "PATCH",
    data: { Operations: [{ op: "Replace", path: "userName", value: renamed }] },
  }), 200);
  const patchedBody = await json<{ userName: string; emails: { value: string }[] }>(patched);
  expect(patchedBody.userName).toBe(renamed);
  expect(patchedBody.emails[0].value).toBe(email);

  const byRenamed = await expectStatus(await filterUsers(`userName eq "${renamed}"`), 200);
  expect((await json<{ totalResults: number; Resources: { id: string }[] }>(byRenamed)).totalResults).toBe(1);
  const byOldUpn = await expectStatus(await filterUsers(`userName eq "${upn}"`), 200);
  expect((await json<{ totalResults: number }>(byOldUpn)).totalResults).toBe(0);

  // PUT without emails must not replace the work address with the new UPN.
  const latestUpn = `scim-upn-latest-${run}@corp.onmicrosoft.com`;
  const put = await expectStatus(await scim(`/Users/${id}`, {
    method: "PUT",
    data: {
      userName: latestUpn,
      name: { formatted: "UPN User" },
      title: "Principal",
    },
  }), 200);
  const putBody = await json<{ userName: string; emails: { value: string }[] }>(put);
  expect(putBody.userName).toBe(latestUpn);
  expect(putBody.emails[0].value).toBe(email);
});

test("PATCH userName follows the email only when it was derived from userName", async () => {
  const oldEmail = `scim-derived-${run}@example.test`;
  const newEmail = `scim-derived-renamed-${run}@example.test`;
  const created = await createScimUser({
    userName: oldEmail,
    name: { formatted: "Derived Email" },
    active: true,
  });
  expect((created.body.emails as { value: string }[])[0].value).toBe(oldEmail);

  const patched = await expectStatus(await scim(`/Users/${created.id}`, {
    method: "PATCH",
    data: { Operations: [{ op: "replace", path: "userName", value: newEmail }] },
  }), 200);
  const body = await json<{ userName: string; emails: { value: string }[] }>(patched);
  expect(body.userName).toBe(newEmail);
  expect(body.emails[0].value).toBe(newEmail);
  const filtered = await expectStatus(await filterUsers(`userName eq "${newEmail}"`), 200);
  expect((await json<{ totalResults: number }>(filtered)).totalResults).toBe(1);
});

test("PATCH name.familyName keeps the stored givenName and updates the full display name", async () => {
  const created = await createScimUser({
    userName: `scim-name-${run}@example.test`,
    name: { givenName: "Taro", familyName: "Yamada" },
    active: true,
  });
  expect(created.body.name).toMatchObject({ givenName: "Taro", familyName: "Yamada" });
  expect(created.body.displayName).toBe("Taro Yamada");

  const patched = await expectStatus(await scim(`/Users/${created.id}`, {
    method: "PATCH",
    data: { Operations: [{ op: "Replace", path: "name.familyName", value: "Suzuki" }] },
  }), 200);
  expect(await json<{ name: Record<string, string>; displayName: string }>(patched)).toMatchObject({
    name: { formatted: "Taro Suzuki", givenName: "Taro", familyName: "Suzuki" },
    displayName: "Taro Suzuki",
  });
  const fetched = await expectStatus(await scim(`/Users/${created.id}`), 200);
  expect(await json<{ name: Record<string, string> }>(fetched)).toMatchObject({
    name: { givenName: "Taro", familyName: "Suzuki" },
  });
});

test("a duplicate POST for an active SCIM binding is 409 uniqueness", async () => {
  const email = `scim-duplicate-${run}@example.test`;
  const upn = `scim-duplicate-${run}@corp.onmicrosoft.com`;
  const payload = {
    userName: upn,
    emails: [{ value: email, type: "work", primary: true }],
    externalId: `duplicate-${run}`,
    name: { formatted: "Duplicate User" },
    active: true,
  };
  const created = await createScimUser(payload);
  for (const duplicate of [
    payload,
    { ...payload, userName: `scim-duplicate-other-${run}@corp.onmicrosoft.com` },
    { ...payload, emails: [{ value: `scim-duplicate-other-${run}@example.test`, type: "work", primary: true }] },
  ]) {
    const response = await scim("/Users", { method: "POST", data: duplicate });
    await expectStatus(response, 409);
    expect((await json<{ scimType: string }>(response)).scimType).toBe("uniqueness");
  }
  const fetched = await expectStatus(await scim(`/Users/${created.id}`), 200);
  expect((await json<{ userName: string }>(fetched)).userName).toBe(upn);
});

test("DELETE deactivates, returns 404 afterwards, keeps the account, and a later POST reactivates it", async () => {
  const email = `scim-delete-${run}@example.test`;
  const externalId = `delete-${run}`;
  const created = await createScimUser({
    userName: email,
    externalId,
    name: { formatted: "Delete Me" },
    active: true,
  });
  const id = created.id;

  await expectStatus(await scim(`/Users/${id}`, { method: "DELETE" }), 204);
  await expectStatus(await scim(`/Users/${id}`), 404);

  const users = await expectStatus(await api.get("/api/admin/users"), 200);
  const row = (await json<{ users: { id: number; deactivated_at: string | null }[] }>(users)).users
    .find((user) => user.id === id);
  expect(row).toBeTruthy();
  expect(row!.deactivated_at).not.toBeNull();

  const refreshedExternalId = `delete-new-${run}`;
  const revived = await createScimUser({
    userName: email,
    externalId: refreshedExternalId,
    name: { formatted: "Delete Me" },
    active: true,
  });
  expect(revived.id).toBe(id);
  expect(revived.body.externalId).toBe(refreshedExternalId);
  const fetched = await expectStatus(await scim(`/Users/${id}`), 200);
  expect((await json<{ active: boolean; externalId: string }>(fetched))).toMatchObject({
    active: true, externalId: refreshedExternalId,
  });
  const byNewExternal = await expectStatus(await filterUsers(`externalId eq "${refreshedExternalId}"`), 200);
  expect((await json<{ totalResults: number }>(byNewExternal)).totalResults).toBe(1);
  const byOldExternal = await expectStatus(await filterUsers(`externalId eq "${externalId}"`), 200);
  expect((await json<{ totalResults: number }>(byOldExternal)).totalResults).toBe(0);
});

test("a token from another IdP can update a binding and the audit records the IdP change", async () => {
  const created = await createScimUser({
    userName: `scim-idp-${run}@example.test`,
    name: { formatted: "IdP Change" },
    active: true,
  });
  const issued = await expectStatus(await api.post("/api/admin/scim/tokens", {
    data: { name: `R12-1 Okta ${run}`, idp: "okta" },
  }), 201);
  const okta = await json<{ id: number; token: string }>(issued);
  additionalTokenIds.push(okta.id);
  try {
    const oktaUpdate = await expectStatus(await scim(`/Users/${created.id}`, {
      method: "PATCH",
      token: okta.token,
      data: { Operations: [{ op: "replace", path: "title", value: "From Okta" }] },
    }), 200);
    expect((await json<{ title: string }>(oktaUpdate)).title).toBe("From Okta");
    const entraUpdate = await expectStatus(await scim(`/Users/${created.id}`, {
      method: "PATCH",
      data: { Operations: [{ op: "replace", path: "title", value: "From Entra" }] },
    }), 200);
    expect((await json<{ title: string }>(entraUpdate)).title).toBe("From Entra");
    const exported = await expectStatus(await api.get("/api/admin/audit/export?format=json"), 200);
    const rows = (await json<{ rows: { action: string; summary: string }[] }>(exported)).rows;
    expect(rows.some((row) => row.action === "scim.user.update"
      && row.summary.includes("IdP を entra から okta に変更"))).toBe(true);
  } finally {
    await api.delete(`/api/admin/scim/tokens/${okta.id}`).catch(() => undefined);
  }
});

test("PUT without active leaves the account disabled", async () => {
  const email = `scim-put-active-${run}@example.test`;
  const created = await createScimUser({
    userName: email,
    name: { formatted: "PUT Active" },
    active: true,
  });
  await expectStatus(await scim(`/Users/${created.id}`, {
    method: "PATCH",
    data: { Operations: [{ op: "replace", path: "active", value: false }] },
  }), 200);
  const put = await expectStatus(await scim(`/Users/${created.id}`, {
    method: "PUT",
    data: {
      userName: email,
      emails: [{ value: email, type: "work", primary: true }],
      name: { formatted: "PUT Active Renamed" },
      title: "Still Disabled",
    },
  }), 200);
  expect(await json<{ active: boolean }>(put)).toMatchObject({ active: false });
  await expectStatus(await scim(`/Users/${created.id}`, {
    method: "PATCH",
    data: { Operations: [{ op: "replace", path: "active", value: true }] },
  }), 200);
});

test("the last active administrator cannot be disabled from SCIM", async () => {
  const usersResponse = await expectStatus(await api.get("/api/admin/users"), 200);
  const users = (await json<{
    users: { id: number; email: string; is_admin: boolean; deactivated_at: string | null }[];
  }>(usersResponse)).users;
  const self = users.find((user) => user.email === admin.email);
  expect(self).toBeTruthy();
  for (const user of users) {
    if (user.id !== self!.id && user.is_admin && user.deactivated_at === null) {
      await expectStatus(await api.patch(`/api/admin/users/${user.id}`, { data: { deactivated: true } }), 200);
      temporarilyDeactivatedAdmins.push(user.id);
    }
  }
  try {
    const denied = await scim(`/Users/${self!.id}`, {
      method: "PATCH",
      data: { Operations: [{ op: "replace", path: "active", value: false }] },
    });
    await expectStatus(denied, 400);
    expect(denied.headers()["content-type"]).toContain("application/scim+json");
    const list = await expectStatus(await api.get("/api/admin/users"), 200);
    const stillActive = (await json<{ users: { id: number; deactivated_at: string | null }[] }>(list)).users
      .find((user) => user.id === self!.id);
    expect(stillActive?.deactivated_at).toBeNull();
    const exported = await expectStatus(await api.get("/api/admin/audit/export?format=json"), 200);
    const auditRows = (await json<{ rows: { action: string; summary: string }[] }>(exported)).rows;
    expect(auditRows.some((row) => row.action === "scim.user.deactivate_denied"
      && row.summary.includes("Entra ID"))).toBe(true);
  } finally {
    for (const id of temporarilyDeactivatedAdmins.splice(0)) {
      await expectStatus(await api.patch(`/api/admin/users/${id}`, { data: { deactivated: false } }), 200);
    }
  }
});

test("invalid filters are invalidFilter and duplicate emails are uniqueness conflicts", async () => {
  const invalid = await expectStatus(await filterUsers('displayName eq "nobody"'), 400);
  const invalidBody = await json<{ status: string; scimType: string }>(invalid);
  expect(invalidBody.status).toBe("400");
  expect(invalidBody.scimType).toBe("invalidFilter");

  const first = await createScimUser({
    userName: `scim-first-${run}@example.test`,
    externalId: `first-${run}`,
    name: { formatted: "First" },
  });
  const second = await createScimUser({
    userName: `scim-second-${run}@example.test`,
    externalId: `second-${run}`,
    name: { formatted: "Second" },
  });
  const conflict = await scim(`/Users/${second.id}`, {
    method: "PATCH",
    data: { Operations: [{ op: "replace", path: "userName", value: `scim-first-${run}@example.test` }] },
  });
  await expectStatus(conflict, 409);
  expect((await json<{ scimType: string }>(conflict)).scimType).toBe("uniqueness");
  expect(first.id).not.toBe(second.id);
});

test("audit entries identify SCIM writes without a human actor", async () => {
  const exported = await expectStatus(await api.get("/api/admin/audit/export?format=json"), 200);
  const rows = (await json<{ rows: { action: string; actor_name: string | null; summary: string }[] }>(exported)).rows;
  const created = rows.find((row) => row.action === "scim.user.create" && row.summary.includes("Entra ID"));
  expect(created).toBeTruthy();
  expect(created!.actor_name).toBeNull();
  const page = await expectStatus(await api.get("/audit"), 200);
  expect(await page.text()).toContain("SCIM");
});
