#!/usr/bin/env node
// Atlas weekly digest: posts a summary message to every project with recent
// activity. Idempotent per week (skips projects already reported in 6 days).
// Usage: DATABASE_URL=... node scripts/weekly-report.mjs [--dry-run]
// Suggest: weekly cron. Manual runs are safe to repeat.
const { Pool } = require("pg");

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const projects = await pool.query(
      `SELECT p.id, p.name FROM projects p
       WHERE p.archived_at IS NULL AND p.deleted_at IS NULL
       AND EXISTS (
         SELECT 1 FROM tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL AND t.updated_at > NOW() - interval '7 days'
       )
       AND NOT EXISTS (
         SELECT 1 FROM project_messages m
         WHERE m.project_id = p.id AND m.title LIKE '[自動]%' AND m.created_at > NOW() - interval '6 days'
       )
       ORDER BY p.id`,
    );
    let posted = 0;
    for (const p of projects.rows) {
      const s = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE parent_task_id IS NULL)::int AS total,
           COUNT(*) FILTER (WHERE parent_task_id IS NULL AND completed)::int AS done,
           COUNT(*) FILTER (WHERE parent_task_id IS NULL AND NOT completed AND due_on < CURRENT_DATE)::int AS overdue,
           COUNT(*) FILTER (WHERE parent_task_id IS NULL AND NOT completed AND due_on BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)::int AS due_week,
           COUNT(*) FILTER (WHERE parent_task_id IS NULL AND completed AND updated_at > NOW() - interval '7 days')::int AS done_week
         FROM tasks WHERE project_id = $1`,
        [p.id],
      );
      const t = s.rows[0];
      const pct = t.total === 0 ? 0 : Math.round((t.done / t.total) * 100);
      const od = await pool.query(
        `SELECT name, due_on::text AS due_on FROM tasks
         WHERE project_id = $1 AND parent_task_id IS NULL AND NOT completed AND due_on < CURRENT_DATE
         ORDER BY due_on LIMIT 5`,
        [p.id],
      );
      const lines = [
        `対象期間の進捗: ${t.done}/${t.total}（${pct}%）`,
        `今週の完了: ${t.done_week}件`,
        `期限超過: ${t.overdue}件`,
        `今週期限: ${t.due_week}件`,
      ];
      if (od.rows.length > 0) {
        lines.push("", "期限超過タスク:");
        for (const r of od.rows) lines.push(`・${r.name}（${r.due_on}）`);
      }
      const title = `[自動] 週次レポート ${new Date().toISOString().slice(0, 10)}`;
      if (dryRun) {
        console.log(`[dry-run] project=${p.id} ${p.name}: ${lines[0]}`);
        continue;
      }
      await pool.query(
        "INSERT INTO project_messages (project_id, author_id, title, body) VALUES ($1, NULL, $2, $3)",
        [p.id, title, lines.join("\n")],
      );
      posted++;
      console.log(`posted project=${p.id} ${p.name}`);
    }
    console.log(`done: ${posted} posted, ${projects.rows.length} candidates`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
