import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runConformance } from "./scim-conformance.mjs";

const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
const RESOURCE_TYPE_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:ResourceType";
const TOKEN = `atlas_scim_${"t".repeat(43)}`;
const SCRIPT_PATH = fileURLToPath(new URL("./scim-conformance.mjs", import.meta.url));

function createMockAtlas({
  token = TOKEN,
  fail = () => false,
  failDetail = null,
  echoAuth = false,
  ignorePatchActive = false,
  noopDeleteNumber = null,
} = {}) {
  const users = new Map();
  const requests = [];
  let nextId = 1;
  let deleteCount = 0;

  function response(status, body, extraHeaders = {}) {
    const headers = new Headers({
      "content-type": "application/scim+json",
      ...extraHeaders,
    });
    return {
      status,
      headers,
      text: async () => (body === undefined ? "" : JSON.stringify(body)),
    };
  }

  function error(status, scimType, detail = "mock error") {
    return response(status, {
      schemas: [ERROR_SCHEMA],
      status: String(status),
      ...(scimType ? { scimType } : {}),
      detail,
    });
  }

  function parseBody(init) {
    if (!init?.body) return null;
    try {
      return JSON.parse(init.body);
    } catch {
      return null;
    }
  }

  function activeFrom(value, fallback) {
    if (value === undefined) return fallback;
    if (typeof value === "boolean") return value;
    if (typeof value === "string" && /^true$/i.test(value.trim())) return true;
    if (typeof value === "string" && /^false$/i.test(value.trim())) return false;
    return fallback;
  }

  function emailFrom(body) {
    const list = Array.isArray(body?.emails) ? body.emails : (body?.emails ? [body.emails] : []);
    const values = list
      .map((item) => (typeof item === "string" ? item : item?.value))
      .filter((value) => typeof value === "string" && value.trim() !== "");
    const primary = list.find((item) => item && typeof item === "object" && item.primary === true);
    const work = list.find((item) => item && typeof item === "object"
      && String(item.type).toLowerCase() === "work");
    const value = primary?.value ?? work?.value ?? values[0] ?? body?.userName ?? "";
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }

  function displayNameOf(user) {
    return user.displayName
      ?? user.formatted
      ?? ([user.givenName, user.familyName].filter(Boolean).join(" ") || user.email);
  }

  function resource(user) {
    const name = { formatted: displayNameOf(user) };
    if (user.givenName) name.givenName = user.givenName;
    if (user.familyName) name.familyName = user.familyName;
    return {
      schemas: [USER_SCHEMA],
      id: String(user.id),
      ...(user.externalId ? { externalId: user.externalId } : {}),
      userName: user.userName,
      name,
      displayName: displayNameOf(user),
      emails: [{ value: user.email, type: "work", primary: true }],
      title: user.title,
      active: user.active,
      meta: {
        resourceType: "User",
        created: new Date(0).toISOString(),
        lastModified: new Date(0).toISOString(),
        location: `https://scim.example.test/scim/v2/Users/${user.id}`,
      },
    };
  }

  function applyName(user, body) {
    if (typeof body.name === "string") user.formatted = body.name;
    else if (body.name && typeof body.name === "object") {
      if (typeof body.name.formatted === "string") user.formatted = body.name.formatted;
      if (typeof body.name.givenName === "string") user.givenName = body.name.givenName;
      if (typeof body.name.familyName === "string") user.familyName = body.name.familyName;
    }
    if (typeof body.displayName === "string") user.displayName = body.displayName;
  }

  function replaceName(user, body) {
    if (!("name" in body) && !("displayName" in body)) return;
    user.formatted = null;
    user.givenName = null;
    user.familyName = null;
    user.displayName = null;
    applyName(user, body);
  }

  function applyPathless(user, value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, item] of Object.entries(value)) {
      const normalized = key.toLowerCase();
      if (normalized === "name") {
        if (typeof item === "string") user.formatted = item;
        else if (item && typeof item === "object") {
          if (typeof item.formatted === "string") user.formatted = item.formatted;
          if (typeof item.givenName === "string") user.givenName = item.givenName;
          if (typeof item.familyName === "string") user.familyName = item.familyName;
        }
      } else if (normalized === "displayname" && typeof item === "string") {
        user.displayName = item;
      } else if (normalized === "title" && typeof item === "string") {
        user.title = item;
      } else if (normalized === "active") {
        if (!ignorePatchActive) user.active = activeFrom(item, user.active);
      } else if (normalized === "username" && typeof item === "string") {
        user.userName = item;
      } else if (normalized === "externalid") {
        user.externalId = item === null ? null : String(item);
      } else if (normalized === "emails") {
        const email = emailFrom({ emails: item });
        if (email) user.email = email;
      }
      // Unsupported attributes such as the enterprise extension are ignored.
    }
  }

  function applyPatch(user, operations) {
    for (const operation of operations) {
      if (!operation || typeof operation !== "object" || typeof operation.op !== "string") continue;
      const remove = operation.op.toLowerCase() === "remove";
      const path = typeof operation.path === "string" ? operation.path.trim() : "";
      if (path === "") {
        if (!remove) applyPathless(user, operation.value);
        continue;
      }
      if (/^active$/i.test(path)) {
        if (!ignorePatchActive) user.active = activeFrom(operation.value, remove ? true : user.active);
      } else if (/^userName$/i.test(path)) {
        if (!remove && typeof operation.value === "string") user.userName = operation.value;
      } else if (/^name\.(givenName|familyName|formatted)$/i.test(path)) {
        const part = path.split(".")[1].toLowerCase();
        if (remove) {
          if (part === "givenname") user.givenName = null;
          else if (part === "familyname") user.familyName = null;
          else user.formatted = null;
        } else if (typeof operation.value === "string") {
          if (part === "givenname") user.givenName = operation.value;
          else if (part === "familyname") user.familyName = operation.value;
          else user.formatted = operation.value;
        }
      } else if (/^emails\s*\[\s*type\s+eq\s+"work"\s*\]\s*\.value$/i.test(path)
        || /^emails\.value$/i.test(path)) {
        const value = typeof operation.value === "string" ? operation.value : operation.value?.value;
        if (!remove && typeof value === "string" && value.trim() !== "") {
          user.email = value.trim().toLowerCase();
        }
      } else if (/^title$/i.test(path)) {
        if (remove) user.title = "";
        else if (typeof operation.value === "string") user.title = operation.value;
      } else if (/^externalId$/i.test(path)) {
        if (remove || operation.value === null) user.externalId = null;
        else if (typeof operation.value === "string") user.externalId = operation.value;
      } else if (/^name$/i.test(path)) {
        if (remove) {
          user.formatted = null;
          user.givenName = null;
          user.familyName = null;
        } else if (typeof operation.value === "string") {
          user.formatted = operation.value;
        } else if (operation.value && typeof operation.value === "object") {
          if (typeof operation.value.formatted === "string") user.formatted = operation.value.formatted;
          if (typeof operation.value.givenName === "string") user.givenName = operation.value.givenName;
          if (typeof operation.value.familyName === "string") user.familyName = operation.value.familyName;
        }
      } else if (/^displayName$/i.test(path)) {
        if (remove) user.displayName = null;
        else if (typeof operation.value === "string") user.displayName = operation.value;
      } else if (/^emails$/i.test(path)) {
        const email = emailFrom({ emails: operation.value });
        if (!remove && email) user.email = email;
      }
      // Unknown paths are ignored, like Atlas ignores enterprise attributes.
    }
  }

  function findByPathId(path) {
    const match = /^\/Users\/([^/]+)$/.exec(path);
    if (!match) return null;
    return users.get(Number(decodeURIComponent(match[1]))) ?? null;
  }

  async function fetchImpl(input, init = {}) {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const path = url.pathname.replace(/^\/scim\/v2/, "") || "/";
    requests.push({
      method,
      path,
      url: String(input),
      headers: { ...(init.headers ?? {}) },
      body: typeof init.body === "string" ? init.body : null,
    });

    if (fail(method, path)) {
      return error(500, undefined, failDetail ? failDetail(method, path) : "mock failure");
    }

    const authorization = init.headers?.Authorization ?? init.headers?.authorization ?? "";
    if (authorization !== `Bearer ${token}`) {
      return error(401, undefined, echoAuth
        ? `invalid token ${authorization}`
        : "invalid or expired bearer token");
    }

    if (method === "GET" && path === "/ServiceProviderConfig") {
      return response(200, {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
        documentationUri: "/docs/scim.md",
        patch: { supported: true },
        bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
        filter: { supported: true, maxResults: 200 },
        changePassword: { supported: false },
        sort: { supported: false },
        etag: { supported: false },
        authenticationSchemes: [{
          type: "oauthbearertoken",
          name: "OAuth Bearer Token",
          primary: true,
        }],
      });
    }

    if (method === "GET" && path === "/ResourceTypes") {
      return response(200, {
        schemas: [LIST_SCHEMA],
        totalResults: 1,
        itemsPerPage: 1,
        startIndex: 1,
        Resources: [{
          schemas: [RESOURCE_TYPE_SCHEMA],
          id: "User",
          name: "User",
          endpoint: "/Users",
          schema: USER_SCHEMA,
          schemaExtensions: [],
        }],
      });
    }

    if (method === "GET" && path === "/Schemas") {
      return response(200, {
        schemas: [LIST_SCHEMA],
        totalResults: 1,
        itemsPerPage: 1,
        startIndex: 1,
        Resources: [{
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
          id: USER_SCHEMA,
          name: "User",
          attributes: [
            "userName", "name", "displayName", "emails", "title", "externalId", "active", "id", "meta",
          ].map((name) => ({ name })),
        }],
      });
    }

    if (method === "GET" && path === "/Users") {
      const filter = url.searchParams.get("filter");
      let matches = [...users.values()].filter((user) => !user.deleted);
      if (filter) {
        const match = /^(userName|externalId|id|emails\.value|emails\[type eq "work"\]\.value)\s+eq\s+"((?:[^"\\]|\\.)*)"$/i.exec(filter.trim());
        if (!match) return error(400, "invalidFilter");
        const field = match[1].toLowerCase();
        const value = match[2].replace(/\\(["\\/])/g, "$1");
        matches = matches.filter((user) => {
          if (field === "username") return user.userName.toLowerCase() === value.toLowerCase();
          if (field === "externalid") return user.externalId === value;
          if (field === "id") return String(user.id) === value;
          return user.email.toLowerCase() === value.toLowerCase();
        });
      }
      const startIndex = Math.max(1, Number(url.searchParams.get("startIndex") ?? 1) || 1);
      const rawCount = url.searchParams.get("count");
      const count = rawCount === null ? 100 : Math.min(200, Math.max(0, Number(rawCount) || 0));
      const page = matches.slice(startIndex - 1, startIndex - 1 + count);
      return response(200, {
        schemas: [LIST_SCHEMA],
        totalResults: matches.length,
        startIndex,
        itemsPerPage: page.length,
        Resources: page.map(resource),
      });
    }

    if (method === "POST" && path === "/Users") {
      const body = parseBody(init);
      if (!body || typeof body !== "object") return error(400, "invalidSyntax");
      const email = emailFrom(body);
      const userName = typeof body.userName === "string" && body.userName.trim() !== ""
        ? body.userName
        : email;
      if (!email || !userName) return error(400, "invalidValue");
      const activeBinding = [...users.values()].find((user) => !user.deleted
        && user.userName.toLowerCase() === userName.toLowerCase());
      if (activeBinding) return error(409, "uniqueness");
      let user = [...users.values()].find((candidate) => candidate.email.toLowerCase() === email.toLowerCase());
      if (user && !user.deleted && user.scim) return error(409, "uniqueness");
      if (!user) {
        user = {
          id: nextId,
          scim: true,
          deleted: false,
          active: true,
          userName,
          email,
          externalId: null,
          givenName: null,
          familyName: null,
          formatted: null,
          displayName: null,
          title: "",
        };
        nextId += 1;
        users.set(user.id, user);
      }
      user.scim = true;
      user.deleted = false;
      user.userName = userName;
      user.email = email;
      if ("externalId" in body) {
        user.externalId = body.externalId === null ? null : String(body.externalId);
      }
      applyName(user, body);
      if (typeof body.title === "string") user.title = body.title;
      user.active = activeFrom(body.active, true);
      return response(201, resource(user), {
        location: `https://scim.example.test/scim/v2/Users/${user.id}`,
      });
    }

    const user = findByPathId(path);
    if (user) {
      if (method === "GET") {
        if (user.deleted) return error(404);
        return response(200, resource(user));
      }
      if (user.deleted) return error(404);
      if (method === "PATCH") {
        const body = parseBody(init);
        const operations = body?.Operations ?? body?.operations;
        if (!Array.isArray(operations) || operations.length === 0) return error(400, "invalidSyntax");
        applyPatch(user, operations);
        return response(200, resource(user));
      }
      if (method === "PUT") {
        const body = parseBody(init);
        if (!body || typeof body !== "object") return error(400, "invalidSyntax");
        if (body.emails !== undefined) {
          const email = emailFrom(body);
          if (!email) return error(400, "invalidValue");
          user.email = email;
        }
        if (typeof body.userName === "string" && body.userName.trim() !== "") {
          user.userName = body.userName;
        }
        replaceName(user, body);
        if (typeof body.title === "string") user.title = body.title;
        if ("externalId" in body) {
          user.externalId = body.externalId === null ? null : String(body.externalId);
        }
        if ("active" in body) user.active = activeFrom(body.active, user.active);
        return response(200, resource(user));
      }
      if (method === "DELETE") {
        deleteCount += 1;
        if (deleteCount === noopDeleteNumber) return response(204);
        user.active = false;
        user.deleted = true;
        return response(204);
      }
    }

    return error(404);
  }

  return { fetchImpl, users, requests };
}

const BASE = {
  baseUrl: "https://scim.example.test",
  token: TOKEN,
};

function failedRows(results) {
  return results.filter((row) => !row.ok);
}

function startMockServer(atlas) {
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString("utf8");
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("mock server is not listening");
      }
      const response = await atlas.fetchImpl(
        `http://127.0.0.1:${address.port}${req.url}`,
        {
          method: req.method,
          headers: { ...req.headers },
          body: body === "" ? undefined : body,
        },
      );
      res.statusCode = response.status;
      for (const [name, value] of response.headers.entries()) res.setHeader(name, value);
      res.end(await response.text());
    } catch (error) {
      res.statusCode = 500;
      res.end(error instanceof Error ? error.message : String(error));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("mock server did not bind to a port"));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function runCli(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT_PATH, ...args], {
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("Entra profile passes and leaves the test user deactivated", async () => {
  const atlas = createMockAtlas();
  const logs = [];
  let observedPrefix = "";
  const results = await runConformance({
    ...BASE,
    profile: "entra",
    prefix: "conformance-entra",
    fetchImpl: atlas.fetchImpl,
    log: (message) => logs.push(message),
    onPrefix: (value) => { observedPrefix = value; },
  });

  assert.equal(failedRows(results).length, 0, JSON.stringify(failedRows(results), null, 2));
  assert.ok(results.length >= 19);
  assert.equal(observedPrefix, "conformance-entra");
  assert.ok(results.every((row) => typeof row.profile === "string"
    && typeof row.name === "string"
    && typeof row.expected === "string"
    && typeof row.actual === "string"
    && typeof row.ok === "boolean"));
  const created = [...atlas.users.values()].filter((user) => user.email.startsWith("conformance-entra"));
  assert.equal(created.length, 1);
  assert.equal(created[0].active, false);
  assert.equal(created[0].deleted, true);
  assert.equal(JSON.stringify(results).includes(TOKEN), false);
  assert.equal(logs.join("\n").includes(TOKEN), false);
});

test("onPrefix receives the generated default prefix", async () => {
  const atlas = createMockAtlas();
  let observedPrefix = "";
  const results = await runConformance({
    ...BASE,
    profile: "entra",
    fetchImpl: atlas.fetchImpl,
    onPrefix: (value) => { observedPrefix = value; },
  });

  assert.equal(failedRows(results).length, 0, JSON.stringify(failedRows(results), null, 2));
  assert.match(observedPrefix, /^scim-conformance-[a-f0-9]{8}$/);
  assert.ok([...atlas.users.values()].some((user) => user.email.startsWith(observedPrefix)));
});

test("Entra retries cleanup when a no-op final DELETE is not followed by a 404", async () => {
  const atlas = createMockAtlas({ noopDeleteNumber: 2 });
  const results = await runConformance({
    ...BASE,
    profile: "entra",
    prefix: "conformance-entra-delete-retry",
    fetchImpl: atlas.fetchImpl,
  });

  const failed = failedRows(results);
  assert.equal(results.length, 19);
  assert.equal(failed.length, 1);
  assert.ok(failed[0].name.includes("final DELETE"));
  const deletes = atlas.requests.filter((request) => request.method === "DELETE");
  assert.equal(deletes.length, 3);
  const created = [...atlas.users.values()]
    .find((user) => user.email.startsWith("conformance-entra-delete-retry"));
  assert.ok(created);
  assert.equal(created.active, false);
  assert.equal(created.deleted, true);
});

test("Okta profile passes, never sends DELETE, and leaves the test user deactivated", async () => {
  const atlas = createMockAtlas();
  const logs = [];
  const results = await runConformance({
    ...BASE,
    profile: "okta",
    prefix: "conformance-okta",
    fetchImpl: atlas.fetchImpl,
    log: (message) => logs.push(message),
  });

  assert.equal(failedRows(results).length, 0, JSON.stringify(failedRows(results), null, 2));
  assert.equal(results.length, 17);
  assert.ok(results.some((row) => row.name.includes("(AIW PUT)")));
  assert.ok(results.some((row) => row.name.includes("(OIN PATCH)")
    && row.name.includes("active=false")));
  assert.ok(results.some((row) => row.name.includes("(OIN PATCH)")
    && row.name.includes("active=true")));
  const patches = atlas.requests.filter((request) => request.method === "PATCH");
  assert.equal(patches.length, 2);
  assert.deepEqual(JSON.parse(patches[0].body), {
    schemas: [PATCH_SCHEMA],
    Operations: [{ op: "replace", value: { active: false } }],
  });
  assert.deepEqual(JSON.parse(patches[1].body), {
    schemas: [PATCH_SCHEMA],
    Operations: [{ op: "replace", value: { active: true } }],
  });
  const created = [...atlas.users.values()].filter((user) => user.email.startsWith("conformance-okta"));
  assert.equal(created.length, 1);
  assert.equal(created[0].active, false);
  assert.equal(created[0].deleted, false);
  assert.equal(atlas.requests.some((request) => request.method === "DELETE"), false);
  assert.equal(JSON.stringify(results).includes(TOKEN), false);
  assert.equal(logs.join("\n").includes(TOKEN), false);
});

test("Okta OIN PATCH deactivation is a failed check when the server ignores the PATCH", async () => {
  const atlas = createMockAtlas({ ignorePatchActive: true });
  const results = await runConformance({
    ...BASE,
    profile: "okta",
    prefix: "conformance-okta-patch-failure",
    fetchImpl: atlas.fetchImpl,
  });

  const failed = failedRows(results);
  assert.equal(results.length, 17);
  assert.equal(failed.length, 1);
  const patchDeactivation = failed.filter((row) => row.name.includes("(OIN PATCH)")
    && row.name.includes("active=false"));
  assert.equal(patchDeactivation.length, 1);
  assert.match(patchDeactivation[0].expected, /active=false/);
  assert.match(patchDeactivation[0].actual, /HTTP 200/);
  assert.equal(failed.some((row) => row.name.includes("(AIW PUT)")), false);
  const created = [...atlas.users.values()]
    .filter((user) => user.email.startsWith("conformance-okta-patch-failure"));
  assert.equal(created.length, 1);
  assert.equal(created[0].active, false);
  assert.equal(created[0].deleted, false);
});

test("profile=all runs both flows and the common checks once", async () => {
  const atlas = createMockAtlas();
  const results = await runConformance({
    ...BASE,
    profile: "all",
    prefix: "conformance-all",
    fetchImpl: atlas.fetchImpl,
  });

  assert.equal(failedRows(results).length, 0, JSON.stringify(failedRows(results), null, 2));
  assert.equal(results.filter((row) => row.profile === "common").length, 6);
  assert.ok(results.some((row) => row.profile === "entra"));
  assert.ok(results.some((row) => row.profile === "okta"));
  assert.equal(atlas.users.size, 2);
  const states = [...atlas.users.values()]
    .map((user) => ({ active: user.active, deleted: user.deleted }))
    .sort((a, b) => Number(a.deleted) - Number(b.deleted));
  assert.deepEqual(states, [
    { active: false, deleted: false },
    { active: false, deleted: true },
  ]);
});

test("plain HTTP is rejected unless allowHttp and a loopback host are used", async () => {
  const atlas = createMockAtlas();
  const base = {
    ...BASE,
    profile: "entra",
    prefix: "http-check",
    fetchImpl: atlas.fetchImpl,
  };

  await assert.rejects(
    () => runConformance({ ...base, baseUrl: "http://example.test" }),
    /allowHttp/,
  );
  await assert.rejects(
    () => runConformance({ ...base, baseUrl: "http://localhost:3000" }),
    /allowHttp/,
  );
  await assert.rejects(
    () => runConformance({ ...base, baseUrl: "http://192.0.2.10", allowHttp: true }),
    /localhost, 127\.0\.0\.1 or \[::1\]/,
  );
  await assert.rejects(
    () => runConformance({ ...base, baseUrl: "https://example.test/scim/v2/users" }),
    /end with \/scim\/v2/,
  );

  const results = await runConformance({
    ...base,
    baseUrl: "http://127.0.0.1:3000",
    allowHttp: true,
    prefix: "http-ok",
  });
  assert.equal(failedRows(results).length, 0, JSON.stringify(failedRows(results), null, 2));
  assert.equal(atlas.requests[0].url.startsWith("http://127.0.0.1:3000/scim/v2/"), true);
});

test("a server error becomes a failed result instead of an exception", async () => {
  const atlas = createMockAtlas({
    fail: (method, path) => method === "POST" && path === "/Users",
  });
  const results = await runConformance({
    ...BASE,
    profile: "entra",
    prefix: "failure-check",
    fetchImpl: atlas.fetchImpl,
  });

  const failed = failedRows(results);
  assert.ok(failed.length > 0);
  assert.ok(failed.some((row) => row.name.includes("POST creates a user")));
  assert.ok(failed.every((row) => row.actual.includes("HTTP 500")));
});

test("the token never appears in results, logs, or fetch error messages", async () => {
  const echoing = createMockAtlas({
    fail: () => true,
    failDetail: () => `server saw ${TOKEN}`,
  });
  const logs = [];
  const results = await runConformance({
    ...BASE,
    profile: "entra",
    prefix: "leak-check",
    fetchImpl: echoing.fetchImpl,
    log: (message) => logs.push(message),
  });
  assert.ok(results.length > 0);
  assert.ok(failedRows(results).length > 0);
  assert.equal(JSON.stringify(results).includes(TOKEN), false);
  assert.equal(logs.join("\n").includes(TOKEN), false);

  const throwing = async () => {
    throw new Error(`network unavailable for ${TOKEN}`);
  };
  const thrownResults = await runConformance({
    ...BASE,
    profile: "entra",
    prefix: "throw-check",
    fetchImpl: throwing,
  });
  assert.ok(failedRows(thrownResults).length > 0);
  assert.equal(JSON.stringify(thrownResults).includes(TOKEN), false);
  assert.ok(thrownResults.some((row) => row.actual.includes("[redacted]")));
});

test("token, profile, prefix and base URL are validated", async () => {
  const atlas = createMockAtlas();
  await assert.rejects(
    () => runConformance({ ...BASE, token: "", profile: "entra", fetchImpl: atlas.fetchImpl }),
    /token is required/,
  );
  await assert.rejects(
    () => runConformance({ ...BASE, profile: "azure", fetchImpl: atlas.fetchImpl }),
    /profile must be entra, okta or all/,
  );
  await assert.rejects(
    () => runConformance({ ...BASE, profile: "entra", prefix: "bad prefix!", fetchImpl: atlas.fetchImpl }),
    /prefix must be/,
  );
  await assert.rejects(
    () => runConformance({ ...BASE, baseUrl: "", profile: "entra", fetchImpl: atlas.fetchImpl }),
    /baseUrl is required/,
  );
});

test("CLI prints the actual prefix and test user names without the token", async () => {
  const atlas = createMockAtlas();
  const { server, baseUrl } = await startMockServer(atlas);
  try {
    const prefix = "cli-prefix-review";
    const result = await runCli([
      "--base", baseUrl,
      "--profile", "all",
      "--prefix", prefix,
      "--allow-http",
    ], { SCIM_TOKEN: TOKEN });

    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`Test user prefix: ${prefix}`));
    assert.ok(result.stdout.includes("Test users left deactivated:"));
    assert.ok(result.stdout.includes(`Entra UPN: ${prefix}-entra@example.org`));
    assert.ok(result.stdout.includes(`Okta userName: ${prefix}-okta@example.com`));
    assert.equal(`${result.stdout}${result.stderr}`.includes(TOKEN), false);
    assert.equal(result.stdout.includes("atlas_scim_"), false);
    const users = [...atlas.users.values()];
    const entra = users.find((user) => user.email.startsWith(`${prefix}-entra`));
    const okta = users.find((user) => user.email.startsWith(`${prefix}-okta`));
    assert.ok(entra);
    assert.equal(entra.active, false);
    assert.equal(entra.deleted, true);
    assert.ok(okta);
    assert.equal(okta.active, false);
    assert.equal(okta.deleted, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("CLI help works without a token and --token is rejected without echoing the secret", () => {
  const help = spawnSync(process.execPath, [SCRIPT_PATH, "--help"], {
    encoding: "utf8",
    env: { ...process.env, SCIM_TOKEN: "" },
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /SCIM_TOKEN/);
  assert.match(help.stdout, /--allow-http/);

  const secret = `atlas_scim_${"z".repeat(43)}`;
  const rejected = spawnSync(process.execPath, [
    SCRIPT_PATH, "--base", "https://example.test", "--token", secret,
  ], { encoding: "utf8" });
  assert.equal(rejected.status, 2);
  assert.equal(`${rejected.stdout}${rejected.stderr}`.includes(secret), false);
  assert.match(rejected.stderr, /SCIM_TOKEN/);

  const missing = spawnSync(process.execPath, [
    SCRIPT_PATH, "--base", "https://example.test", "--profile", "entra",
  ], { encoding: "utf8", env: { ...process.env, SCIM_TOKEN: "" } });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /SCIM_TOKEN is required/);
});
