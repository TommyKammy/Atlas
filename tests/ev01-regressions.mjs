import assert from "node:assert/strict";
import { before, test } from "node:test";
import { db, fixtures, http, request, session, task, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);
const definition = { version: 1, triggers: [{ event: "task.manual_rule" }], actions: [{ capability: "task.add_comment", params: { body: "Policy action" } }] };

test("EV01 admins-only configuration protects all rule operations and structural mutations while task edits remain available", { timeout: 30_000 }, async () => {
  const { a, owner, ownerId, editor } = await fixtures("EV01 configure");
  const p = `/api/projects/${a}`;
  const rule = await request(editor, "POST", `${p}/rules`, 201, { name: "Editor owned", definition });
  const draft = (await request(editor, "POST", `${p}/rules/drafts`, 201, {})).draft;
  const section = await request(owner, "POST", "/api/sections", 201, { project_id: a, name: "Configuration section" });
  const field = await request(owner, "POST", "/api/custom-fields", 201, { project_id: a, name: "Definition", field_type: "text" });
  const tab = await request(owner, "POST", "/api/project-tabs", 201, { project_id: a, name: "Extra", view_type: "list" });
  const template = await request(owner, "POST", "/api/task-templates", 201, { project_id: a, name: "Task template", title_template: "Allowed task creation" });
  const form = await request(owner, "POST", "/api/forms", 201, { project_id: a, name: "Intake", fields: [{ key: "title", label: "Title", type: "text", required: true, options: [] }] });
  const legacy = await request(owner, "POST", `${p}/automations`, 201, { name: "Legacy", trigger: "task_completed", action_type: "add_comment", action_value: "Legacy policy" });
  const endpoint = (await request(owner, "POST", `${p}/webhook-endpoints`, 201, { name: "Policy endpoint", secret: "test-only-policy-secret" })).endpoint;
  const app = (await db.query("INSERT INTO project_apps (project_id, app_key, config, created_by) VALUES ($1, 'slack', '{}'::jsonb, $2) RETURNING id", [a, ownerId])).rows[0];
  const widget = (await db.query("INSERT INTO project_dashboard_widgets (project_id, title) VALUES ($1, 'Policy metric') RETURNING id", [a])).rows[0];
  const bundle = (await db.query("INSERT INTO bundles (workspace_id, name, fields, rules) VALUES (1, 'Policy bundle', '[]'::jsonb, '[]'::jsonb) RETURNING id")).rows[0];
  const t = await task(a, "Content remains editable");
  await request(owner, "PATCH", p, 200, { settings: { who_can_edit: "admins" } });
  const denied = [
    ["POST", `${p}/rules`, { name: "Forbidden", definition }],
    ["PATCH", `${p}/rules/${rule.id}`, { enabled: false }], ["DELETE", `${p}/rules/${rule.id}`],
    ["POST", `${p}/rules/${rule.id}/run`, { task_id: t }],
    ["POST", `${p}/rules/preview`, { definition, task_id: t }], ["POST", `${p}/rules/ai-suggest`, {}],
    ["GET", `${p}/rules/options`], ["GET", `${p}/rules/drafts`], ["POST", `${p}/rules/drafts`, {}],
    ["GET", `${p}/rules/drafts/${draft.id}`], ["PUT", `${p}/rules/drafts/${draft.id}`, { expected_revision: draft.revision, name: "Forbidden" }],
    ["DELETE", `${p}/rules/drafts/${draft.id}`, { expected_revision: draft.revision }],
    ["POST", `${p}/rules/drafts/${draft.id}/publish`, { expected_revision: draft.revision }],
    ["PATCH", `${p}/automations/${legacy.id}`, { enabled: false }], ["DELETE", `${p}/automations/${legacy.id}`],
    ["DELETE", `${p}/webhook-endpoints/${endpoint.id}`],
    ["PATCH", `${p}/apps/${app.id}`, { enabled: false }], ["DELETE", `${p}/apps/${app.id}`],
    ["PATCH", `${p}/dashboard/widgets/${widget.id}`, { title: "Forbidden" }], ["DELETE", `${p}/dashboard/widgets/${widget.id}`],
    ["POST", `/api/bundles/${bundle.id}/apply`, { project_id: a }],
    ["POST", `/api/custom-fields/${field.id}/restore`, {}],
    ["POST", `${p}/automations`, {}], ["POST", `${p}/webhook-endpoints`, {}], ["POST", `${p}/apps`, {}],
    ["PATCH", `${p}/email`, { enabled: false }], ["POST", `${p}/status-updates`, {}],
    ["PATCH", p, { color: "#ef4444" }], ["PATCH", p, { status: "At risk" }],
    ["POST", `${p}/dashboard/widgets`, {}], ["PATCH", `${p}/dashboard/widgets`, { order: [] }],
    ["POST", "/api/sections", { project_id: a, name: "Forbidden" }],
    ["PATCH", `/api/sections/${section.id}`, { name: "Forbidden" }], ["DELETE", `/api/sections/${section.id}`],
    ["POST", "/api/sections/reorder", { project_id: a, order: [section.id] }],
    ["POST", "/api/custom-fields", { project_id: a, name: "Forbidden", field_type: "text" }],
    ["PATCH", `/api/custom-fields/${field.id}`, { name: "Forbidden" }], ["DELETE", `/api/custom-fields/${field.id}`],
    ["POST", "/api/project-tabs", { project_id: a, name: "Forbidden", view_type: "list" }],
    ["PATCH", `/api/project-tabs/${tab.id}`, { name: "Forbidden" }], ["DELETE", `/api/project-tabs/${tab.id}`],
    ["POST", "/api/project-tabs/reorder", { project_id: a, order: [tab.id] }],
    ["POST", "/api/forms", { project_id: a }], ["PATCH", `/api/forms/${form.id}`, { name: "Forbidden" }], ["DELETE", `/api/forms/${form.id}`],
    ["POST", "/api/task-templates", { project_id: a }], ["PATCH", `/api/task-templates/${template.id}`, { name: "Forbidden" }], ["DELETE", `/api/task-templates/${template.id}`],
  ];
  for (const [method, path, body] of denied) await request(editor, method, path, 403, body);
  const endpoints = await request(editor, "GET", `${p}/webhook-endpoints`, 200);
  assert.equal(JSON.stringify(endpoints).includes(endpoint.token), false);
  await request(editor, "PATCH", `/api/tasks/${t}`, 200, { name: "Content edited" });
  await request(editor, "POST", "/api/comments", 201, { task_id: t, body: "Business comments remain editable" });
  await request(editor, "POST", `/api/task-templates/${template.id}`, 201, {});
  await request(owner, "PATCH", `/api/forms/${form.id}`, 200, { published: true });
  await request(editor, "POST", `/api/forms/${form.id}/submit`, 201, { answers: { title: "Submitted task" } });
  await request(owner, "PATCH", p, 200, { color: "#3b82f6" });
  const globalAdmin = (await db.query("SELECT id FROM users WHERE is_admin AND deactivated_at IS NULL ORDER BY id LIMIT 1")).rows[0];
  await request(await session(globalAdmin.id), "PATCH", p, 200, { color: "#22c55e" });
  await request(owner, "PATCH", p, 200, { settings: { who_can_edit: "editors" } });
  await request(editor, "PATCH", p, 200, { color: "#a855f7" });
  await request(editor, "POST", "/api/sections", 201, { project_id: a, name: "Editors may configure again" });
  assert.equal((await db.query("SELECT name FROM tasks WHERE id = $1", [t])).rows[0].name, "Content edited");
});

test("EV01 editor sharing delegates member and public-link operations without privilege escalation", { timeout: 20_000 }, async () => {
  const { a, owner, ownerId, editor, editorId } = await fixtures("EV01 sharing");
  const p = `/api/projects/${a}`;
  const target = (await db.query("INSERT INTO users (name) VALUES ('EV01 invited') RETURNING id")).rows[0].id;
  await request(editor, "POST", `${p}/members`, 403, { user_id: target, role: "viewer" });
  await request(editor, "GET", `${p}/share`, 403);
  await request(owner, "PATCH", p, 200, { settings: { who_can_share: "editors" } });
  const members = await request(editor, "GET", `${p}/members`, 200);
  assert.equal(members.can_manage, true); assert.equal(members.can_manage_admins, false);
  await request(editor, "POST", `${p}/members`, 201, { user_id: target, role: "viewer" });
  await request(editor, "PATCH", `${p}/members/${target}`, 200, { role: "commenter" });
  const link = await request(editor, "POST", `${p}/share`, 201, { label: "Delegated read-only link" });
  await request(editor, "GET", `${p}/share`, 200);
  await request(editor, "DELETE", `${p}/share?token_id=${link.id}`, 200);
  for (const [uid, role] of [[target, "admin"], [ownerId, "viewer"], [editorId, "viewer"]]) {
    await request(editor, "POST", `${p}/members`, 403, { user_id: uid, role });
    await request(editor, "PATCH", `${p}/members/${uid}`, 403, { role });
  }
  for (const uid of [ownerId, editorId]) await request(editor, "DELETE", `${p}/members/${uid}`, 403);
  const globalAdmin = (await db.query("SELECT id FROM users WHERE is_admin AND deactivated_at IS NULL ORDER BY id LIMIT 1")).rows[0];
  await request(editor, "POST", `${p}/members`, 403, { user_id: globalAdmin.id, role: "viewer" });
  for (const body of [{ settings: { who_can_share: "admins" } }, { owner_id: editorId }, { archived: true }, { team_id: null }, { color: "#3b82f6", settings: {} }]) await request(editor, "PATCH", p, 403, body);
  await request(editor, "DELETE", `${p}/members/${target}`, 200);
  // Upsert must not bypass last-admin protection, including under concurrent requests.
  await request(owner, "POST", `${p}/members`, 400, { user_id: ownerId, role: "viewer" });
  await request(owner, "POST", `${p}/members`, 201, { user_id: editorId, role: "admin" });
  const outcomes = await Promise.all([
    http(`${p}/members/${ownerId}`, { cookie: owner, method: "PATCH", json: { role: "editor" } }),
    http(`${p}/members/${editorId}`, { cookie: owner, method: "DELETE" }),
  ]);
  const statuses = outcomes.map((response) => response.status).sort();
  await Promise.all(outcomes.map((response) => response.body?.cancel()));
  assert.ok(statuses.includes(200));
  assert.ok(statuses.includes(400) || statuses.includes(403));
  assert.equal((await db.query("SELECT count(*)::int AS n FROM project_members WHERE project_id = $1 AND role = 'admin'", [a])).rows[0].n, 1);
});

test("EV01 portfolio propagation cannot bypass locked project workflows", { timeout: 20_000 }, async () => {
  const { a, owner, editor } = await fixtures("EV01 portfolio");
  const portfolio = await request(editor, "POST", "/api/portfolios", 201, { name: "Editor portfolio" });
  await request(editor, "POST", `/api/portfolios/${portfolio.id}/projects`, 201, { project_id: a });
  const rule = await request(editor, "POST", `/api/portfolios/${portfolio.id}/rules`, 201, { name: "Propagated", definition });
  await request(owner, "PATCH", `/api/projects/${a}`, 200, { settings: { who_can_edit: "admins" } });
  await request(editor, "POST", `/api/portfolios/${portfolio.id}/rules`, 403, { name: "Forbidden new", definition });
  await request(editor, "PATCH", `/api/portfolios/${portfolio.id}/rules/${rule.id}`, 403, { name: "Forbidden update" });
  await request(editor, "DELETE", `/api/portfolios/${portfolio.id}/rules/${rule.id}`, 403);
  await request(editor, "DELETE", `/api/portfolios/${portfolio.id}/projects?project_id=${a}`, 403);
  await request(editor, "DELETE", `/api/portfolios/${portfolio.id}`, 403);
  assert.equal((await db.query("SELECT name FROM project_rules WHERE portfolio_rule_id = $1 AND project_id = $2", [rule.id, a])).rows[0].name, "Propagated");
});
