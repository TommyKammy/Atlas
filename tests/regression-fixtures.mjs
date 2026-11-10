import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";

const databaseUrl = "postgres://atlas:atlas@db:5432/atlas_p0";
assert.equal(process.env.DATABASE_URL, databaseUrl, "Run via the disposable regression script");
export const db = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3_000 });
export const base = "http://127.0.0.1:3000";
after(() => db.end());

export async function waitForHttp() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/login`, { signal: AbortSignal.timeout(1_000) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      // The app might still be applying migrations and starting Next.js.
    }
    await delay(200);
  }
  assert.fail("GET /login did not respond successfully within 15 seconds");
}

export function http(path, { cookie, method = "GET", json, body, headers, timeout = 5_000 } = {}) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(json === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: json === undefined ? body : JSON.stringify(json),
    signal: AbortSignal.timeout(timeout),
    redirect: "manual",
  });
}

export async function request(cookie, method, path, status, body) {
  const response = await http(path, { cookie, method, json: body });
  const text = await response.text();
  assert.equal(response.status, status, `${method} ${path}: ${text}`);
  return JSON.parse(text);
}

export async function session(userId) {
  const token = randomBytes(32).toString("base64url");
  await db.query(
    `INSERT INTO user_sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + interval '10 minutes')`,
    [createHash("sha256").update(token).digest("hex"), userId],
  );
  return `atlas_session=${token}`;
}

export async function fixtures(label) {
  const { rows: [owner, editor] } = await db.query(
    "INSERT INTO users (name) VALUES ($1), ($2) RETURNING id",
    [`${label} owner`, `${label} editor`],
  );
  const { rows: [a, b] } = await db.query(
    "INSERT INTO projects (workspace_id, name) VALUES (1, $1), (1, $2) RETURNING id",
    [`${label} A`, `${label} B`],
  );
  await db.query(
    `INSERT INTO project_members (project_id, user_id, role)
     VALUES ($1, $3, 'admin'), ($2, $3, 'admin'), ($1, $4, 'editor')`,
    [a.id, b.id, owner.id, editor.id],
  );
  return {
    a: Number(a.id), b: Number(b.id), ownerId: owner.id, editorId: editor.id,
    owner: await session(owner.id), editor: await session(editor.id),
  };
}

export async function task(project, name, parent = null) {
  const { rows: [row] } = await db.query(
    "INSERT INTO tasks (project_id, name, parent_task_id) VALUES ($1, $2, $3) RETURNING id",
    [project, name, parent],
  );
  return Number(row.id);
}

export async function projectOf(taskId) {
  const { rows: [row] } = await db.query("SELECT project_id FROM tasks WHERE id = $1", [taskId]);
  return row ? Number(row.project_id) : null;
}
