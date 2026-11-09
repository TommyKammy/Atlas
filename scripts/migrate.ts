import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const dir = path.join(process.cwd(), "db", "migrations");
  const pool = new Pool({ connectionString });
  try {
    await pool.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
    let appliedCount = 0;
    for (const file of files) {
      const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
      if ((applied.rowCount ?? 0) > 0) continue;
      const sql = await readFile(path.join(dir, file), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        appliedCount += 1;
        console.log(`applied ${file}`);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
    console.log(`migrations complete: ${appliedCount} applied, ${files.length} total`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
