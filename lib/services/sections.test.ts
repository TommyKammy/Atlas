import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../api/errors";
import { db } from "../db";
import type { Actor } from "./actor";
import { createSection } from "./sections";

type AuthOptions = {
  role?: string | null;
  settings?: unknown;
};

const actor: Actor = { uid: 13, source: "web" };

/** Minimal Queryable for loadAuthActor, getProjectAccess and project policy. */
function mockAuthQueries(options: AuthOptions, calls: string[]) {
  return async (sql: string) => {
    calls.push(sql);
    let rows: Record<string, unknown>[] = [];
    if (sql.includes("FROM users u") && sql.includes("is_guest")) {
      rows = [{ is_admin: false, is_guest: false, deactivated_at: null }];
    } else if (sql.includes("LEFT JOIN project_members")) {
      rows = [{ is_admin: false, deactivated_at: null, role: options.role ?? null }];
    } else if (sql.includes("SELECT settings FROM projects")) {
      rows = [{ settings: options.settings ?? {} }];
    } else {
      throw new Error(`unexpected query: ${sql}`);
    }
    return { rows, rowCount: rows.length, command: "SELECT", fields: [], oid: 0 };
  };
}

async function assertApiError(
  promise: Promise<unknown>,
  status: number,
  message: string,
  code: string,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiError, `expected ApiError, got ${String(error)}`);
    assert.equal(error.status, status);
    assert.equal(error.message, message);
    assert.equal(error.code, code);
    return true;
  });
}

test("createSection requires the configure permission before validation", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockAuthQueries({ role: "viewer" }, calls));
  await assertApiError(
    createSection(actor, 7, { name: "Section" }),
    403,
    "insufficient project role",
    "forbidden",
  );
  assert.equal(calls.length, 3);
  assert.ok(!calls.some((sql) => sql.includes("FROM sections")));
});

test("createSection requires a name after the permission check", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockAuthQueries({ role: "admin" }, calls));
  await assertApiError(
    createSection(actor, 7, {}),
    400,
    "project_id and name are required",
    "bad_request",
  );
  await assertApiError(
    createSection(actor, 7, { name: "   " }),
    400,
    "project_id and name are required",
    "bad_request",
  );
  assert.equal(calls.length, 6);
});

test("createSection rejects before and after anchors together", async (t) => {
  const calls: string[] = [];
  t.mock.method(db, "query", mockAuthQueries({ role: "admin" }, calls));
  await assertApiError(
    createSection(actor, 7, { name: "Section", before_section_id: 1, after_section_id: 2 }),
    400,
    "before_section_id and after_section_id are mutually exclusive",
    "bad_request",
  );
  assert.equal(calls.length, 3);
  assert.ok(!calls.some((sql) => sql.includes("FROM sections")));
});
