import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRuleDefinition } from "./automation/validate";

test("non-task triggers require a fixed task target in flat and branched actions", () => {
  const project = { event: "project.status_changed" };
  const task = { event: "task.created" };
  const webhook = { event: "webhook.received" };
  const complete = (params: Record<string, unknown> = {}) => ({ capability: "task.complete", params });

  for (const triggers of [[project], [webhook], [task, project]]) {
    for (const task_id of [undefined, true, 0, 1.5, [], "{{event.data.task_id}}", "1e2", Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = validateRuleDefinition({ triggers, actions: [complete({ task_id })] });
      assert.deepEqual(invalid, { ok: false, error: "task.complete requires task triggers or a fixed task_id" });
    }
  }

  const branch = (task_id?: unknown) => ({
    name: "Branch", conditions: [], actions: [complete({ task_id })],
  });
  assert.equal(validateRuleDefinition({ triggers: [webhook], branches: [branch()] }).ok, false);
  const fixed = validateRuleDefinition({ triggers: [task, webhook], branches: [branch("123")] });
  assert.equal(fixed.ok, true);
  if (fixed.ok) assert.equal(fixed.definition.branches?.[0].actions[0].params.task_id, 123);
});

test("task events and non-task actions keep their valid combinations", () => {
  assert.equal(validateRuleDefinition({
    triggers: [{ event: "comment.updated" }, { event: "form.submitted" }],
    actions: [{ capability: "task.complete", params: {} }],
  }).ok, true);
  assert.equal(validateRuleDefinition({
    triggers: [{ event: "project.status_changed" }, { event: "webhook.received" }],
    actions: [
      { capability: "task.create", params: { name: "Follow-up", project_id: 12 } },
      { capability: "project.set_status", params: { status: "順調", project_id: 12 } },
      { capability: "webhook.post", params: { url: "https://example.com/hook" } },
    ],
  }).ok, true);
});

test("validateRuleDefinition accepts multiple triggers and actions", () => {
  const result = validateRuleDefinition({
    version: 1,
    triggers: [{ event: "task.created" }, { event: "task.completed" }],
    conditions: [{ field: "task.status", op: "eq", value: "進行中" }],
    actions: [
      { capability: "task.set_status", params: { status: "完了" } },
      { capability: "task.add_comment", params: { body: "done" } },
    ],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.definition.triggers.length, 2);
    assert.equal(result.definition.actions?.length, 2);
    assert.equal(result.definition.version, 1);
  }
});

test("validateRuleDefinition enforces required structure and limits", () => {
  assert.equal(validateRuleDefinition({ triggers: [], actions: [] }).ok, false);
  assert.equal(
    validateRuleDefinition({
      triggers: [{ event: "task.created" }],
      actions: [{ capability: "unknown.capability", params: {} }],
    }).ok,
    false,
  );
  const tooMany = Array.from({ length: 21 }, () => ({ event: "task.created" as const }));
  assert.equal(
    validateRuleDefinition({
      triggers: tooMany,
      actions: [{ capability: "task.complete", params: {} }],
    }).ok,
    false,
  );
  assert.equal(
    validateRuleDefinition({
      triggers: [{ event: "task.created" }],
      actions: [{ capability: "task.complete", params: {} }],
      conditions: [{ field: "task.name", op: "bogus" as never, value: "x" }],
    }).ok,
    false,
  );
});

test("validateRuleDefinition rejects missing required action parameters", () => {
  const result = validateRuleDefinition({
    triggers: [{ event: "task.created" }],
    actions: [{ capability: "task.add_comment", params: { body: "" } }],
  });
  assert.equal(result.ok, false);
});

test("validateRuleDefinition supports branches and else paths", () => {
  const result = validateRuleDefinition({
    version: 1,
    triggers: [{ event: "task.created" }],
    branches: [
      {
        name: "high",
        conditions: [{ field: "task.name", op: "contains", value: "urgent" }],
        actions: [{ capability: "task.assign", params: { user_id: 1 } }],
      },
      {
        name: "fallback",
        else: true,
        conditions: [],
        actions: [{ capability: "task.add_comment", params: { body: "fallback" } }],
      },
    ],
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.definition.branches?.length, 2);
});

test("validateRuleDefinition accepts milestone trigger and condition", () => {
  const result = validateRuleDefinition({
    version: 1,
    triggers: [{ event: "task.milestone_changed" }],
    conditions: [{ field: "task.is_milestone", op: "eq", value: "true" }],
    actions: [{ capability: "task.add_comment", params: { body: "milestone" } }],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.definition.triggers[0].event, "task.milestone_changed");
    assert.equal(result.definition.conditions?.[0].field, "task.is_milestone");
  }
});

test("validateRuleDefinition accepts scheduled date triggers", () => {
  const result = validateRuleDefinition({
    version: 1,
    triggers: [{ event: "task.overdue", days: 2 }],
    actions: [{ capability: "task.add_comment", params: { body: "overdue" } }],
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.definition.triggers[0].days, 2);
});

test("present malformed arrays, branch flags and parameter objects never become defaults", () => {
  const valid = { triggers: [{ event: "task.created" }], actions: [{ capability: "task.complete", params: {} }] };
  for (const key of ["triggers", "conditions", "actions", "branches"]) {
    for (const value of [null, {}, "", false, 1]) {
      assert.equal(validateRuleDefinition({ ...valid, [key]: value }).ok, false, `${key}: ${JSON.stringify(value)}`);
    }
  }
  for (const conditions of [null, {}, false]) {
    assert.equal(validateRuleDefinition({ ...valid, branches: [{ conditions, actions: valid.actions }] }).ok, false);
  }
  for (const actions of [null, {}, false]) {
    assert.equal(validateRuleDefinition({ ...valid, branches: [{ conditions: [], actions }] }).ok, false);
  }
  for (const otherwise of ["false", 0, null, {}]) {
    assert.equal(validateRuleDefinition({ ...valid, branches: [{ conditions: [], actions: valid.actions, else: otherwise }] }).ok, false);
  }
  for (const params of [null, [], "invalid", false]) {
    assert.equal(validateRuleDefinition({ ...valid, actions: [{ capability: "task.complete", params }] }).ok, false);
  }
  assert.equal(validateRuleDefinition({ ...valid, version: 2 }).ok, false);
  assert.equal(validateRuleDefinition({ ...valid, branches: [null] }).ok, false);
  assert.equal(validateRuleDefinition({ ...valid, conditions: [null] }).ok, false);
  assert.equal(validateRuleDefinition(valid).ok, true, "omitted optional arrays stay compatible");
});

test("conditions require known snapshot fields and compatible operators and values", () => {
  const definition = (condition: unknown) => ({
    triggers: [{ event: "task.created" }], conditions: [condition],
    actions: [{ capability: "task.complete" }],
  });
  for (const condition of [
    { field: "task.typo", op: "eq", value: "x" },
    { field: "arbitrary", op: "is_empty" },
    { field: "task.name", op: "gt", value: "a" },
    { field: "task.completed", op: "contains", value: "true" },
    { field: "task.completed", op: "eq", value: "sometimes" },
    { field: "task.progress", op: "gt", value: "not numeric" },
    { field: "task.progress", op: "eq", value: true },
    { field: "task.name", op: "eq", value: {} },
    { field: "task.name", op: "eq" },
    { field: "task.due_on", op: "gte", value: "2026-02-30" },
    { field: "task.due_on", op: "eq", value: "0000-01-01" },
    { field: "task.updated_at", op: "gte", value: "2026-02-30T00:00:00Z" },
    { field: "task.assignee_id", op: "in", value: [1, {}] },
  ]) assert.equal(validateRuleDefinition(definition(condition)).ok, false, JSON.stringify(condition));
  for (const condition of [
    { field: "task.created_by", op: "eq", value: "12" },
    { field: "task.assignee_id", op: "is_empty" },
    { field: "task.description", op: "contains", value: "review" },
    { field: "task.completed", op: "eq", value: "false" },
    { field: "task.progress", op: "gte", value: "12.5" },
    { field: "task.due_on", op: "gte", value: "2026-02-28" },
    { field: "task.updated_at", op: "gte", value: "2026-01-01T00:00:00Z" },
    { field: "project.owner_id", op: "is_empty" },
    { field: "event.data.external.status", op: "eq", value: "approved" },
    { field: "custom.Legacy field name", op: "contains", value: "label" },
  ]) assert.equal(validateRuleDefinition(definition(condition)).ok, true, JSON.stringify(condition));
});

test("date trigger defaults preserve explicit zero and reject wrong day types", () => {
  const make = (trigger: unknown) => validateRuleDefinition({ triggers: [trigger], actions: [{ capability: "task.complete" }] });
  for (const [event, expected] of [["task.due_soon", 1], ["task.overdue", 0]] as const) {
    const result = make({ event });
    assert.ok(result.ok);
    assert.equal(result.definition.triggers[0].days, expected);
  }
  const explicit = make({ event: "task.due_soon", days: 0 });
  assert.ok(explicit.ok);
  assert.equal(explicit.definition.triggers[0].days, 0);
  for (const days of [null, true, "1", 1.5, -1, 366]) assert.equal(make({ event: "task.due_soon", days }).ok, false);
});
