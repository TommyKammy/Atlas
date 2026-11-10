import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import dns from "node:dns/promises";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import https, { type RequestOptions } from "node:https";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import type { RuleDefinition } from "./automation/types";
import {
  assignWebhookActionIds,
  copyRuleWithoutWebhookCredentials,
  redactWebhookDefinition,
  redactWebhookRun,
  retainWebhookSecrets,
} from "./automation/webhook-credentials";
import { postWebhook, resolveWebhookDestination } from "./automation/webhook-outbound";
import { automationWebhookDelivery, signWebhook, verifyWebhook } from "./automation/webhook-signature";

test("rejects literal nonpublic webhook targets before DNS lookup", async () => {
  for (const host of [
    "127.1", "0x7f000001", "2130706433", "10.1.2.3", "100.64.0.1", "169.254.169.254",
    "172.18.0.2", "192.168.0.1", "224.0.0.1", "[::1]", "[::ffff:127.0.0.1]",
    "[fc00::1]", "[fe80::1]", "[2002:7f00:1::1]", "[64:ff9b::7f00:1]",
  ]) {
    let lookedUp = false;
    await assert.rejects(resolveWebhookDestination(`http://${host}/hook`, async () => {
      lookedUp = true;
      return [];
    }), /only public IP addresses/, host);
    assert.equal(lookedUp, false, host);
  }
  await assert.rejects(resolveWebhookDestination("file:///etc/passwd"), /invalid webhook URL/);
  await assert.rejects(resolveWebhookDestination("http://user:pass@example.com"), /without credentials/);
});

test("only resolves a webhook destination with an entirely public DNS answer set", async () => {
  await assert.rejects(resolveWebhookDestination("https://example.com/hook", async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "::ffff:7f00:1", family: 6 },
  ]), /only public IP addresses/);
  const destination = await resolveWebhookDestination("https://example.com:8443/hook?q=x", async (host) => {
    assert.equal(host, "example.com");
    return [{ address: "2606:4700::1111", family: 6 }];
  });
  assert.deepEqual(destination.address, { address: "2606:4700::1111", family: 6 });
  assert.equal(destination.servername, "example.com");
  assert.equal(destination.url.host, "example.com:8443");
  assert.equal(destination.url.search, "?q=x");
});

test("outgoing webhook connects to the validated IP and never follows a redirect", async (t) => {
  const resolve = t.mock.method(dns, "lookup", (async (hostname: string) => {
    assert.equal(hostname, "receiver.invalid");
    return [{ address: "8.8.8.8", family: 4 }];
  }) as unknown as typeof dns.lookup);
  let destroyed = false;
  const request = t.mock.method(https, "request", ((
    options: RequestOptions,
    callback: (response: IncomingMessage) => void,
  ) => {
    assert.equal(options.hostname, "8.8.8.8");
    assert.equal(options.servername, "receiver.invalid");
    assert.equal(options.path, "/hook?q=x");
    assert.deepEqual(options.headers, { Host: "receiver.invalid:8443", "Content-Length": 2 });
    return Object.assign(new EventEmitter(), {
      end(body: string) {
        assert.equal(body, "{}");
        callback({
          statusCode: 307,
          headers: { location: "http://127.0.0.1/private" },
          destroy() { destroyed = true; },
        } as IncomingMessage);
      },
    }) as ClientRequest;
  }) as typeof https.request);
  syncBuiltinESMExports();
  try {
    assert.equal(await postWebhook("https://receiver.invalid:8443/hook?q=x", "{}", {}), 307);
    assert.equal(resolve.mock.callCount(), 1);
    assert.equal(request.mock.callCount(), 1);
    assert.equal(destroyed, true);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("signed webhook binds the timestamp, delivery ID and original bytes", () => {
  const now = 1_700_000_000;
  const timestamp = String(now);
  const secret = "integration-secret";
  const raw = Buffer.from('{"title":"署名"}');
  const id = "delivery_1";
  const signature = signWebhook(secret, timestamp, id, raw);
  const independent = createHmac("sha256", secret).update(`${timestamp}.${id}.`).update(raw).digest("hex");
  assert.equal(signature, independent);
  assert.equal(verifyWebhook(secret, timestamp, id, raw, signature, now), true);
  assert.equal(verifyWebhook(secret, timestamp, "delivery_2", raw, signature, now), false);
  assert.equal(verifyWebhook(secret, timestamp, id, Buffer.concat([raw, Buffer.from("\n")]), signature, now), false);
  assert.equal(verifyWebhook(secret, timestamp, id, raw, signature, now + 301), false);
  assert.equal(verifyWebhook(secret, timestamp, id, raw, signature, now - 301), false);
  assert.equal(verifyWebhook(secret, timestamp, "delivery.1", raw, signature, now), false);
  const legacy = createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(verifyWebhook(secret, timestamp, id, raw, legacy, now), false);
  assert.equal(verifyWebhook("", timestamp, id, raw, signature, now), false);
});

test("retries keep the webhook delivery ID and timestamp of the planned action", () => {
  const plannedAt = new Date("2026-11-09T00:00:00Z");
  const first = automationWebhookDelivery("seed-a", 1, plannedAt);
  const resumed = automationWebhookDelivery("seed-a", 1, new Date(plannedAt));
  assert.deepEqual(first, resumed);
  assert.notEqual(first.id, automationWebhookDelivery("seed-a", 2, plannedAt).id);
  assert.notEqual(first.id, automationWebhookDelivery("seed-b", 1, plannedAt).id);
  assert.equal(first.sentAt, "2026-11-09T00:00:00.000Z");
});

test("viewer and history projections remove webhook credentials and retain same-URL owner edits", () => {
  const url = "https://example.com/hooks/sensitive-path";
  const action = { capability: "webhook.post", params: { url, secret: "signing-secret" } };
  const definition: RuleDefinition = {
    version: 1,
    triggers: [{ event: "task.created" }],
    actions: [action],
    branches: [{ name: "example", conditions: [], actions: [action] }],
  };
  const viewer = redactWebhookDefinition(definition);
  assert.deepEqual(viewer.actions?.[0]?.params, {});
  assert.deepEqual(viewer.branches?.[0]?.actions[0]?.params, {});
  const scope = "project:1:1";
  const owner = redactWebhookDefinition(definition, scope);
  assert.deepEqual(owner.actions?.[0]?.params, { url });
  const ownerAction = owner.actions![0];
  const kept = retainWebhookSecrets(owner, definition, scope);
  assert.ok(kept.ok);
  assert.equal(kept.definition.actions?.[0]?.params.secret, "signing-secret");
  const changed = { ...owner, actions: [{ ...ownerAction, params: { url: "https://other.example/hook" } }] };
  const changedResult = retainWebhookSecrets(changed, definition, scope);
  assert.ok(changedResult.ok);
  assert.equal(changedResult.definition.actions?.[0]?.params.secret, undefined);
  const cleared = { ...owner, actions: [{ ...ownerAction, params: { url, secret: "" } }] };
  const clearedResult = retainWebhookSecrets(cleared, definition, scope);
  assert.ok(clearedResult.ok);
  assert.equal(clearedResult.definition.actions?.[0]?.params.secret, "");
  assert.deepEqual(copyRuleWithoutWebhookCredentials({ definition, enabled: true }), {
    definition: viewer,
    enabled: false,
  });
  const error = `failed to parse URL ${url}`;
  assert.deepEqual(redactWebhookRun({
    error,
    details: [{ ...action, status: "failed", error }],
  }), {
    error: "webhook request failed",
    details: [{ capability: "webhook.post", params: {}, status: "failed", error: "webhook request failed" }],
  });
});

test("webhook references survive branch moves and separate credentials for the same URL", () => {
  const url = "https://example.com/hooks";
  const first = { capability: "webhook.post", params: { url, secret: "first" } };
  const second = { capability: "webhook.post", params: { url, secret: "second" } };
  const definition = assignWebhookActionIds({
    version: 1,
    triggers: [{ event: "task.created" }],
    branches: [
      { name: "first", conditions: [], actions: [first] },
      { name: "second", conditions: [], actions: [second] },
    ],
  });
  const scope = "portfolio:1:1";
  const owner = redactWebhookDefinition(definition, scope);
  const firstEdit = owner.branches![0].actions[0];
  const secondEdit = owner.branches![1].actions[0];
  assert.notEqual(firstEdit.webhookActionId, secondEdit.webhookActionId);
  assert.equal(firstEdit.params.secret, undefined);
  const moved = { ...owner, branches: undefined, actions: [secondEdit, firstEdit] };
  const updated = retainWebhookSecrets(moved, definition, scope);
  assert.ok(updated.ok);
  assert.deepEqual(updated.definition.actions?.map((action) => action.params.secret), ["second", "first"]);
  assert.deepEqual(updated.definition.actions?.map((action) => action.webhookActionId),
    [secondEdit.webhookActionId, firstEdit.webhookActionId]);

  assert.equal(retainWebhookSecrets({ ...moved, actions: [secondEdit, secondEdit] }, definition, scope).ok, false);
  const other = assignWebhookActionIds(definition);
  assert.equal(retainWebhookSecrets(moved, other, "portfolio:2:1").ok, false);
  const copy = copyRuleWithoutWebhookCredentials({ definition: updated.definition, enabled: true });
  assert.equal(copy.definition.actions?.[0].webhookActionId, undefined);
  assert.deepEqual(copy.definition.actions?.[0].params, {});
  assert.equal(copy.enabled, false);
});

test("legacy webhook edits retain only uniquely identifiable keys", () => {
  const url = "https://example.com/hooks";
  const action = { capability: "webhook.post", params: { url, secret: "signing-secret" } };
  const other = { capability: "webhook.post", params: { url, secret: "different-secret" } };
  const definition: RuleDefinition = { version: 1, triggers: [{ event: "task.created" }], actions: [action] };
  const scope = "project:3:1";
  const oldClient = { ...definition, actions: [{ capability: "webhook.post", params: { url } }] };
  const unique = retainWebhookSecrets(oldClient, definition, scope);
  assert.ok(unique.ok);
  assert.equal(unique.definition.actions?.[0].params.secret, "signing-secret");
  const withStableId = retainWebhookSecrets(oldClient, unique.definition, "project:3:2");
  assert.ok(withStableId.ok);
  assert.deepEqual(withStableId.definition, unique.definition);
  const duplicateUrl = { ...definition, actions: [action, other] };
  assert.equal(retainWebhookSecrets(oldClient, duplicateUrl, scope).ok, false);

  const owner = redactWebhookDefinition(duplicateUrl, scope);
  const moved = { ...owner, actions: [owner.actions![1]] };
  const byReference = retainWebhookSecrets(moved, duplicateUrl, scope, true);
  assert.ok(byReference.ok);
  assert.equal(byReference.definition.actions?.[0].params.secret, "different-secret");
  assert.equal(retainWebhookSecrets(moved, duplicateUrl, "project:3:2", true).ok, false);

  const replacement = retainWebhookSecrets(oldClient, definition, scope, true);
  assert.ok(replacement.ok);
  assert.equal(replacement.definition.actions?.[0].params.secret, undefined);
});
