import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { db } from "./db";
import { ALL_PERMISSIONS } from "./permission-catalog";
import type { SecuritySettings } from "./admin-data";

type Call = { sql: string; params?: unknown[] };

const WORKSPACE_ID = 7;
const ACTOR_ID = 42;

function result(rows: QueryResultRow[], rowCount = rows.length): QueryResult {
  return { rows, rowCount, command: "SELECT", fields: [], oid: 0 };
}

const settings: SecuritySettings = {
  workspace_id: WORKSPACE_ID,
  two_factor_policy: "optional",
  saml_mode: "off",
  saml_signin_url: "",
  saml_certificate: "",
  saml_session_days: 7,
  saml_jit_provisioning: false,
  scim_enabled: false,
  mcp_enabled: false,
  mcp_pat_enabled: false,
  password_min_length: 12,
  password_require_upper: false,
  password_require_lower: false,
  password_require_number: false,
  password_require_symbol: false,
  updated_at: "2026-11-24T00:00:00Z",
};

/** Queryable for the request-scoped reads the PATCH handler performs outside the transaction. */
function mockDbQueries(calls: Call[]) {
  return async (sql: string, params?: unknown[]): Promise<QueryResult> => {
    calls.push({ sql, params });
    if (sql.includes("FROM user_sessions")) {
      return result([{
        id: ACTOR_ID,
        name: "Admin",
        email: "admin@example.com",
        is_admin: true,
        is_guest: false,
        totp_enabled: false,
        mfa_pending: false,
      }]);
    }
    if (sql.includes("u.totp_enrolled_at")) return result([]);
    if (sql.includes("WHERE u.id = $1")) {
      return result([{
        id: ACTOR_ID,
        is_admin: true,
        is_guest: false,
        role_id: 1,
        key: "owner",
        name: "オーナー",
        base_level: "admin",
        permissions: ALL_PERMISSIONS,
        is_super: true,
      }]);
    }
    if (sql.includes("SELECT id FROM workspaces")) return result([{ id: WORKSPACE_ID }]);
    if (sql.includes("INSERT INTO workspace_security")) return result([]);
    if (sql.includes("FROM workspace_security WHERE workspace_id")) return result([settings]);
    throw new Error(`unexpected query: ${sql}`);
  };
}

/** Transaction client that records the settings write and every audit row. */
function mockTransactionClient(calls: Call[]): PoolClient {
  const client = {
    query: async (sql: string, params?: unknown[]): Promise<QueryResult> => {
      calls.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return result([]);
      if (sql.includes("SELECT w.*")) return result([settings]);
      if (sql.includes("UPDATE workspace_security SET")) {
        return result([{
          ...settings,
          two_factor_policy: "required",
          scim_enabled: true,
          mcp_enabled: true,
          mcp_pat_enabled: true,
        }]);
      }
      if (sql.includes("INSERT INTO audit_log")) return result([]);
      throw new Error(`unexpected query: ${sql}`);
    },
    release: () => undefined,
  };
  return client as unknown as PoolClient;
}

test("security settings PATCH records the workspace on all four audit rows", async (t) => {
  const dbCalls: Call[] = [];
  const clientCalls: Call[] = [];
  t.mock.method(db, "query", mockDbQueries(dbCalls));
  t.mock.method(Pool.prototype, "connect", async () => mockTransactionClient(clientCalls));

  // lib/db awaits next/server connection() before opening the pool client.
  const nativeRequire = createRequire(import.meta.url);
  const nextServer = nativeRequire("next/server") as { connection: () => Promise<void> };
  t.mock.method(nextServer, "connection", async () => undefined);

  const { PATCH } = await import("../app/api/admin/security/route");
  const request = new NextRequest("http://localhost/api/admin/security", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      cookie: `atlas_session=${"a".repeat(43)}`,
    },
    body: JSON.stringify({
      two_factor_policy: "required",
      scim_enabled: true,
      mcp_enabled: true,
      mcp_pat_enabled: true,
    }),
  });

  const response = await PATCH(request);
  assert.equal(response.status, 200);
  const payload = await response.json() as { settings: SecuritySettings };
  assert.equal(payload.settings.workspace_id, WORKSPACE_ID);

  const auditCalls = clientCalls.filter((call) => call.sql.includes("INSERT INTO audit_log"));
  assert.deepEqual(
    auditCalls.map((call) => call.params?.[2]),
    ["security.update", "security.scim_enable", "security.mcp_enable", "security.mcp_pat_enable"],
  );
  // The update summary lists changed column names, never SQL assignments.
  assert.equal(
    auditCalls[0].params?.[6],
    "two_factor_policy, scim_enabled, mcp_enabled, mcp_pat_enabled",
  );
  assert.doesNotMatch(String(auditCalls[0].params?.[6]), /\$\d| = /);
  for (const call of auditCalls) {
    // getAuditLog filters by audit_log.workspace_id, so every row must carry it.
    assert.equal(call.params?.[0], WORKSPACE_ID);
    assert.equal(call.params?.[1], ACTOR_ID);
    assert.equal(call.params?.[3], "workspace_security");
    assert.equal(call.params?.[4], WORKSPACE_ID);
    assert.equal(call.params?.[5], null);
  }
  assert.ok(!dbCalls.some((call) => call.sql.includes("INSERT INTO audit_log")));
});
