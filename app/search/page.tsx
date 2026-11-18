import { getSearchCustomFields, searchTasksAdvanced, searchProjectsGlobal, searchMessagesGlobal, searchKnowledgeGlobal, searchFilesGlobal } from "@/lib/services/authorized-data";
import Link from "next/link";
import {
  getProjectsForUser,
  getSavedSearches,
  getSearchUsers,
  getSearchHistory,
  getWorkspace,
} from "@/lib/data";
import { getCurrentUserId } from "@/lib/current-user";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { recordSearchHistoryAtBoundary } from "@/lib/search-history";
import SavedSearchBar from "@/components/SavedSearchBar";
import SearchHistoryClear from "@/components/SearchHistoryClear";
import SearchResults from "@/components/search/SearchResults";
import { emptySearchPage, parseSearchPage, searchDateParam, SEARCH_QUERY_LIMIT } from "@/lib/search-pagination";

export const instant = false;

function str(sp: { [key: string]: string | string[] | undefined }, key: string): string {
  const v = sp[key];
  return typeof v === "string" ? v : "";
}

function idParam(value: string): number | null {
  const id = /^\d+$/.test(value) ? Number(value) : 0;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export default async function SearchPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await props.searchParams;
  const ws = await getWorkspace();
  const viewerId = await getCurrentUserId();
  if (!viewerId) redirect("/login");
  const q = str(sp, "q").trim().slice(0, SEARCH_QUERY_LIMIT);
  if (q !== "") {
    after(() => recordSearchHistoryAtBoundary(viewerId, q).catch(() => undefined));
  }
  const [projects, users, customFields, savedSearches, searchHistory] = ws
    ? await Promise.all([
        getProjectsForUser(ws.id, viewerId),
        getSearchUsers(ws.id, viewerId),
        getSearchCustomFields(ws.id, { userId: viewerId }),
        getSavedSearches(ws.id, viewerId),
        getSearchHistory(viewerId),
      ])
    : [[], [], [], [], []];

  const projectRaw = str(sp, "project");
  const assigneeRaw = str(sp, "assignee");
  const completedRaw = str(sp, "completed");
  const statusRaw = str(sp, "status");
  const statusOptions = [...new Set(projects.flatMap((project) => project.status_options ?? []))].sort((a, b) =>
    a.localeCompare(b, "ja"),
  );
  const custom = customFields
    .map((field) => ({ fieldId: field.id, value: str(sp, `cf_${field.id}`).trim().slice(0, 2000), type: field.field_type }))
    .filter((entry) => entry.value !== "");
  const f = {
    q,
    projectId: idParam(projectRaw),
    assigneeId: assigneeRaw === "none" ? ("none" as const) : idParam(assigneeRaw),
    completed: (completedRaw === "open" || completedRaw === "done" ? completedRaw : "all") as
      | "all"
      | "open"
      | "done",
    status: statusRaw !== "" ? statusRaw.slice(0, 200) : null,
    dueFrom: searchDateParam(str(sp, "from")),
    dueTo: searchDateParam(str(sp, "to")),
    createdFrom: searchDateParam(str(sp, "created_from")),
    createdTo: searchDateParam(str(sp, "created_to")),
    completedFrom: searchDateParam(str(sp, "completed_from")),
    completedTo: searchDateParam(str(sp, "completed_to")),
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
  const [taskPage, projectPage, messagePage, knowledgePage, filePage] = await Promise.all([
    ws && searched ? searchTasksAdvanced(ws.id, f, { userId: viewerId }, { page: parseSearchPage(sp.tasks_page), pageSize: 100 }) : emptySearchPage<never>(100),
    ws && q !== "" ? searchProjectsGlobal(ws.id, q, { userId: viewerId }, { page: parseSearchPage(sp.projects_page), pageSize: 20 }) : emptySearchPage<never>(20),
    ws && q !== "" ? searchMessagesGlobal(ws.id, q, { userId: viewerId }, { page: parseSearchPage(sp.messages_page), pageSize: 20 }) : emptySearchPage<never>(20),
    ws && q !== "" ? searchKnowledgeGlobal(ws.id, q, { userId: viewerId }, { page: parseSearchPage(sp.knowledge_page), pageSize: 20 }) : emptySearchPage<never>(20),
    ws && q !== "" ? searchFilesGlobal(ws.id, q, { userId: viewerId }, { page: parseSearchPage(sp.files_page), pageSize: 20 }) : emptySearchPage<never>(20),
  ]);
  const total = taskPage.total + projectPage.total + messagePage.total + knowledgePage.total + filePage.total;
  const searchParams = { ...sp, q };
  const pagination = { tasks: taskPage, projects: projectPage, messages: messagePage, knowledge: knowledgePage, files: filePage };

  const field = "rounded border px-2 py-1 text-sm";
  return (
    <div className="p-6">
      <h1 className="text-lg font-bold">検索</h1>
      {str(sp, "q").trim().length > SEARCH_QUERY_LIMIT && (
        <p role="status" className="mt-2 text-[12px] text-warning">キーワードは先頭{SEARCH_QUERY_LIMIT}文字で検索しています。</p>
      )}
      {q === "" && searchHistory.length > 0 && (
        <div data-search-history className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-secondary">
          <span className="font-medium text-muted">最近の検索</span>
          {searchHistory.map((item) => (
            <Link
              key={item}
              href={`/search?q=${encodeURIComponent(item)}`}
              data-search-history-item={item}
              className="rounded-full border border-line px-2.5 py-1 hover:bg-hover"
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
            <input name="q" maxLength={SEARCH_QUERY_LIMIT} defaultValue={q} placeholder="名前・説明" className={`${field} w-48`} />
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

        <details className="mt-3 rounded-lg border border-line bg-surface-subtle px-3 py-2" open>
          <summary className="cursor-pointer text-[12px] font-medium text-secondary">日付条件</summary>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[12px] text-secondary">
              期日（自）
              <input type="date" name="from" defaultValue={f.dueFrom ?? ""} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-secondary">
              期日（至）
              <input type="date" name="to" defaultValue={f.dueTo ?? ""} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-secondary">
              作成日（自）
              <input type="date" name="created_from" defaultValue={f.createdFrom ?? ""} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-secondary">
              作成日（至）
              <input type="date" name="created_to" defaultValue={f.createdTo ?? ""} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-secondary">
              完了日（自）
              <input type="date" name="completed_from" defaultValue={f.completedFrom ?? ""} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-secondary">
              完了日（至）
              <input type="date" name="completed_to" defaultValue={f.completedTo ?? ""} className={field} />
            </label>
          </div>
        </details>

        {customFields.length > 0 && (
          <details className="mt-2 rounded-lg border border-line px-3 py-2" open>
            <summary className="cursor-pointer text-[12px] font-medium text-secondary">カスタムフィールド</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {customFields.map((customField) => (
                <label key={customField.id} className="flex min-w-0 flex-col gap-1 text-[12px] text-secondary">
                  <span className="truncate" title={`${customField.project_name} / ${customField.name}`}>
                    {customField.name}
                  </span>
                  {(customField.field_type === "select" || customField.field_type === "multi_select") ? (
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
                      type={customField.field_type === "number" ? "number" : customField.field_type === "date" ? "date" : "text"}
                      className={field}
                    />
                  )}
                </label>
              ))}
            </div>
          </details>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button type="submit" className="rounded bg-accent px-4 py-1.5 text-on-accent hover:bg-accent-hover">
            検索
          </button>
          <Link href="/search" className="text-[12px] text-muted hover:text-text">
            条件をクリア
          </Link>
        </div>
      </form>

      {ws && <SavedSearchBar workspaceId={ws.id} saved={savedSearches} />}

      {searched && <p data-search-total={total} className="mt-3 text-sm text-muted">合計 {total}件</p>}
      {searched && q !== "" && <p className="mt-1 text-[12px] text-muted">プロジェクト・メッセージ・知識・ファイルはキーワードで検索します。その他の絞り込み条件はタスクに適用されます。</p>}
      <SearchResults
        q={q}
        searched={searched}
        total={total}
        tasks={taskPage.items}
        projects={projectPage.items}
        messages={messagePage.items}
        knowledge={knowledgePage.items}
        files={filePage.items}
        pagination={pagination}
        searchParams={searchParams}
      />

    </div>
  );
}
