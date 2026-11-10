import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { db, fixtures, http, request, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);

const definition = (name = "Draft effect") => ({
  version: 1, triggers: [{ event: "task.created" }],
  actions: [{ capability: "task.create", params: { name } }],
});
const draftBase = (project) => `/api/projects/${project}/rules/drafts`;

async function newDraft(cookie, project, ruleId) {
  return (await request(cookie, "POST", draftBase(project), 201, ruleId === undefined ? {} : { rule_id: ruleId })).draft;
}

async function save(cookie, project, draft, patch) {
  return (await request(cookie, "PUT", `${draftBase(project)}/${draft.id}`, 200, {
    expected_revision: draft.revision, ...patch,
  })).draft;
}

async function publish(cookie, project, draft, status = 200) {
  return request(cookie, "POST", `${draftBase(project)}/${draft.id}/publish`, status, {
    expected_revision: draft.revision,
  });
}

async function live(project, id) {
  return (await db.query(
    "SELECT name, definition, enabled, version, updated_at::text FROM project_rules WHERE project_id = $1 AND id = $2",
    [project, id],
  )).rows[0];
}

test("rule drafts store incomplete work privately and enforce revision CAS", { timeout: 20_000 }, async () => {
  const { a, owner, editor } = await fixtures("Draft incomplete and scope");
  let draft = await newDraft(owner, a);
  assert.equal(draft.rule_id, null);
  assert.equal(draft.enabled, true);
  draft = await save(owner, a, draft, {
    name: "", definition: { version: 1, triggers: [], actions: [{ capability: "task.create", params: {} }] },
  });
  assert.equal(draft.name, "");
  await publish(owner, a, draft, 400);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM project_rules WHERE project_id = $1", [a])).rows[0].n, 0);
  await request(editor, "GET", `${draftBase(a)}/${draft.id}`, 404);
  await request(editor, "PUT", `${draftBase(a)}/${draft.id}`, 404, {
    expected_revision: draft.revision, name: "Other user overwrite",
  });
  assert.deepEqual((await request(editor, "GET", draftBase(a), 200)).drafts, []);

  const responses = await Promise.all(["First tab", "Second tab"].map((name) => http(`${draftBase(a)}/${draft.id}`, {
    method: "PUT", cookie: owner, json: { expected_revision: draft.revision, name },
  })));
  assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 409]);
  const bodies = await Promise.all(responses.map((response) => response.json()));
  assert.equal(bodies.find((body) => body.code)?.code, "draft_conflict");
  const restored = (await request(owner, "GET", `${draftBase(a)}/${draft.id}`, 200)).draft;
  assert.equal(restored.revision, draft.revision + 1);
  await request(owner, "DELETE", `${draftBase(a)}/${draft.id}`, 409, { expected_revision: draft.revision });
});

test("rule draft publication keeps its UUID and is atomic and idempotent", { timeout: 20_000 }, async () => {
  const { a, owner } = await fixtures("Draft publication identity");
  let draft = await newDraft(owner, a);
  draft = await save(owner, a, draft, { name: "Published once", definition: definition() });
  const results = await Promise.all([publish(owner, a, draft), publish(owner, a, draft)]);
  assert.equal(results[0].rule_id, results[1].rule_id);
  const publishedId = results[0].rule_id;
  draft = results[0].draft;
  assert.equal(draft.id, results[1].draft.id);
  assert.equal(draft.rule_id, publishedId);
  assert.equal(draft.has_unpublished_changes, false);
  assert.equal(draft.published_revision, draft.revision);
  assert.equal((await live(a, publishedId)).enabled, true);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM project_rules WHERE project_id = $1", [a])).rows[0].n, 1);
  assert.deepEqual((await request(owner, "GET", draftBase(a), 200)).drafts, []);

  const before = await live(a, publishedId);
  draft = await save(owner, a, draft, { name: "Unpublished edit", definition: definition("Changed effect"), enabled: false });
  assert.equal(draft.has_unpublished_changes, true);
  const summaries = (await request(owner, "GET", draftBase(a), 200)).drafts;
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].rule_id, publishedId);
  assert.equal(summaries[0].has_unpublished_changes, true);
  assert.deepEqual(await live(a, publishedId), before);
  const published = await publish(owner, a, draft);
  const after = await live(a, publishedId);
  assert.equal(published.rule_id, publishedId);
  assert.equal(after.name, "Unpublished edit");
  assert.equal(after.enabled, false);
  assert.equal(after.version, before.version + 1);
});

test("existing rule drafts preserve disabled state, detect legacy edits, and can reload the published version", { timeout: 20_000 }, async () => {
  const { a, owner, editor } = await fixtures("Draft published conflict");
  const { id } = await request(owner, "POST", `/api/projects/${a}/rules`, 201, {
    name: "Live", definition: definition(), enabled: false,
  });
  await request(editor, "POST", draftBase(a), 403, { rule_id: id });
  let draft = await newDraft(owner, a, id);
  assert.equal(draft.enabled, false);
  const resumed = (await request(owner, "POST", draftBase(a), 200, { rule_id: id })).draft;
  assert.equal(resumed.id, draft.id);
  assert.equal((await request(owner, "GET", `${draftBase(a)}?rule_id=${id}`, 200)).draft.id, draft.id);
  draft = await save(owner, a, draft, { name: "Draft change" });
  await request(owner, "PATCH", `/api/projects/${a}/rules/${id}`, 200, { name: "Legacy modal change" });
  const conflict = await publish(owner, a, draft, 409);
  assert.equal(conflict.code, "rule_conflict");
  assert.equal((await live(a, id)).name, "Legacy modal change");
  const deleted = await http(`${draftBase(a)}/${draft.id}`, {
    method: "DELETE", cookie: owner, json: { expected_revision: draft.revision },
  });
  assert.equal(deleted.status, 204);
  const refreshed = await newDraft(owner, a, id);
  assert.notEqual(refreshed.id, draft.id);
  assert.equal(refreshed.name, "Legacy modal change");
  assert.equal(refreshed.enabled, false);
  assert.equal(refreshed.has_unpublished_changes, false);
});

test("rule draft Webhook secrets stay private and follow action references through reordered edits", { timeout: 20_000 }, async () => {
  const { a, owner, editor } = await fixtures("Draft webhook credentials");
  const { id } = await request(owner, "POST", `/api/projects/${a}/rules`, 201, {
    name: "Credential owner",
    definition: {
      triggers: [{ event: "task.created" }],
      actions: [
        { capability: "webhook.post", params: { url: "https://example.com/one", secret: "draft-secret-one" } },
        { capability: "webhook.post", params: { url: "https://example.com/two", secret: "draft-secret-two" } },
      ],
    },
  });
  // Older persisted definitions did not have stable Webhook action IDs.
  await db.query(
    `UPDATE project_rules SET definition = jsonb_set(definition, '{actions}',
       (SELECT jsonb_agg(action - 'webhookActionId')
        FROM jsonb_array_elements(definition->'actions') AS items(action)))
     WHERE id = $1`,
    [id],
  );
  let draft = await newDraft(owner, a, id);
  assert.equal(JSON.stringify(draft).includes("draft-secret-"), false);
  assert.ok(draft.definition.actions.every((action) => typeof action.webhookActionId === "string"));
  draft = await save(owner, a, draft, {
    definition: { ...draft.definition, actions: [...draft.definition.actions].reverse() },
  });
  const rawDraft = (await db.query("SELECT definition FROM project_rule_drafts WHERE id = $1", [draft.id])).rows[0].definition;
  assert.deepEqual(rawDraft.actions.map((action) => action.params.secret), ["draft-secret-two", "draft-secret-one"]);
  assert.equal((await live(a, id)).definition.actions[0].params.secret, "draft-secret-one");
  const list = await request(owner, "GET", draftBase(a), 200);
  assert.deepEqual(Object.keys(list.drafts[0]).sort(),
    ["id", "project_id", "rule_id", "name", "updated_at", "has_unpublished_changes"].sort());
  assert.equal(JSON.stringify(list).includes("https://example.com/"), false);
  const source = await request(owner, "GET", `${draftBase(a)}?rule_id=${id}`, 200);
  assert.equal(JSON.stringify([list, source]).includes("draft-secret-"), false);
  await request(editor, "GET", `${draftBase(a)}?rule_id=${id}`, 403);
  await publish(owner, a, draft);
  assert.deepEqual((await live(a, id)).definition.actions.map((action) => action.params.secret),
    ["draft-secret-two", "draft-secret-one"]);

  const current = (await request(owner, "GET", `${draftBase(a)}/${draft.id}`, 200)).draft;
  const forged = structuredClone(current.definition);
  forged.actions[0].webhookActionId = randomUUID();
  await request(owner, "PUT", `${draftBase(a)}/${draft.id}`, 400, {
    expected_revision: current.revision, definition: forged,
  });
  const redirected = structuredClone(current.definition);
  redirected.actions[0].params.url = "https://example.com/reconfigured";
  const changed = await save(owner, a, current, { definition: redirected });
  const rawChanged = (await db.query("SELECT definition FROM project_rule_drafts WHERE id = $1", [changed.id])).rows[0].definition;
  assert.equal(rawChanged.actions[0].params.secret, undefined);
});

test("rule draft lists return at most 50 private metadata summaries in newest-first order", { timeout: 20_000 }, async () => {
  const { a, b, ownerId, owner, editor } = await fixtures("Draft metadata list bound");
  const sensitive = {
    version: 1, triggers: [], actions: [{ capability: "webhook.post", params: {
      url: "https://example.com/private-draft-destination", secret: "private-draft-list-secret",
    } }],
  };
  await db.query(
    `INSERT INTO project_rule_drafts (id, project_id, user_id, name, definition, updated_at)
     SELECT gen_random_uuid(), $1::bigint, $2::bigint, 'Draft ' || n, $3::jsonb,
       now() - n * interval '1 minute' FROM generate_series(1, 53) AS n`,
    [a, ownerId, JSON.stringify(sensitive)],
  );
  await newDraft(owner, b);
  const { drafts } = await request(owner, "GET", draftBase(a), 200);
  assert.equal(drafts.length, 50);
  assert.equal(drafts[0].name, "Draft 1");
  assert.equal(drafts.at(-1).name, "Draft 50");
  for (const summary of drafts) {
    assert.equal(summary.project_id, a);
    assert.equal(summary.rule_id, null);
    assert.equal(summary.has_unpublished_changes, true);
    assert.ok(Number.isFinite(Date.parse(summary.updated_at)));
    assert.deepEqual(Object.keys(summary).sort(),
      ["id", "project_id", "rule_id", "name", "updated_at", "has_unpublished_changes"].sort());
  }
  assert.equal(JSON.stringify(drafts).includes("private-draft"), false);
  assert.deepEqual((await request(editor, "GET", draftBase(a), 200)).drafts, []);
});

test("rule drafts reject portfolio replicas, foreign fields and revoked project access at publication", { timeout: 20_000 }, async () => {
  const { a, b, owner, ownerId, editor, editorId } = await fixtures("Draft publish authorization");
  const { rows: [portfolio] } = await db.query(
    "INSERT INTO portfolios (workspace_id, owner_id, name) VALUES (1, $1, 'Draft replica fixture') RETURNING id", [ownerId],
  );
  const { rows: [portfolioRule] } = await db.query(
    "INSERT INTO portfolio_rules (workspace_id, portfolio_id, owner_id, name, definition) VALUES (1, $1, $2, 'Replica', $3::jsonb) RETURNING id",
    [portfolio.id, ownerId, JSON.stringify(definition())],
  );
  const { rows: [replica] } = await db.query(
    "INSERT INTO project_rules (workspace_id, project_id, owner_id, portfolio_rule_id, name, definition) VALUES (1, $1, $2, $3, 'Replica', $4::jsonb) RETURNING id",
    [a, ownerId, portfolioRule.id, JSON.stringify(definition())],
  );
  await request(owner, "POST", draftBase(a), 404, { rule_id: Number(replica.id) });
  const { rows: [field] } = await db.query(
    "INSERT INTO custom_fields (project_id, name, field_type) VALUES ($1, 'Foreign draft field', 'text') RETURNING id", [b],
  );
  let draft = await newDraft(owner, a);
  draft = await save(owner, a, draft, {
    name: "Invalid project condition",
    definition: { ...definition(), conditions: [{ field: `custom.${field.id}`, op: "eq", value: "secret" }] },
  });
  await publish(owner, a, draft, 400);
  let restricted = await newDraft(editor, a);
  restricted = await save(editor, a, restricted, {
    name: "No foreign field writes",
    definition: {
      triggers: [{ event: "task.created" }],
      actions: [{ capability: "task.set_custom_field", params: { field_id: Number(field.id), value: "attempt" } }],
    },
  });
  await publish(editor, a, restricted, 403);
  await db.query("UPDATE project_members SET role = 'viewer' WHERE project_id = $1 AND user_id = $2", [a, editorId]);
  await request(editor, "GET", `${draftBase(a)}/${restricted.id}`, 403);
  await publish(editor, a, restricted, 403);
});

test("failed publication rolls back its rule and can safely retry the same draft revision", { timeout: 20_000 }, async (t) => {
  const { a, owner } = await fixtures("Draft publication rollback");
  let draft = await newDraft(owner, a);
  draft = await save(owner, a, draft, { name: "Atomic publish", definition: definition() });
  const name = `draft_${randomUUID().replaceAll("-", "")}`;
  await db.query(`
    CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.id = '${draft.id}'::uuid AND OLD.rule_id IS NULL AND NEW.rule_id IS NOT NULL THEN
        RAISE EXCEPTION 'draft publish fixture failure' USING ERRCODE = '40001';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER ${name} BEFORE UPDATE ON project_rule_drafts FOR EACH ROW EXECUTE FUNCTION ${name}();
  `);
  t.after(() => db.query(`DROP TRIGGER IF EXISTS ${name} ON project_rule_drafts; DROP FUNCTION IF EXISTS ${name}()`));
  await publish(owner, a, draft, 500);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM project_rules WHERE project_id = $1", [a])).rows[0].n, 0);
  const restored = (await request(owner, "GET", `${draftBase(a)}/${draft.id}`, 200)).draft;
  assert.equal(restored.rule_id, null);
  assert.equal(restored.revision, draft.revision);
  await db.query(`DROP TRIGGER ${name} ON project_rule_drafts`);
  const published = await publish(owner, a, restored);
  assert.equal(published.draft.id, restored.id);
  assert.ok(published.rule_id);
});

test("rule publication can wait for a worker's rule lock without blocking its project read", { timeout: 15_000 }, async () => {
  const { a, owner } = await fixtures("Draft worker lock order");
  const { id } = await request(owner, "POST", `/api/projects/${a}/rules`, 201, {
    name: "Live lock fixture", definition: definition(),
  });
  let draft = await newDraft(owner, a, id);
  draft = await save(owner, a, draft, { name: "Published after worker" });
  const worker = await db.connect();
  let publishing;
  try {
    await worker.query("BEGIN");
    await worker.query("SET LOCAL lock_timeout = '1s'");
    const { rows: [{ pid }] } = await worker.query("SELECT pg_backend_pid() AS pid");
    await worker.query("SELECT id FROM project_rules WHERE id = $1 FOR SHARE", [id]);
    publishing = publish(owner, a, draft);
    const deadline = Date.now() + 5_000;
    let waiting = false;
    while (Date.now() < deadline) {
      if ((await db.query(
        "SELECT 1 FROM pg_stat_activity WHERE $1::integer = ANY(pg_blocking_pids(pid))", [pid],
      )).rowCount > 0) {
        waiting = true;
        break;
      }
      await delay(20);
    }
    assert.equal(waiting, true, "publication should wait for the worker's rule lock");
    await worker.query("SELECT id FROM projects WHERE id = $1 FOR SHARE", [a]);
    await worker.query("COMMIT");
  } finally {
    await worker.query("ROLLBACK");
    worker.release();
    if (publishing) await publishing;
  }
  assert.equal((await live(a, id)).name, "Published after worker");
});
