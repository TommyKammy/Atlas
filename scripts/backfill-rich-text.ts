import { Pool } from "pg";
import { markdownToDoc } from "../lib/rich-text-markdown";
import type { MentionUser } from "../lib/rich-text-types";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://atlas:atlas@127.0.0.1:5433/atlas",
});

async function main() {
  const usersResult = await pool.query<{ id: number | string; name: string }>(
    "SELECT id, name FROM users WHERE deactivated_at IS NULL ORDER BY id",
  );
  const mentionUsers: MentionUser[] = usersResult.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
  }));

  const tasks = await pool.query<{ id: number | string; description: string }>(
    "SELECT id, description FROM tasks WHERE description_doc IS NULL AND description <> '' ORDER BY id",
  );
  for (const row of tasks.rows) {
    const doc = markdownToDoc(row.description, mentionUsers);
    await pool.query("UPDATE tasks SET description_doc = $2::jsonb WHERE id = $1::bigint", [
      row.id,
      JSON.stringify(doc),
    ]);
  }

  const comments = await pool.query<{ id: number | string; body: string }>(
    "SELECT id, body FROM comments WHERE body_doc IS NULL AND body <> '' ORDER BY id",
  );
  for (const row of comments.rows) {
    const doc = markdownToDoc(row.body, mentionUsers);
    await pool.query("UPDATE comments SET body_doc = $2::jsonb WHERE id = $1::bigint", [
      row.id,
      JSON.stringify(doc),
    ]);
  }

  console.log(`backfilled tasks=${tasks.rowCount ?? 0} comments=${comments.rowCount ?? 0}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
