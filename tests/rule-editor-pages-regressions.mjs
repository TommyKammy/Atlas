import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, test } from "node:test";
import { db, fixtures, http, request, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);

async function assertPageDenied(response) {
  const html = await response.text();
  // With streamed layouts Next can send HTTP 200 before notFound resolves.
  // The fallback digest and absence of editor data are the authorization contract.
  assert.ok(response.status === 404 || response.status === 200, `unexpected status ${response.status}`);
  if (response.status === 200) assert.ok(html.includes("NEXT_HTTP_ERROR_FALLBACK;404"));
  assert.ok(!html.includes("data-rule-workflow-editor"));
  assert.ok(!html.includes("foreign rule"));
}

test("workflow pages render only the viewer's allowed source and private draft data", async () => {
  const f = await fixtures("Workflow page scopes");
  const secret = `private-signing-key-${randomUUID()}`;
  const destination = `https://example.com/private-destination-${randomUUID()}`;
  const { id } = await request(f.owner, "POST", `/api/projects/${f.a}/rules`, 201, {
    name: "public-workflow-title", definition: { triggers: [{ event: "task.manual_rule" }], actions: [{ capability: "webhook.post", params: { url: destination, secret } }] },
  });
  const { draft } = await request(f.owner, "POST", `/api/projects/${f.a}/rules/drafts`, 201, { rule_id: id });
  const privateTitle = `private-draft-${randomUUID()}`;
  await request(f.owner, "PUT", `/api/projects/${f.a}/rules/drafts/${draft.id}`, 200, { expected_revision: draft.revision, name: privateTitle });
  const ownerPage = await http(`/projects/${f.a}/rules/${id}`, { cookie: f.owner });
  assert.equal(ownerPage.status, 200);
  const ownerHtml = await ownerPage.text();
  assert.ok(ownerHtml.includes(privateTitle));
  assert.ok(!ownerHtml.includes(secret));
  const editorPage = await http(`/projects/${f.a}/rules/${id}`, { cookie: f.editor });
  assert.equal(editorPage.status, 200);
  const editorHtml = await editorPage.text();
  assert.ok(editorHtml.includes("public-workflow-title"));
  assert.ok(!editorHtml.includes(privateTitle));
  assert.ok(!editorHtml.includes(secret));
  assert.ok(!editorHtml.includes(destination));
  assert.ok(editorHtml.includes("閲覧モード"));
});

test("workflow page routes reject malformed, foreign and viewer-only new editor access", async () => {
  const f = await fixtures("Workflow page denial");
  const { id } = await request(f.owner, "POST", `/api/projects/${f.b}/rules`, 201, {
    name: "foreign rule", definition: { triggers: [{ event: "task.manual_rule" }], actions: [{ capability: "task.complete", params: {} }] },
  });
  for (const path of [`/projects/${f.a}/rules/${id}`, `/projects/${f.a}/rules/new?draft=not-a-uuid`, `/projects/${f.a}/rules/-1`]) {
    const response = await http(path, { cookie: f.editor });
    await assertPageDenied(response);
  }
  await db.query("UPDATE project_members SET role='viewer' WHERE project_id=$1 AND user_id=$2", [f.a, f.editorId]);
  const response = await http(`/projects/${f.a}/rules/new`, { cookie: f.editor });
  await assertPageDenied(response);
});
