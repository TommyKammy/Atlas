import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { db } from "./regression-fixtures.mjs";

const exec = promisify(execFile);
const appRoot = fileURLToPath(new URL("..", import.meta.url));
const productionMigrations = join(appRoot, "db", "migrations");

async function migrationFixture(t) {
  const name = `atlas_migration_${randomBytes(8).toString("hex")}`;
  const root = await mkdtemp(join(tmpdir(), "atlas-migration-test-"));
  const directory = join(root, "db", "migrations");
  await mkdir(directory, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  await db.query(`CREATE DATABASE ${name}`);
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.href });
  t.after(async () => {
    await client.end();
    await db.query(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  await client.connect();
  await client.query(await readFile(join(appRoot, "db", "init.sql"), "utf8"));
  return {
    client,
    directory,
    run: () => exec(process.execPath, [join(appRoot, "node_modules", "tsx", "dist", "cli.mjs"),
      join(appRoot, "scripts", "migrate.ts")], {
      cwd: root, env: { ...process.env, DATABASE_URL: url.href }, timeout: 12_000,
    }),
  };
}

test("R19 simultaneous migrators on an empty ledger apply each migration once", { timeout: 20_000 }, async (t) => {
  const { client, directory, run } = await migrationFixture(t);
  await cp(productionMigrations, directory, { recursive: true });
  const barrier = "0000_concurrent_start.sql";
  await writeFile(join(directory, barrier), "SELECT pg_sleep(0.4); CREATE TABLE regression_migration_once (id int);");
  const results = await Promise.allSettled([run(), run()]);
  assert.ok(results.every(({ status }) => status === "fulfilled"), results
    .map((result) => result.status === "fulfilled" ? result.value.stdout : result.reason.message).join("\n"));
  const { rows } = await client.query("SELECT name FROM schema_migrations ORDER BY name");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  assert.deepEqual(rows.map(({ name }) => name), files);
  assert.match((await run()).stdout, /migrations complete: 0 applied/);
});

test("R19 a failed upgrade rolls back its migration, releases the lock and can be retried", { timeout: 20_000 }, async (t) => {
  const { client, directory, run } = await migrationFixture(t);
  const first = "0001_user_sessions.sql";
  await cp(join(productionMigrations, first), join(directory, first));
  await run();
  const before = await client.query("SELECT applied_at::text FROM schema_migrations WHERE name = $1", [first]);
  await cp(productionMigrations, directory, { recursive: true });
  const last = "9999_retryable.sql";
  const creation = "CREATE TABLE regression_migration_retry (id int);";
  await writeFile(join(directory, last), `${creation} SELECT 1/0;`);
  await assert.rejects(run, /division by zero/);
  assert.equal((await client.query("SELECT to_regclass('regression_migration_retry') AS name")).rows[0].name, null);
  assert.equal((await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [last])).rowCount, 0);
  await writeFile(join(directory, last), creation);
  assert.match((await run()).stdout, /migrations complete: 1 applied/);
  const after = await client.query("SELECT applied_at::text FROM schema_migrations WHERE name = $1", [first]);
  assert.deepEqual(after.rows, before.rows);
});
