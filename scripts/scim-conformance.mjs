#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const ENTERPRISE_SCHEMA = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
const LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const SP_CONFIG_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig";
const RESOURCE_TYPE_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:ResourceType";
const SCIM_CONTENT_TYPE = "application/scim+json";
const PROFILES = new Set(["entra", "okta", "all"]);
const PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

class ConformanceConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConformanceConfigError";
  }
}

function safeStringify(value) {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function redact(value, token) {
  let text = typeof value === "string" ? value : safeStringify(value);
  if (token) text = text.split(token).join("[redacted]");
  // Defense in depth: even a token that the caller did not pass through the
  // documented option must never appear in a report.
  text = text.replace(/atlas_scim_[A-Za-z0-9._~+/-]+/g, "atlas_scim_[redacted]");
  return text;
}

function clip(text, max = 600) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, Math.max(0, max - 3))}...`;
}

function isLoopbackHost(hostname) {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

function resolveRoot(baseUrl, allowHttp) {
  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new ConformanceConfigError("baseUrl is required");
  }
  let url;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new ConformanceConfigError("baseUrl must be an absolute URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ConformanceConfigError("baseUrl must use https (http is only allowed for loopback development)");
  }
  if (url.username !== "" || url.password !== "") {
    throw new ConformanceConfigError("baseUrl must not contain credentials");
  }
  if (url.search !== "" || url.hash !== "") {
    throw new ConformanceConfigError("baseUrl must not contain a query string or fragment");
  }
  if (url.protocol === "http:") {
    if (!allowHttp) {
      throw new ConformanceConfigError("http baseUrl requires allowHttp (CLI: --allow-http)");
    }
    if (!isLoopbackHost(url.hostname)) {
      throw new ConformanceConfigError("http baseUrl is only allowed for localhost, 127.0.0.1 or [::1]");
    }
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname !== "" && pathname !== "/scim/v2") {
    throw new ConformanceConfigError("baseUrl must be the host origin or end with /scim/v2");
  }
  return `${url.origin}/scim/v2`;
}

function resolvePrefix(prefix) {
  if (prefix === undefined || prefix === null || prefix === "") {
    return `scim-conformance-${randomBytes(4).toString("hex")}`;
  }
  if (typeof prefix !== "string" || !PREFIX_PATTERN.test(prefix)) {
    throw new ConformanceConfigError(
      "prefix must be 1-40 characters of letters, digits, dot, underscore or hyphen, starting with a letter or digit",
    );
  }
  return prefix.toLowerCase();
}

function entraUpn(prefix) {
  return `${prefix}-entra@example.org`;
}

function entraWorkEmail(prefix) {
  return `${prefix}-entra@example.com`;
}

function oktaUserName(prefix) {
  return `${prefix}-okta@example.com`;
}

function withQuery(path, params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  const query = search.toString();
  return query === "" ? path : `${path}?${query}`;
}

function headerOf(response, name) {
  const headers = response?.headers;
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) ?? "";
  const lower = name.toLowerCase();
  if (typeof headers === "object") {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === lower) return String(value);
    }
  }
  return "";
}

function hasSchema(body, schema) {
  return Boolean(body) && Array.isArray(body.schemas) && body.schemas.includes(schema);
}

function isScimContentType(response) {
  return headerOf(response, "content-type").toLowerCase().includes(SCIM_CONTENT_TYPE);
}

function isListResponse(response, { total, startIndex, items }) {
  const body = response.json;
  return response.status === 200
    && isScimContentType(response)
    && hasSchema(body, LIST_SCHEMA)
    && Number.isInteger(body?.totalResults)
    && body.totalResults === total
    && body.startIndex === startIndex
    && body.itemsPerPage === items
    && Array.isArray(body.Resources)
    && body.Resources.length === items;
}

function isErrorResponse(response, status) {
  const body = response.json;
  return response.status === status
    && isScimContentType(response)
    && hasSchema(body, ERROR_SCHEMA)
    && body.status === String(status);
}

function responseDetail(response) {
  if (!response) return "(no response)";
  if (response.status === 0) return `network error: ${response.error ?? "unknown"}`;
  const contentType = headerOf(response, "content-type") || "(none)";
  const body = response.json === null || response.json === undefined
    ? (response.text || "(empty)")
    : safeStringify(response.json);
  return `HTTP ${response.status}; content-type=${contentType}; body=${clip(body, 360)}`;
}

function isEmailValue(body, expected, type = "work") {
  if (!Array.isArray(body?.emails) || body.emails.length === 0) return false;
  const entry = body.emails.find((item) => item?.type === type) ?? body.emails[0];
  return entry?.value === expected;
}

async function runCommonChecks({ record, request, authToken }) {
  const config = await request("GET", "ServiceProviderConfig");
  const configBody = config.json ?? {};
  const configOk = config.status === 200
    && isScimContentType(config)
    && hasSchema(configBody, SP_CONFIG_SCHEMA)
    && configBody.patch?.supported === true
    && configBody.bulk?.supported === false
    && configBody.filter?.supported === true
    && configBody.filter?.maxResults === 200
    && configBody.sort?.supported === false
    && configBody.etag?.supported === false
    && configBody.changePassword?.supported === false
    && Array.isArray(configBody.authenticationSchemes)
    && configBody.authenticationSchemes.some((scheme) => scheme?.type === "oauthbearertoken");
  record(
    "common",
    "ServiceProviderConfig returns the supported feature set",
    "HTTP 200; application/scim+json; patch=true; filter=true/maxResults=200; bulk/sort/etag/changePassword=false; oauthbearertoken",
    responseDetail(config),
    configOk,
  );

  const resourceTypes = await request("GET", "ResourceTypes");
  const resourceTypesBody = resourceTypes.json ?? {};
  const resourceType = Array.isArray(resourceTypesBody.Resources) ? resourceTypesBody.Resources[0] : null;
  const resourceTypesOk = isListResponse(resourceTypes, { total: 1, startIndex: 1, items: 1 })
    && Array.isArray(resourceType?.schemas)
    && resourceType.schemas.includes(RESOURCE_TYPE_SCHEMA)
    && resourceType?.id === "User"
    && resourceType?.name === "User"
    && resourceType?.endpoint === "/Users"
    && resourceType?.schema === SCIM_USER_SCHEMA;
  record(
    "common",
    "ResourceTypes lists the User resource",
    "HTTP 200; ListResponse; totalResults=1; Resources[0] id/name=User, endpoint=/Users, core User schema",
    responseDetail(resourceTypes),
    resourceTypesOk,
  );

  const schemas = await request("GET", "Schemas");
  const schemasBody = schemas.json ?? {};
  const userSchema = Array.isArray(schemasBody.Resources) ? schemasBody.Resources[0] : null;
  const attributeNames = Array.isArray(userSchema?.attributes)
    ? userSchema.attributes.map((attribute) => attribute?.name)
    : [];
  const requiredAttributes = [
    "userName", "name", "displayName", "emails", "title", "externalId", "active", "id", "meta",
  ];
  const missingAttributes = requiredAttributes.filter((name) => !attributeNames.includes(name));
  const schemasOk = isListResponse(schemas, { total: 1, startIndex: 1, items: 1 })
    && userSchema?.id === SCIM_USER_SCHEMA
    && missingAttributes.length === 0;
  record(
    "common",
    "Schemas lists the supported User attributes",
    `HTTP 200; ListResponse; core User schema; attributes include ${requiredAttributes.join(", ")}`,
    `${responseDetail(schemas)}${missingAttributes.length > 0 ? `; missing=${missingAttributes.join(",")}` : ""}`,
    schemasOk,
  );

  const list = await request("GET", withQuery("Users", { startIndex: 1, count: 1 }));
  const listBody = list.json;
  const expectedItems = Number.isInteger(listBody?.totalResults)
    ? Math.min(1, listBody.totalResults)
    : 0;
  const listOk = list.status === 200
    && isScimContentType(list)
    && hasSchema(listBody, LIST_SCHEMA)
    && Number.isInteger(listBody?.totalResults)
    && listBody.startIndex === 1
    && listBody.itemsPerPage === expectedItems
    && Array.isArray(listBody.Resources)
    && listBody.Resources.length === expectedItems;
  record(
    "common",
    "ListResponse exposes schemas, totalResults, startIndex and itemsPerPage",
    "HTTP 200; ListResponse schema; startIndex=1; itemsPerPage equals Resources length",
    responseDetail(list),
    listOk,
  );

  const missingToken = await request("GET", withQuery("Users", { count: 1 }), { tokenValue: "" });
  const missingTokenOk = isErrorResponse(missingToken, 401);
  record(
    "common",
    "Missing bearer token returns 401 with a SCIM error",
    'HTTP 401; application/scim+json; Error schema; status is the string "401"',
    responseDetail(missingToken),
    missingTokenOk,
  );

  let invalidToken = `atlas_scim_${"a".repeat(43)}`;
  if (invalidToken === authToken) invalidToken = `atlas_scim_${"b".repeat(43)}`;
  const invalid = await request("GET", withQuery("Users", { count: 1 }), { tokenValue: invalidToken });
  const invalidOk = isErrorResponse(invalid, 401);
  record(
    "common",
    "Invalid bearer token returns 401 with a SCIM error",
    'HTTP 401; application/scim+json; Error schema; status is the string "401"',
    responseDetail(invalid),
    invalidOk,
  );
}

async function runEntraProfile({ record, request, prefix }) {
  const local = `${prefix}-entra`;
  // UPN is deliberately separate from the work email, and both domains are
  // reserved for documentation and testing.
  const upn = entraUpn(prefix);
  const email = entraWorkEmail(prefix);
  const updatedEmail = `${local}-updated@example.com`;
  const externalId = `${local}-ext`;
  const reboundExternalId = `${local}-rebound`;
  const createdIds = new Set();
  const finalizedIds = new Set();

  const createPayload = {
    schemas: [SCIM_USER_SCHEMA, ENTERPRISE_SCHEMA],
    userName: upn,
    externalId,
    name: { givenName: "Entra", familyName: "Conformance" },
    emails: [{ value: email, type: "work", primary: true }],
    title: "Entra Conformance",
    active: true,
    [ENTERPRISE_SCHEMA]: {
      employeeNumber: `C-${prefix}`,
      department: "Conformance",
      organization: "Atlas QA",
      manager: { value: `${prefix}-manager`, displayName: "Conformance Manager" },
    },
  };

  try {
    const filtered = await request("GET", withQuery("Users", { filter: `userName eq "${upn}"` }));
    const filteredOk = isListResponse(filtered, { total: 0, startIndex: 1, items: 0 });
    record(
      "entra",
      "Entra: filter by userName before creation returns an empty ListResponse",
      "HTTP 200; ListResponse; totalResults=0; startIndex=1; itemsPerPage=0; Resources=[]",
      responseDetail(filtered),
      filteredOk,
    );
    if (!filteredOk) return;

    const created = await request("POST", "Users", { body: createPayload });
    const id = created.status === 201 && typeof created.json?.id === "string" ? created.json.id : null;
    if (id !== null) createdIds.add(id);
    const createOk = created.status === 201
      && isScimContentType(created)
      && hasSchema(created.json, SCIM_USER_SCHEMA)
      && typeof created.json?.id === "string"
      && created.json.id !== ""
      && created.json.userName === upn
      && created.json.externalId === externalId
      && created.json.active === true
      && created.json.displayName === "Entra Conformance"
      && created.json.name?.givenName === "Entra"
      && created.json.name?.familyName === "Conformance"
      && isEmailValue(created.json, email);
    record(
      "entra",
      "Entra: POST creates a user with UPN, work email and an enterprise extension",
      `HTTP 201; User schema; userName=${upn}; externalId=${externalId}; emails[work]=${email}; name=Entra Conformance; active=true`,
      responseDetail(created),
      createOk,
    );
    if (id === null) {
      record(
        "entra",
        "Entra: POST returned no user id, so dependent checks were skipped",
        "HTTP 201 with a string id",
        responseDetail(created),
        false,
      );
      return;
    }

    const fetched = await request("GET", `Users/${encodeURIComponent(id)}`);
    const getOk = fetched.status === 200
      && isScimContentType(fetched)
      && fetched.json?.id === id
      && fetched.json?.userName === upn
      && fetched.json?.externalId === externalId
      && fetched.json?.active === true
      && isEmailValue(fetched.json, email);
    record(
      "entra",
      "Entra: GET by id returns the created user",
      `HTTP 200; id=${id}; userName=${upn}; externalId=${externalId}; active=true`,
      responseDetail(fetched),
      getOk,
    );

    const duplicate = await request("POST", "Users", { body: createPayload });
    if (duplicate.status === 201 && typeof duplicate.json?.id === "string") {
      createdIds.add(duplicate.json.id);
    }
    const duplicateOk = isErrorResponse(duplicate, 409) && duplicate.json?.scimType === "uniqueness";
    record(
      "entra",
      "Entra: duplicate POST returns 409 uniqueness",
      'HTTP 409; application/scim+json; Error schema; status="409"; scimType=uniqueness',
      responseDetail(duplicate),
      duplicateOk,
    );

    const disabled = await request("PATCH", `Users/${encodeURIComponent(id)}`, {
      body: {
        schemas: [PATCH_SCHEMA],
        Operations: [{ op: "Replace", path: "active", value: "False" }],
      },
    });
    const disabledOk = disabled.status === 200
      && isScimContentType(disabled)
      && hasSchema(disabled.json, SCIM_USER_SCHEMA)
      && disabled.json?.active === false;
    record(
      "entra",
      'Entra: PATCH with capitalized Replace and string "False" deactivates',
      "HTTP 200; active=false",
      responseDetail(disabled),
      disabledOk,
    );

    const pathless = await request("PATCH", `Users/${encodeURIComponent(id)}`, {
      body: {
        schemas: [PATCH_SCHEMA],
        Operations: [{
          op: "Replace",
          value: {
            name: { givenName: "Conformance", familyName: "Entra" },
            displayName: "Entra Conformance Updated",
            title: "SCIM Validator",
            [ENTERPRISE_SCHEMA]: { department: "Ignored department", employeeNumber: "C-IGNORED" },
          },
        }],
      },
    });
    const pathlessOk = pathless.status === 200
      && isScimContentType(pathless)
      && pathless.json?.active === false
      && pathless.json?.displayName === "Entra Conformance Updated"
      && pathless.json?.name?.givenName === "Conformance"
      && pathless.json?.name?.familyName === "Entra"
      && pathless.json?.title === "SCIM Validator"
      && !(ENTERPRISE_SCHEMA in (pathless.json ?? {}));
    record(
      "entra",
      "Entra: path-less PATCH updates name/title and ignores unsupported enterprise attributes",
      "HTTP 200; displayName=Entra Conformance Updated; name=Conformance Entra; title=SCIM Validator; active remains false; enterprise extension absent",
      responseDetail(pathless),
      pathlessOk,
    );

    const emailPatched = await request("PATCH", `Users/${encodeURIComponent(id)}`, {
      body: {
        schemas: [PATCH_SCHEMA],
        Operations: [{
          op: "Replace",
          path: 'emails[type eq "work"].value',
          value: updatedEmail,
        }],
      },
    });
    const emailPatchedOk = emailPatched.status === 200
      && isScimContentType(emailPatched)
      && emailPatched.json?.userName === upn
      && isEmailValue(emailPatched.json, updatedEmail);
    record(
      "entra",
      'Entra: PATCH emails[type eq "work"].value updates the work email only',
      `HTTP 200; emails[work]=${updatedEmail}; userName remains ${upn}`,
      responseDetail(emailPatched),
      emailPatchedOk,
    );

    const unsupported = await request("PATCH", `Users/${encodeURIComponent(id)}`, {
      body: {
        schemas: [PATCH_SCHEMA],
        Operations: [{
          op: "Replace",
          path: `${ENTERPRISE_SCHEMA}.department`,
          value: "Ignored department",
        }],
      },
    });
    const unsupportedOk = unsupported.status === 200
      && isScimContentType(unsupported)
      && unsupported.json?.id === id
      && unsupported.json?.title === "SCIM Validator";
    record(
      "entra",
      "Entra: PATCH for an unsupported enterprise attribute succeeds",
      "HTTP 200; supported attributes are unchanged",
      responseDetail(unsupported),
      unsupportedOk,
    );

    const byExternal = await request("GET", withQuery("Users", {
      filter: `externalId eq "${externalId}"`,
    }));
    const byExternalOk = isListResponse(byExternal, { total: 1, startIndex: 1, items: 1 })
      && byExternal.json?.Resources?.[0]?.id === id;
    record(
      "entra",
      "Entra: filter by externalId finds the user",
      `HTTP 200; ListResponse; totalResults=1; Resources[0].id=${id}`,
      responseDetail(byExternal),
      byExternalOk,
    );

    const missing = await request("GET", `Users/${encodeURIComponent(`${local}-missing`)}`);
    const missingOk = isErrorResponse(missing, 404);
    record(
      "entra",
      "Entra: GET for an unknown id returns 404 with a SCIM error",
      'HTTP 404; application/scim+json; Error schema; status is the string "404"',
      responseDetail(missing),
      missingOk,
    );

    const deleted = await request("DELETE", `Users/${encodeURIComponent(id)}`);
    const afterDelete = await request("GET", `Users/${encodeURIComponent(id)}`);
    const deleteOk = deleted.status === 204
      && isScimContentType(deleted)
      && isErrorResponse(afterDelete, 404);
    record(
      "entra",
      "Entra: DELETE returns 204 and the id becomes 404 (no hard delete)",
      "HTTP 204; then HTTP 404 SCIM error (docs/scim.md 削除・無効化の扱い)",
      `${responseDetail(deleted)}; then ${responseDetail(afterDelete)}`,
      deleteOk,
    );

    const rebound = await request("POST", "Users", {
      body: {
        ...createPayload,
        externalId: reboundExternalId,
        emails: [{ value: updatedEmail, type: "work", primary: true }],
      },
    });
    const reboundId = rebound.status === 201 && typeof rebound.json?.id === "string"
      ? rebound.json.id
      : null;
    if (reboundId !== null) createdIds.add(reboundId);
    const reboundOk = rebound.status === 201
      && isScimContentType(rebound)
      && reboundId === id
      && rebound.json?.active === true
      && rebound.json?.externalId === reboundExternalId;
    record(
      "entra",
      "Entra: POST after DELETE restores the same account instead of hard deleting it",
      `HTTP 201; id=${id}; active=true; externalId=${reboundExternalId}`,
      responseDetail(rebound),
      reboundOk,
    );

    const finalDelete = await request("DELETE", `Users/${encodeURIComponent(id)}`);
    const finalGet = await request("GET", `Users/${encodeURIComponent(id)}`);
    const finalOk = finalDelete.status === 204
      && isScimContentType(finalDelete)
      && isErrorResponse(finalGet, 404);
    if (finalOk) finalizedIds.add(id);
    record(
      "entra",
      "Entra: final DELETE leaves the test user deactivated",
      "HTTP 204; then HTTP 404 SCIM error",
      `${responseDetail(finalDelete)}; then ${responseDetail(finalGet)}`,
      finalOk,
    );
  } finally {
    for (const id of createdIds) {
      if (finalizedIds.has(id)) continue;
      const cleanup = await request("DELETE", `Users/${encodeURIComponent(id)}`);
      if (cleanup.status === 204 || cleanup.status === 404) {
        finalizedIds.add(id);
      } else {
        record(
          "entra",
          `Entra: cleanup could not deactivate the test user (${id})`,
          "HTTP 204 or 404",
          responseDetail(cleanup),
          false,
        );
      }
    }
  }
}

async function runOktaProfile({ record, request, prefix }) {
  const local = `${prefix}-okta`;
  const email = oktaUserName(prefix);
  const externalId = `${local}-ext`;
  const createdIds = new Set();
  const userNames = new Map();
  const finalizedIds = new Set();

  const createPayload = {
    schemas: [SCIM_USER_SCHEMA],
    userName: email,
    externalId,
    name: { givenName: "Okta", familyName: "Conformance" },
    emails: [{ value: email, type: "work", primary: true }],
    title: "Okta Conformance",
    active: true,
  };

  try {
    const filtered = await request("GET", withQuery("Users", {
      filter: `userName eq "${email}"`,
      startIndex: 1,
      count: 100,
    }));
    const filteredOk = isListResponse(filtered, { total: 0, startIndex: 1, items: 0 });
    record(
      "okta",
      "Okta: filter by userName with startIndex and count returns an empty ListResponse",
      "HTTP 200; ListResponse; totalResults=0; startIndex=1; itemsPerPage=0; Resources=[]",
      responseDetail(filtered),
      filteredOk,
    );
    if (!filteredOk) return;

    const created = await request("POST", "Users", { body: createPayload });
    const id = created.status === 201 && typeof created.json?.id === "string" ? created.json.id : null;
    if (id !== null) {
      createdIds.add(id);
      userNames.set(id, email);
    }
    const createOk = created.status === 201
      && isScimContentType(created)
      && hasSchema(created.json, SCIM_USER_SCHEMA)
      && typeof created.json?.id === "string"
      && created.json.id !== ""
      && created.json.userName === email
      && created.json.externalId === externalId
      && created.json.active === true
      && created.json.displayName === "Okta Conformance"
      && created.json.name?.givenName === "Okta"
      && created.json.name?.familyName === "Conformance"
      && isEmailValue(created.json, email);
    record(
      "okta",
      "Okta: POST creates a user",
      `HTTP 201; User schema; userName=${email}; externalId=${externalId}; emails[work]=${email}; name=Okta Conformance; active=true`,
      responseDetail(created),
      createOk,
    );
    if (id === null) {
      record(
        "okta",
        "Okta: POST returned no user id, so dependent checks were skipped",
        "HTTP 201 with a string id",
        responseDetail(created),
        false,
      );
      return;
    }

    const fetched = await request("GET", `Users/${encodeURIComponent(id)}`);
    const getOk = fetched.status === 200
      && isScimContentType(fetched)
      && fetched.json?.id === id
      && fetched.json?.userName === email
      && fetched.json?.externalId === externalId
      && fetched.json?.active === true
      && isEmailValue(fetched.json, email);
    record(
      "okta",
      "Okta: GET by id returns the created user",
      `HTTP 200; id=${id}; userName=${email}; externalId=${externalId}; active=true`,
      responseDetail(fetched),
      getOk,
    );

    const updated = await request("PUT", `Users/${encodeURIComponent(id)}`, {
      body: {
        ...createPayload,
        name: { givenName: "Okta", familyName: "Updated" },
        title: "Okta Updated",
      },
    });
    const updatedOk = updated.status === 200
      && isScimContentType(updated)
      && updated.json?.id === id
      && updated.json?.displayName === "Okta Updated"
      && updated.json?.name?.givenName === "Okta"
      && updated.json?.name?.familyName === "Updated"
      && updated.json?.title === "Okta Updated"
      && updated.json?.active === true;
    record(
      "okta",
      "Okta: (AIW PUT) updates attributes",
      "HTTP 200; displayName=Okta Updated; name=Okta Updated; title=Okta Updated; active=true",
      responseDetail(updated),
      updatedOk,
    );

    const deactivated = await request("PUT", `Users/${encodeURIComponent(id)}`, {
      body: {
        ...createPayload,
        name: { givenName: "Okta", familyName: "Updated" },
        title: "Okta Deactivated",
        active: false,
      },
    });
    const deactivatedOk = deactivated.status === 200
      && isScimContentType(deactivated)
      && deactivated.json?.id === id
      && deactivated.json?.active === false
      && deactivated.json?.title === "Okta Deactivated";
    record(
      "okta",
      "Okta: (AIW PUT) with active=false deactivates",
      "HTTP 200; active=false; title=Okta Deactivated",
      responseDetail(deactivated),
      deactivatedOk,
    );

    const withoutActiveBody = {
      ...createPayload,
      name: { givenName: "Okta", familyName: "Updated" },
      title: "Okta Still Deactivated",
    };
    delete withoutActiveBody.active;
    const withoutActive = await request("PUT", `Users/${encodeURIComponent(id)}`, {
      body: withoutActiveBody,
    });
    const withoutActiveOk = withoutActive.status === 200
      && isScimContentType(withoutActive)
      && withoutActive.json?.active === false
      && withoutActive.json?.title === "Okta Still Deactivated";
    record(
      "okta",
      "Okta: (AIW PUT) without active keeps the user deactivated",
      "HTTP 200; active remains false; title=Okta Still Deactivated",
      responseDetail(withoutActive),
      withoutActiveOk,
    );

    const reactivated = await request("PUT", `Users/${encodeURIComponent(id)}`, {
      body: {
        ...createPayload,
        name: { givenName: "Okta", familyName: "Updated" },
        title: "Okta Reactivated",
        active: true,
      },
    });
    const reactivatedOk = reactivated.status === 200
      && isScimContentType(reactivated)
      && reactivated.json?.active === true
      && reactivated.json?.title === "Okta Reactivated";
    record(
      "okta",
      "Okta: (AIW PUT) with active=true reactivates the user",
      "HTTP 200; active=true; title=Okta Reactivated",
      responseDetail(reactivated),
      reactivatedOk,
    );

    // Okta's OIN guide sends activation changes as a path-less PATCH whose
    // value is an object. AIW integrations send the same state as a PUT above.
    const oinDeactivated = await request("PATCH", `Users/${encodeURIComponent(id)}`, {
      body: {
        schemas: [PATCH_SCHEMA],
        Operations: [{ op: "replace", value: { active: false } }],
      },
    });
    const oinDeactivatedGet = await request("GET", `Users/${encodeURIComponent(id)}`);
    const oinDeactivatedOk = oinDeactivated.status === 200
      && isScimContentType(oinDeactivated)
      && oinDeactivated.json?.active === false
      && oinDeactivatedGet.status === 200
      && isScimContentType(oinDeactivatedGet)
      && oinDeactivatedGet.json?.active === false;
    record(
      "okta",
      "Okta: (OIN PATCH) path-less replace with active=false deactivates",
      "HTTP 200; active=false; GET returns active=false",
      `${responseDetail(oinDeactivated)}; then ${responseDetail(oinDeactivatedGet)}`,
      oinDeactivatedOk,
    );

    const oinReactivated = await request("PATCH", `Users/${encodeURIComponent(id)}`, {
      body: {
        schemas: [PATCH_SCHEMA],
        Operations: [{ op: "replace", value: { active: true } }],
      },
    });
    const oinReactivatedGet = await request("GET", `Users/${encodeURIComponent(id)}`);
    const oinReactivatedOk = oinReactivated.status === 200
      && isScimContentType(oinReactivated)
      && oinReactivated.json?.active === true
      && oinReactivatedGet.status === 200
      && isScimContentType(oinReactivatedGet)
      && oinReactivatedGet.json?.active === true;
    record(
      "okta",
      "Okta: (OIN PATCH) path-less replace with active=true reactivates",
      "HTTP 200; active=true; GET returns active=true",
      `${responseDetail(oinReactivated)}; then ${responseDetail(oinReactivatedGet)}`,
      oinReactivatedOk,
    );

    const byExternal = await request("GET", withQuery("Users", {
      filter: `externalId eq "${externalId}"`,
    }));
    const byExternalOk = isListResponse(byExternal, { total: 1, startIndex: 1, items: 1 })
      && byExternal.json?.Resources?.[0]?.id === id;
    record(
      "okta",
      "Okta: filter by externalId finds the user",
      `HTTP 200; ListResponse; totalResults=1; Resources[0].id=${id}`,
      responseDetail(byExternal),
      byExternalOk,
    );

    const finalPut = await request("PUT", `Users/${encodeURIComponent(id)}`, {
      body: { schemas: [SCIM_USER_SCHEMA], userName: email, active: false },
    });
    const finalGet = await request("GET", `Users/${encodeURIComponent(id)}`);
    const finalOk = finalPut.status === 200
      && isScimContentType(finalPut)
      && finalPut.json?.active === false
      && finalGet.status === 200
      && isScimContentType(finalGet)
      && finalGet.json?.active === false;
    if (finalOk) finalizedIds.add(id);
    record(
      "okta",
      "Okta: (AIW PUT) final PUT leaves the test user deactivated",
      "HTTP 200 active=false; GET returns active=false",
      `${responseDetail(finalPut)}; then ${responseDetail(finalGet)}`,
      finalOk,
    );
  } finally {
    for (const id of createdIds) {
      if (finalizedIds.has(id)) continue;
      const cleanup = await request("PUT", `Users/${encodeURIComponent(id)}`, {
        body: {
          schemas: [SCIM_USER_SCHEMA],
          userName: userNames.get(id) ?? email,
          active: false,
        },
      });
      if (cleanup.status === 200 && cleanup.json?.active === false) {
        finalizedIds.add(id);
      } else {
        record(
          "okta",
          `Okta: cleanup could not deactivate the test user (${id})`,
          "HTTP 200 with active=false",
          responseDetail(cleanup),
          false,
        );
      }
    }
  }
}

/**
 * Run SCIM conformance checks that model the typical Entra ID or Okta traffic.
 *
 * @param {{
 *   baseUrl: string,
 *   token: string,
 *   profile?: "entra" | "okta" | "all",
 *   fetchImpl?: typeof fetch,
 *   prefix?: string,
 *   log?: (message: string) => void,
 *   allowHttp?: boolean,
 *   onPrefix?: (prefix: string) => void,
 * }} options
 * @returns {Promise<Array<{
 *   profile: string,
 *   name: string,
 *   expected: string,
 *   actual: string,
 *   ok: boolean,
 * }>>}
 */
export async function runConformance(options = {}) {
  const {
    baseUrl,
    token,
    profile = "all",
    fetchImpl = globalThis.fetch,
    prefix,
    log,
    allowHttp = false,
    onPrefix,
  } = options;

  if (typeof token !== "string" || token.trim() === "") {
    throw new ConformanceConfigError("token is required; set SCIM_TOKEN for the CLI");
  }
  if (!PROFILES.has(profile)) {
    throw new ConformanceConfigError("profile must be entra, okta or all");
  }
  if (typeof fetchImpl !== "function") {
    throw new ConformanceConfigError("fetchImpl must be a function");
  }

  const authToken = token.trim();
  const root = resolveRoot(baseUrl, allowHttp);
  const runPrefix = resolvePrefix(prefix);
  const results = [];
  if (typeof onPrefix === "function") {
    try {
      onPrefix(runPrefix);
    } catch {
      // Reporting the prefix must never change the conformance outcome.
    }
  }

  function emit(message) {
    if (typeof log !== "function") return;
    try {
      log(redact(message, authToken));
    } catch {
      // Logging must never change the conformance outcome.
    }
  }

  function record(profileName, name, expected, actual, ok) {
    results.push({
      profile: profileName,
      name: clip(redact(name, authToken), 200),
      expected: clip(redact(expected, authToken), 800),
      actual: clip(redact(actual, authToken), 800),
      ok: Boolean(ok),
    });
    emit(`${ok ? "PASS" : "FAIL"} ${profileName}: ${name}`);
  }

  async function request(method, path, requestOptions = {}) {
    const tokenValue = requestOptions.tokenValue === undefined ? authToken : requestOptions.tokenValue;
    const url = `${root}/${path.replace(/^\/+/, "")}`;
    const headers = { Accept: SCIM_CONTENT_TYPE };
    if (tokenValue) headers.Authorization = `Bearer ${tokenValue}`;
    let body;
    const init = { method, headers, redirect: "manual" };
    if (requestOptions.body !== undefined) {
      headers["Content-Type"] = SCIM_CONTENT_TYPE;
      body = JSON.stringify(requestOptions.body);
      init.body = body;
    }
    emit(`${method} ${url}`);
    try {
      const response = await fetchImpl(url, init);
      let text = "";
      try {
        text = typeof response?.text === "function" ? await response.text() : "";
      } catch {
        text = "";
      }
      let json = null;
      if (typeof text === "string" && text.trim() !== "") {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }
      return {
        status: Number(response?.status ?? 0),
        headers: response?.headers ?? null,
        text: typeof text === "string" ? text : "",
        json,
        error: null,
      };
    } catch (error) {
      return {
        status: 0,
        headers: null,
        text: "",
        json: null,
        error: redact(error instanceof Error ? error.message : String(error), authToken),
      };
    }
  }

  emit(`SCIM conformance: profile=${profile} prefix=${runPrefix} root=${root}`);
  await runCommonChecks({ record, request, authToken });
  const profiles = profile === "all" ? ["entra", "okta"] : [profile];
  for (const profileName of profiles) {
    if (profileName === "entra") {
      await runEntraProfile({ record, request, prefix: runPrefix });
    } else {
      await runOktaProfile({ record, request, prefix: runPrefix });
    }
  }
  return results;
}

function truncateCell(value, width) {
  const text = String(value ?? "").replace(/\s+/g, " ");
  return text.length <= width ? text.padEnd(width) : `${text.slice(0, Math.max(0, width - 3))}...`;
}

function printResults(results, { prefix = "", profile = "all" } = {}) {
  if (prefix) {
    console.log(`Test user prefix: ${prefix}`);
    console.log("Test users left deactivated:");
    if (profile === "entra" || profile === "all") {
      console.log(`  Entra UPN: ${entraUpn(prefix)}`);
    }
    if (profile === "okta" || profile === "all") {
      console.log(`  Okta userName: ${oktaUserName(prefix)}`);
    }
    console.log("");
  }
  const nameWidth = Math.min(
    76,
    Math.max(5, ...results.map((row) => String(row.name).length)),
  );
  const profileWidth = 7;
  const resultWidth = 6;
  console.log(
    `${"PROFILE".padEnd(profileWidth)}  ${"RESULT".padEnd(resultWidth)}  ${"CHECK".padEnd(nameWidth)}`,
  );
  console.log(`${"-".repeat(profileWidth)}  ${"-".repeat(resultWidth)}  ${"-".repeat(nameWidth)}`);
  for (const row of results) {
    console.log(
      `${truncateCell(row.profile, profileWidth)}  ${truncateCell(row.ok ? "PASS" : "FAIL", resultWidth)}  ${truncateCell(row.name, nameWidth)}`,
    );
  }

  const failures = results.filter((row) => !row.ok);
  if (failures.length > 0) {
    console.log("");
    console.log("Failure details:");
    for (const row of failures) {
      console.log(`- ${row.profile}: ${row.name}`);
      console.log(`  expected: ${row.expected}`);
      console.log(`  actual:   ${row.actual}`);
    }
  }

  console.log("");
  console.log("Summary:");
  for (const profileName of [...new Set(results.map((row) => row.profile))]) {
    const rows = results.filter((row) => row.profile === profileName);
    const passed = rows.filter((row) => row.ok).length;
    console.log(`  ${profileName}: ${passed} passed, ${rows.length - passed} failed`);
  }
  const passed = results.filter((row) => row.ok).length;
  console.log(`  total: ${passed} passed, ${results.length - passed} failed`);
  if (failures.length > 0) console.log(`  failed checks: ${failures.length}`);
}

function printHelp() {
  console.log(`Usage:
  node scripts/scim-conformance.mjs --base <url> [options]

Options:
  --base <url>          Atlas origin (https://host) or SCIM root (https://host/scim/v2)
  --profile <name>      entra, okta or all (default: all)
  --prefix <text>       Test user prefix (default: scim-conformance-<random>)
  --allow-http          Allow http:// only for localhost, 127.0.0.1 or [::1]
  -h, --help            Show this help

Environment:
  SCIM_TOKEN            Atlas SCIM bearer token. It is read only from this
                        variable; --token is intentionally not accepted.

The checker creates users whose userName and email start with the prefix. Atlas
does not hard-delete accounts from SCIM, so the checker leaves them deactivated.
Run it against a disposable workspace or remove the prefixed test users from
member management afterwards.`);
}

function parseArgs(argv) {
  const options = { profile: "all", allowHttp: false };
  function valueAt(index, label) {
    const value = argv[index];
    if (value === undefined || value.startsWith("--")) {
      throw new ConformanceConfigError(`${label} requires a value`);
    }
    return value;
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--allow-http") {
      options.allowHttp = true;
      continue;
    }
    if (argument === "--base") {
      options.baseUrl = valueAt(index + 1, "--base");
      index += 1;
      continue;
    }
    if (argument.startsWith("--base=")) {
      options.baseUrl = argument.slice("--base=".length);
      continue;
    }
    if (argument === "--profile") {
      options.profile = valueAt(index + 1, "--profile");
      index += 1;
      continue;
    }
    if (argument.startsWith("--profile=")) {
      options.profile = argument.slice("--profile=".length);
      continue;
    }
    if (argument === "--prefix") {
      options.prefix = valueAt(index + 1, "--prefix");
      index += 1;
      continue;
    }
    if (argument.startsWith("--prefix=")) {
      options.prefix = argument.slice("--prefix=".length);
      continue;
    }
    if (argument === "--token" || argument.startsWith("--token=")) {
      throw new ConformanceConfigError("tokens are read only from the SCIM_TOKEN environment variable; --token is not accepted");
    }
    throw new ConformanceConfigError(`unknown option: ${argument}`);
  }
  if (!options.baseUrl) throw new ConformanceConfigError("--base is required");
  return options;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(redact(error instanceof Error ? error.message : String(error), process.env.SCIM_TOKEN));
    console.error("Run with --help for usage.");
    return 2;
  }
  if (options.help) {
    printHelp();
    return 0;
  }
  const token = process.env.SCIM_TOKEN;
  if (typeof token !== "string" || token.trim() === "") {
    console.error("SCIM_TOKEN is required. Export the token in the environment; do not pass it as an argument.");
    return 2;
  }
  let runPrefix = "";
  try {
    const results = await runConformance({
      baseUrl: options.baseUrl,
      token,
      profile: options.profile,
      prefix: options.prefix,
      allowHttp: options.allowHttp,
      onPrefix: (value) => { runPrefix = value; },
    });
    printResults(results, { prefix: runPrefix, profile: options.profile });
    return results.some((row) => !row.ok) ? 1 : 0;
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error), token);
    console.error(`SCIM conformance failed: ${message}`);
    // Test users may already exist, so still say which prefix to clean up.
    if (runPrefix) console.error(`Test user prefix: ${runPrefix}`);
    if (error instanceof ConformanceConfigError) {
      console.error("Run with --help for usage.");
      return 2;
    }
    return 1;
  }
}

const isMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`SCIM conformance failed: ${redact(error instanceof Error ? error.message : String(error), process.env.SCIM_TOKEN)}`);
    process.exitCode = 1;
  });
}
