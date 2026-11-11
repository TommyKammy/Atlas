import { Client } from "pg";
import { activeMfaKeyId } from "../lib/mfa-secret";
import { rotateMfaSecrets } from "../lib/mfa-secret-migration";

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== "--apply") throw new Error("Usage: tsx scripts/rotate-mfa-secrets.ts --apply");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  activeMfaKeyId();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('atlas:schema-migrations', 0))");
    const changed = await rotateMfaSecrets(client);
    await client.query("COMMIT");
    console.log(`MFA key rotation complete: ${changed} user records changed`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { await client.end(); }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "MFA key rotation failed");
  process.exitCode = 1;
});
