import { notFound } from "next/navigation";
import { db } from "@/lib/db";

export const instant = false;

async function resolveToken(token: string) {
  const r = await db.query(
    `SELECT p.id, p.name FROM project_share_tokens t JOIN projects p ON p.id = t.project_id
     WHERE t.token = $1 AND p.deleted_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > NOW())`,
    [token],
  );
  return r.rows[0] as { id: number; name: string } | undefined;
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const project = await resolveToken(token);
  if (!project) notFound();

  const sections = await db.query(
    "SELECT id, name FROM sections WHERE project_id = $1 ORDER BY position, id",
    [project.id],
  );
  const tasks = await db.query(
    `SELECT t.id, t.section_id, t.name, t.completed, u.name AS assignee_name,
       t.due_on::text AS due_on, t.progress, t.status
     FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
     WHERE t.project_id = $1 AND t.parent_task_id IS NULL AND t.deleted_at IS NULL ORDER BY t.position, t.id`,
    [project.id],
  );
  const totals = await db.query(
    `SELECT COUNT(*) FILTER (WHERE parent_task_id IS NULL)::int AS total,
       COUNT(*) FILTER (WHERE parent_task_id IS NULL AND completed)::int AS done
     FROM tasks WHERE project_id = $1 AND deleted_at IS NULL`,
    [project.id],
  );
  const pct =
    totals.rows[0].total === 0 ? 0 : Math.round((totals.rows[0].done / totals.rows[0].total) * 100);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <p className="text-xs text-subtle">Atlas 共有プレビュー（読み取り専用）</p>
      <h1 className="mt-1 text-xl font-bold">{project.name}</h1>
      <p className="mt-1 text-sm text-secondary">
        進捗 {pct}%（{totals.rows[0].done}/{totals.rows[0].total}）
      </p>
      {(sections.rows as { id: number; name: string }[]).map((s) => (
        <div key={s.id} className="mt-4">
          <h2 className="font-semibold">{s.name}</h2>
          {(tasks.rows as {
            id: number;
            section_id: number | null;
            name: string;
            completed: boolean;
            assignee_name: string | null;
            due_on: string | null;
            progress: number;
            status: string;
          }[])
            .filter((t) => t.section_id === s.id)
            .map((t) => (
              <div key={t.id} className="flex items-center gap-3 border-b py-1.5 text-sm">
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-full border text-[10px] ${
                    t.completed ? "border-success-strong bg-success-strong text-on-accent" : "border-line-strong"
                  }`}
                >
                  {t.completed && "✓"}
                </span>
                <span className={`min-w-0 flex-1 truncate ${t.completed ? "text-subtle line-through" : ""}`}>
                  {t.name}
                </span>
                <span className="shrink-0 text-xs text-muted">{t.assignee_name ?? "–"}</span>
                <span className="w-24 shrink-0 text-xs text-secondary">{t.due_on ?? "–"}</span>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
