import Link from "next/link";
import { getProjectsForUser, getUsers, getWorkspace, searchTasksAdvanced } from "@/lib/data";
import { getCurrentUserId } from "@/lib/current-user";
import { redirect } from "next/navigation";

export const instant = false;

function str(sp: { [key: string]: string | string[] | undefined }, key: string): string {
  const v = sp[key];
  return typeof v === "string" ? v : "";
}

export default async function SearchPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await props.searchParams;
  const ws = await getWorkspace();
  const viewerId = await getCurrentUserId();
  if (!viewerId) redirect("/login");
  const projects = ws && viewerId ? await getProjectsForUser(ws.id, viewerId) : [];
  const users = await getUsers();

  const q = str(sp, "q").trim();
  const projectRaw = str(sp, "project");
  const assigneeRaw = str(sp, "assignee");
  const completedRaw = str(sp, "completed");
  const f = {
    q,
    projectId: /^\d+$/.test(projectRaw) ? Number(projectRaw) : null,
    assigneeId: assigneeRaw === "none" ? ("none" as const) : /^\d+$/.test(assigneeRaw) ? Number(assigneeRaw) : null,
    completed: (completedRaw === "open" || completedRaw === "done" ? completedRaw : "all") as
      | "all"
      | "open"
      | "done",
    dueFrom: /^\d{4}-\d{2}-\d{2}$/.test(str(sp, "from")) ? str(sp, "from") : null,
    dueTo: /^\d{4}-\d{2}-\d{2}$/.test(str(sp, "to")) ? str(sp, "to") : null,
  };
  const searched = q !== "" || projectRaw !== "" || assigneeRaw !== "" || f.completed !== "all" || f.dueFrom || f.dueTo;
  const results = ws && searched ? await searchTasksAdvanced(ws.id, f, viewerId ?? undefined) : [];

  const field = "rounded border px-2 py-1 text-sm";
  return (
    <div className="p-6">
      <h1 className="text-lg font-bold">検索</h1>
      <form method="GET" action="/search" className="mt-3 flex max-w-5xl flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1">
          キーワード
          <input name="q" defaultValue={q} placeholder="名前・説明" className={`${field} w-48`} />
        </label>
        <label className="flex flex-col gap-1">
          プロジェクト
          <select name="project" defaultValue={projectRaw} className={field}>
            <option value="">すべて</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          担当者
          <select name="assignee" defaultValue={assigneeRaw} className={field}>
            <option value="">すべて</option>
            <option value="none">未割当</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          状態
          <select name="completed" defaultValue={f.completed} className={field}>
            <option value="all">すべて</option>
            <option value="open">未完了</option>
            <option value="done">完了</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          期日（自）
          <input type="date" name="from" defaultValue={f.dueFrom ?? ""} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          期日（至）
          <input type="date" name="to" defaultValue={f.dueTo ?? ""} className={field} />
        </label>
        <button type="submit" className="rounded bg-blue-600 px-4 py-1.5 text-white hover:bg-blue-700">
          検索
        </button>
      </form>
      {searched && (
        <p className="mt-3 text-sm text-neutral-500">{results.length}件</p>
      )}
      <div className="mt-1 max-w-5xl">
        {results.map((t) => (
          <div key={t.id} className="flex items-center gap-3 border-b py-2 text-sm hover:bg-neutral-50">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                t.completed ? "border-green-600 bg-green-600 text-white" : "border-neutral-400"
              }`}
            >
              {t.completed && "✓"}
            </span>
            <Link
              href={`/projects/${t.project_id}?view=list&task=${t.id}`}
              className={`min-w-0 flex-1 truncate hover:underline ${t.completed ? "text-neutral-400 line-through" : ""}`}
            >
              {t.name}
            </Link>
            <span className="hidden w-32 shrink-0 truncate text-xs text-neutral-500 md:inline">
              {t.project_name}
            </span>
            <span className="hidden w-24 shrink-0 truncate text-xs text-neutral-500 md:inline">
              {t.assignee_name ?? "–"}
            </span>
            <span className="w-24 shrink-0 text-neutral-600">{t.due_on ?? "–"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
