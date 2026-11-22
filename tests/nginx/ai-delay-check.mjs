#!/usr/bin/env node
// Exercises both AI locations in deploy/nginx/atlas.conf through NGINX.
// The admin connection test is fast and doubles as a readiness wait for
// llm-mock. The knowledge request uses the fixture's 65s delay, which must
// survive NGINX's normal 60s proxy_read_timeout.
import { randomUUID } from "node:crypto";

const base = process.env.ATLAS_E2E_BASE;
if (!base) throw new Error("ATLAS_E2E_BASE is required");

let cookie = "";
let projectId = null;
let exitCode = 0;

async function request(method, path, body, timeout = 30_000) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  let json = null;
  if (text.trim() !== "") {
    try { json = JSON.parse(text); } catch { /* keep text for diagnostics */ }
  }
  return { status: response.status, headers: response.headers, text, json };
}

function need(response, status, label) {
  if (response.status !== status) {
    throw new Error(`${label}: HTTP ${response.status}: ${response.text.slice(0, 400)}`);
  }
  return response.json;
}

function sessionCookie(headers) {
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie") ?? ""];
  const match = values
    .map((value) => /(?:^|;\s*)atlas_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(value))
    .find(Boolean);
  if (!match) throw new Error("login did not set atlas_session");
  return `atlas_session=${match[1]}`;
}

try {
  const login = await request("POST", "/api/auth/login", {
    email: "admin@example.com",
    password: "atlas-dev-2026",
  });
  if (login.status !== 200) throw new Error(`login: HTTP ${login.status}: ${login.text.slice(0, 300)}`);
  cookie = sessionCookie(login.headers);

  const project = need(await request("POST", "/api/projects", {
    workspace_id: 1,
    name: `nginx-ai-${Date.now()}`,
  }), 201, "create project");
  projectId = project.id;

  const note = need(await request("POST", "/api/knowledge", {
    project_id: projectId,
    title: "NGINX AI delay",
    body: "明日はチームで計画を確認します。担当者と期限を決めます。",
  }), 201, "create note");

  const connectionPayload = {
    name: `NGINX AI ${projectId}`,
    provider: "compatible",
    base_url: "http://llm-mock:8080/v1",
    model: "fixture",
    enabled: true,
    external_allowed: false,
    project_ids: [projectId],
    max_input_chars: 20000,
    max_output_tokens: 2048,
    timeout_seconds: 120,
    daily_limit: 1000,
  };
  let connection = need(await request("POST", "/api/admin/llm", connectionPayload), 200, "create llm connection");

  // Wait up to 30s for llm-mock to accept connections. A 502 means the mock
  // is not ready yet; any other failure is a configuration problem.
  let adminCheck = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    adminCheck = await request("POST", `/api/admin/llm/${connection.id}/test`, {});
    if (adminCheck.status !== 502) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const adminBody = need(adminCheck, 200, "admin LLM connection test");
  if (!Array.isArray(adminBody.models) || !adminBody.models.includes("fixture")) {
    throw new Error("admin LLM connection test did not return the fixture model");
  }
  console.log("ok   admin LLM connection test through NGINX");

  // The project partner route uses completeLlm with the same connection
  // timeout. Exercise it with the fast fixture model; its 200s read timeout is
  // checked from nginx -T.
  const partner = need(await request("POST", `/api/projects/${projectId}/partner`, {
    skill: "action_extract",
    request_id: randomUUID(),
    note_id: note.id,
    expected_revision: note.revision,
  }), 200, "project partner through NGINX");
  if (typeof partner.summary !== "string" || !Array.isArray(partner.actions)) {
    throw new Error("project partner response is missing summary or actions");
  }
  console.log("ok   project partner through NGINX");

  connection = need(await request("POST", "/api/admin/llm", {
    ...connectionPayload,
    id: connection.id,
    revision: connection.revision,
    model: "delay-65",
  }), 200, "switch the connection to delay-65");

  // Run both AI locations concurrently so the suite pays the 65s delay only
  // once. The admin test does not reserve an llm_runs row, so the knowledge
  // generation's one-active-run rule is unaffected.
  const timed = async (promise) => {
    const started = Date.now();
    const response = await promise;
    return { response, elapsed: Date.now() - started };
  };
  const [adminDelayed, aiDelayed] = await Promise.all([
    timed(request("POST", `/api/admin/llm/${connection.id}/test`, {}, 210_000)),
    timed(request("POST", `/api/knowledge/${note.id}/ai`, {
      connection_id: connection.id,
      expected_revision: note.revision,
      operation: "summary",
      request_id: randomUUID(),
    }, 210_000)),
  ]);

  const adminDelayedBody = need(adminDelayed.response, 200, "delayed admin LLM connection test");
  if (adminDelayed.elapsed < 60_000) {
    throw new Error(`admin LLM test completed in ${adminDelayed.elapsed}ms; expected the fixture's 65s delay`);
  }
  if (!Array.isArray(adminDelayedBody.models) || !adminDelayedBody.models.includes("fixture")) {
    throw new Error("delayed admin LLM test did not return the fixture model");
  }
  console.log(`ok   delayed admin LLM connection test through NGINX (${(adminDelayed.elapsed / 1000).toFixed(1)}s, HTTP 200)`);

  const aiBody = need(aiDelayed.response, 200, "delayed knowledge AI");
  if (aiDelayed.elapsed < 60_000) {
    throw new Error(`knowledge AI completed in ${aiDelayed.elapsed}ms; expected the fixture's 65s delay`);
  }
  if (typeof aiBody.text !== "string" || !aiBody.text.includes("要約")) {
    throw new Error("delayed AI response did not contain the expected summary");
  }
  console.log(`ok   delayed knowledge AI through NGINX (${(aiDelayed.elapsed / 1000).toFixed(1)}s, HTTP 200)`);
} catch (error) {
  console.error(`FAIL delayed AI check: ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  if (projectId !== null && cookie !== "") {
    try {
      const response = await request("DELETE", `/api/projects/${projectId}`);
      if (response.status !== 200) {
        console.error(`FAIL delayed AI cleanup: project delete HTTP ${response.status}: ${response.text.slice(0, 300)}`);
        exitCode = 1;
      }
    } catch (error) {
      console.error(`FAIL delayed AI cleanup: ${error instanceof Error ? error.message : String(error)}`);
      exitCode = 1;
    }
  }
  process.exitCode = exitCode;
}
