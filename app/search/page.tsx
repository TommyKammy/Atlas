import Link from "next/link";
import {
  getProjectsForUser,
  getSavedSearches,
  getSearchCustomFields,
  getSearchUsers,
  getSearchHistory,
  saveSearchHistory,
  getWorkspace,
  searchTasksAdvanced,
  searchProjectsGlobal,
  searchMessagesGlobal,
  searchKnowledgeGlobal,
  searchFilesGlobal,
} from "@/lib/data";
import { getCurrentUserId } from "@/lib/current-user";
import { redirect } from "next/navigation";
import SavedSearchBar from "@/components/SavedSearchBar";
import SearchHistoryClear from "@/components/SearchHistoryClear";

export const instant = false;

function str(sp: { [key: string]: string | string[] | undefined }, key: string): string {
  const v = sp[key];
  return typeof v === "string" ? v : "";
}

function dateParam(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export default async function SearchPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await props.searchParams;
  const ws = await getWorkspace();
  const viewerId = await getCurrentUserId();
  if (!viewerId) redirect("/login");
  const [projects, users, customFields, savedSearches, searchHistory] = ws
    ? await Promise.all([
        getProjectsForUser(ws.id, viewerId),
        getSearchUsers(ws.id, viewerId),
        getSearchCustomFields(ws.id, viewerId),
        getSavedSearches(ws.id, viewerId),
        getSearchHistory(viewerId),
      ])
    : [[], [], [], [], []];

  const q = str(sp, "q").trim();
  if (q !== "") await saveSearchHistory(viewerId, q);
  const projectRaw = str(sp, "project");
  const assigneeRaw = str(sp, "assignee");
  const completedRaw = str(sp, "completed");
  const statusRaw = str(sp, "status");
  const statusOptions = [...new Set(projects.flatMap((project) => project.status_options ?? []))].sort((a, b) =>
    a.localeCompare(b, "ja"),
  );
  const custom = customFields
    .map((field) => ({ fieldId: field.id, value: str(sp, `cf_${field.id}`).trim(), type: field.field_type }))
    .filter((entry) => entry.value !== "");
  const f = {
    q,
    projectId: /^\d+$/.test(projectRaw) ? Number(projectRaw) : null,
    assigneeId: assigneeRaw === "none" ? ("none" as const) : /^\d+$/.test(assigneeRaw) ? Number(assigneeRaw) : null,
    completed: (completedRaw === "open" || completedRaw === "done" ? completedRaw : "all") as
      | "all"
      | "open"
      | "done",
    status: statusRaw !== "" ? statusRaw : null,
    dueFrom: dateParam(str(sp, "from")),
    dueTo: dateParam(str(sp, "to")),
    createdFrom: dateParam(str(sp, "created_from")),
    createdTo: dateParam(str(sp, "created_to")),
    completedFrom: dateParam(str(sp, "completed_from")),
    completedTo: dateParam(str(sp, "completed_to")),
    custom,
  };
  const searched =
    q !== "" ||
    projectRaw !== "" ||
    assigneeRaw !== "" ||
    f.completed !== "all" ||
    f.status !== null ||
    f.dueFrom !== null ||
    f.dueTo !== null ||
    f.createdFrom !== null ||
    f.createdTo !== null ||
    f.completedFrom !== null ||
    f.completedTo !== null ||
    custom.length > 0;
  const results = ws && searched ? await searchTasksAdvanced(ws.id, f, viewerId ?? undefined) : [];
  const [projectHits, messageHits, knowledgeHits, fileHits] =
    ws && q !== ""
      ? await Promise.all([
          searchProjectsGlobal(ws.id, q, viewerId ?? undefined),
          searchMessagesGlobal(ws.id, q, viewerId ?? undefined),
          searchKnowledgeGlobal(ws.id, q, viewerId ?? undefined),
          searchFilesGlobal(ws.id, q, viewerId ?? undefined),
        ])
      : [[], [], [], []];
  const total = results.length + projectHits.length + messageHits.length + knowledgeHits.length + fileHits.length;

  const field = "rounded border px-2 py-1 text-sm";
  const sectionTitle = "mb-1 mt-4 text-[13px] font-semibold text-neutral-700";
  const rowCls = "flex items-center gap-3 border-b border-neutral-200 py-2 text-sm hover:bg-neutral-50";
  return (
    <div className="p-6">
      <h1 className="text-lg font-bold">検索</h1>
      {q === "" && searchHistory.length > 0 && (
        <div data-search-history className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-neutral-600">
          <span className="font-medium text-neutral-500">最近の検索</span>
          {searchHistory.map((item) => (
            <Link
              key={item}
              href={`/search?q=${encodeURIComponent(item)}`}
              data-search-history-item={item}
              className="rounded-full border border-neutral-200 px-2.5 py-1 hover:bg-neutral-50"
            >
              {item}
            </Link>
          ))}
          <SearchHistoryClear />
        </div>
      )}
      <form method="GET" action="/search" className="mt-3 max-w-5xl text-sm">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            キーワード
            <input name="q" defaultValue={q} placeholder="名前・説明" className={`${field} w-48`} />
          </label>
          <label className="flex flex-col gap-1">
            プロジェクト
            <select name="project" defaultValue={projectRaw} className={field}>
              <option value="">すべて</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            担当者
            <select name="assignee" defaultValue={assigneeRaw} className={field}>
              <option value="">すべて</option>
              <option value="none">未割当</option>
              {users.map((user) => (
                <option key={user.id} value={user.id} data-search-assignee-option={user.id}>
                  {user.name}
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
            Status
            <select name="status" defaultValue={f.status ?? ""} className={field}>
              <option value="">すべて</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        </div>

        <details className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50/60 px-3 py-2" open>
          <summary className="cursor-pointer text-[12px] font-medium text-neutral-700">日付条件</summary>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[12px] text-neutral-600">
              期日（自）
              <input type="date" name="from" defaultValue={f.dueFrom ?? ""} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-neutral-600">
              期日（至）
              <input type="date" name="to" defaultValue={f.dueTo ?? ""} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-neutral-600">
              作成日（自）
              <input type="date" name="created_from" defaultValue={f.createdFrom ?? ""} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-neutral-600">
              作成日（至）
              <input type="date" name="created_to" defaultValue={f.createdTo ?? ""} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-neutral-600">
              完了日（自）
              <input type="date" name="completed_from" defaultValue={f.completedFrom ?? ""} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-neutral-600">
              完了日（至）
              <input type="date" name="completed_to" defaultValue={f.completedTo ?? ""} className={field} />
            </label>
          </div>
        </details>

        {customFields.length > 0 && (
          <details className="mt-2 rounded-lg border border-neutral-200 px-3 py-2" open>
            <summary className="cursor-pointer text-[12px] font-medium text-neutral-700">カスタムフィールド</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {customFields.map((customField) => (
                <label key={customField.id} className="flex min-w-0 flex-col gap-1 text-[12px] text-neutral-600">
                  <span className="truncate" title={`${customField.project_name} / ${customField.name}`}>
                    {customField.name}
                  </span>
                  {customField.field_type === "select" ? (
                    <select name={`cf_${customField.id}`} defaultValue={str(sp, `cf_${customField.id}`)} className={field}>
                      <option value="">すべて</option>
                      {customField.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      name={`cf_${customField.id}`}
                      defaultValue={str(sp, `cf_${customField.id}`)}
                      type={customField.field_type === "number" ? "number" : "text"}
                      className={field}
                    />
                  )}
                </label>
              ))}
            </div>
          </details>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button type="submit" className="rounded bg-blue-600 px-4 py-1.5 text-white hover:bg-blue-700">
            検索
          </button>
          <Link href="/search" className="text-[12px] text-neutral-500 hover:text-neutral-800">
            条件をクリア
          </Link>
        </div>
      </form>

      {ws && <SavedSearchBar workspaceId={ws.id} saved={savedSearches} />}

      {searched && <p className="mt-3 text-sm text-neutral-500">{total}件</p>}
      <div className="mt-1 max-w-5xl">
        {results.length > 0 && (
          <div data-search-section="tasks">
            {q !== "" && <div className={sectionTitle}>タスク（{results.length}）</div>}
            {results.map((task) => (
              <div key={task.id} className={rowCls}>
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    task.completed ? "border-green-700 bg-green-700 text-white" : "border-neutral-400"
                  }`}
                >
                  {task.completed && "✓"}
                </span>
                <Link
                  href={`/projects/${task.project_id}?view=list&task=${task.id}`}
                  className={`min-w-0 flex-1 truncate hover:underline ${task.completed ? "text-neutral-500 line-through" : ""}`}
                >
                  {task.name}
                </Link>
                <span className="hidden w-32 shrink-0 truncate text-xs text-neutral-500 md:inline">
                  {task.project_name}
                </span>
                <span className="hidden w-24 shrink-0 truncate text-xs text-neutral-500 md:inline">
                  {task.assignee_name ?? "–"}
                </span>
                <span className="w-24 shrink-0 text-neutral-600">{task.due_on ?? "–"}</span>
              </div>
            ))}
          </div>
        )}

        {projectHits.length > 0 && (
          <div data-search-section="projects">
            <div className={sectionTitle}>プロジェクト（{projectHits.length}）</div>
            {projectHits.map((project) => (
              <div key={project.id} className={rowCls}>
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-[10px] font-bold"
                  style={{ backgroundColor: project.color ?? "#f1bd6c", color: "#171717" }}
                >
                  {project.name.slice(0, 1)}
                </span>
                <Link
                  href={`/projects/${project.id}?view=list`}
                  className="min-w-0 flex-1 truncate font-medium hover:underline"
                >
                  {project.name}
                </Link>
                <span className="w-20 shrink-0 text-right text-xs text-neutral-500">プロジェクト</span>
              </div>
            ))}
          </div>
        )}

        {messageHits.length > 0 && (
          <div data-search-section="messages">
            <div className={sectionTitle}>メッセージ（{messageHits.length}）</div>
            {messageHits.map((message) => (
              <div key={message.id} className={rowCls}>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-blue-100 text-[10px] text-blue-800">
                  M
                </span>
                <Link
                  href={`/projects/${message.project_id}?view=messages`}
                  className="min-w-0 flex-1 hover:underline"
                >
                  <span className="block truncate font-medium">{message.title || "(件名なし)"}</span>
                  <span className="block truncate text-xs text-neutral-500">{message.body}</span>
                </Link>
                <span className="hidden w-32 shrink-0 truncate text-xs text-neutral-500 md:inline">
                  {message.project_name}
                </span>
              </div>
            ))}
          </div>
        )}

        {knowledgeHits.length > 0 && (
          <div data-search-section="knowledge">
            <div className={sectionTitle}>知識（{knowledgeHits.length}）</div>
            {knowledgeHits.map((note) => (
              <div key={note.id} className={rowCls}>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-amber-100 text-[10px] text-amber-800">
                  K
                </span>
                <Link
                  href={`/projects/${note.project_id}?view=knowledge`}
                  className="min-w-0 flex-1 hover:underline"
                >
                  <span className="block truncate font-medium">{note.title}</span>
                  <span className="block truncate text-xs text-neutral-500">{note.body}</span>
                </Link>
                <span className="hidden w-32 shrink-0 truncate text-xs text-neutral-500 md:inline">
                  {note.project_name}
                </span>
              </div>
            ))}
          </div>
        )}

        {fileHits.length > 0 && (
          <div data-search-section="files">
            <div className={sectionTitle}>ファイル（{fileHits.length}）</div>
            {fileHits.map((file) => (
              <div key={file.id} className={rowCls}>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-neutral-100 text-[10px] text-neutral-700">
                  F
                </span>
                <Link
                  href={`/projects/${file.project_id}?view=list&task=${file.task_id}`}
                  className="min-w-0 flex-1 hover:underline"
                >
                  <span className="block truncate font-medium">{file.file_name}</span>
                  <span className="block truncate text-xs text-neutral-500">{file.task_name} / {file.project_name}</span>
                </Link>
                <span className="w-20 shrink-0 text-right text-xs text-neutral-500">ファイル</span>
              </div>
            ))}
          </div>
        )}

        {searched && total === 0 && (
          <div data-search-empty className="rounded-lg border border-dashed border-neutral-200 px-4 py-10 text-center text-[13px] text-neutral-500">
            条件に一致する結果はありません。
          </div>
        )}
      </div>
    </div>
  );
}
