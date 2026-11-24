import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, type TestContext } from "node:test";
import { saveTaskCustomValue, TaskConflictError } from "./task-client";

type FetchCall = { url: string; body: Record<string, unknown> };

function mockFetch(t: TestContext, calls: FetchCall[], response: Response) {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return response;
  });
}

test("saveTaskCustomValue sends expected_updated_at and returns the new stamp", async (t) => {
  const calls: FetchCall[] = [];
  mockFetch(t, calls, new Response(
    JSON.stringify({ ok: true, updated_at: "2026-02-02T00:00:00.000Z" }),
    { status: 201 },
  ));

  const saved = await saveTaskCustomValue(42, 5, "changed", "2026-01-01T00:00:00.000Z");

  assert.deepEqual(saved, { ok: true, updated_at: "2026-02-02T00:00:00.000Z" });
  assert.equal(calls[0].url, "/api/task-values");
  assert.deepEqual(calls[0].body, {
    task_id: 42,
    field_id: 5,
    value: "changed",
    expected_updated_at: "2026-01-01T00:00:00.000Z",
  });
});

test("saveTaskCustomValue omits the stamp when the caller has none", async (t) => {
  const calls: FetchCall[] = [];
  mockFetch(t, calls, new Response(
    JSON.stringify({ ok: true, updated_at: "2026-02-02T00:00:00.000Z" }),
    { status: 201 },
  ));

  await saveTaskCustomValue(42, 5, "changed");

  assert.deepEqual(calls[0].body, { task_id: 42, field_id: 5, value: "changed" });
});

test("saveTaskCustomValue maps a 409 to TaskConflictError with the current task", async (t) => {
  const calls: FetchCall[] = [];
  mockFetch(t, calls, new Response(
    JSON.stringify({
      error: "conflict",
      updated_at: "2026-02-02T00:00:00.000Z",
      current: { name: "Current", updated_at: "2026-02-02T00:00:00.000Z" },
    }),
    { status: 409 },
  ));

  await assert.rejects(
    saveTaskCustomValue(42, 5, "changed", "2026-01-01T00:00:00.000Z"),
    (error: unknown) => {
      assert.ok(error instanceof TaskConflictError, `expected TaskConflictError, got ${String(error)}`);
      assert.equal(error.status, 409);
      assert.equal(error.updatedAt, "2026-02-02T00:00:00.000Z");
      assert.deepEqual(error.current, {
        name: "Current",
        updated_at: "2026-02-02T00:00:00.000Z",
      });
      return true;
    },
  );
});

test("both task editors pass their current stamp to custom-field saves", () => {
  const list = readFileSync(new URL("./use-list-task-actions.ts", import.meta.url), "utf8");
  assert.match(
    list,
    /saveTaskCustomValue\(\s*task\.id,\s*fieldId,\s*nextValue,\s*expectedUpdatedAt\(task\),?\s*\)/,
  );

  const pane = readFileSync(new URL("./use-task-pane.ts", import.meta.url), "utf8");
  assert.match(
    pane,
    /saveTaskCustomValue\(task\.id, fieldId, value, expectedStamp\)/,
  );
  assert.match(pane, /expectedStamp = updatedAt/);
  assert.match(pane, /retry: \(\) => saveCustomValue\(fieldId, value, error\.updatedAt as string\)/);
});
