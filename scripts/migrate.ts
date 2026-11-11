import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { migrateLegacyMfaSecrets } from "../lib/mfa-secret-migration";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const dir = path.join(process.cwd(), "db", "migrations");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    // Keep one session across migration transactions. Closing it releases the lock.
    await client.query("SELECT pg_advisory_lock(hashtextextended('atlas:schema-migrations', 0))");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
    let appliedCount = 0;
    for (const file of files) {
      const applied = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
      if ((applied.rowCount ?? 0) > 0) continue;
      const sql = await readFile(path.join(dir, file), "utf8");
      try {
        await client.query("BEGIN");
        if (file === "0018_mfa_secret_encryption.sql") await migrateLegacyMfaSecrets(client);
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        appliedCount += 1;
        console.log(`applied ${file}`);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }
    console.log(`migrations complete: ${appliedCount} applied, ${files.length} total`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
