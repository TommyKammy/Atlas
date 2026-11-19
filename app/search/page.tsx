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
import {
  fieldControlClass,
  fieldLabelClass,
  primaryButtonClass,
  quietButtonClass,
  SelectControl,
} from "@/components/ui/form-controls";
import { pageDescriptionClass, pageShellClass, pageTitleClass } from "@/components/ui/page-layout";

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

  return (
    <div className={pageShellClass}>
      <div className="max-w-5xl">
        <h1 className={pageTitleClass}>検索</h1>
        <p className={pageDescriptionClass}>タスク・プロジェクト・メッセージ・知識・ファイルを横断して検索します。</p>
        {str(sp, "q").trim().length > SEARCH_QUERY_LIMIT && (
          <p role="status" className="mt-2 text-[12px] text-warning">キーワードは先頭{SEARCH_QUERY_LIMIT}文字で検索しています。</p>
        )}
        {q === "" && searchHistory.length > 0 && (
          <div data-search-history className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px] text-secondary">
            <span className="mr-1 font-medium text-muted">最近の検索</span>
            {searchHistory.map((item) => (
              <Link
                key={item}
                href={`/search?q=${encodeURIComponent(item)}`}
                data-search-history-item={item}
                className="inline-flex h-7 items-center rounded-full border border-line px-2.5 text-secondary hover:bg-hover"
              >
                {item}
              </Link>
            ))}
            <SearchHistoryClear />
          </div>
        )}
        <form method="GET" action="/search" data-search-form className="mt-4 text-[13px]">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,0.85fr)]">
            <label className="flex min-w-0 flex-col gap-1">
              <span className={fieldLabelClass}>キーワード</span>
              <input data-search-keyword name="q" maxLength={SEARCH_QUERY_LIMIT} defaultValue={q} placeholder="名前・説明" className={fieldControlClass} />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              <span className={fieldLabelClass}>プロジェクト</span>
              <SelectControl containerClassName="sm:max-w-[240px]" name="project" defaultValue={projectRaw}>
                <option value="">すべて</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </SelectControl>
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              <span className={fieldLabelClass}>担当者</span>
              <SelectControl name="assignee" defaultValue={assigneeRaw}>
                <option value="">すべて</option>
                <option value="none">未割当</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id} data-search-assignee-option={user.id}>
                    {user.name}
                  </option>
                ))}
              </SelectControl>
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              <span className={fieldLabelClass}>状態</span>
              <SelectControl name="completed" defaultValue={f.completed}>
                <option value="all">すべて</option>
                <option value="open">未完了</option>
                <option value="done">完了</option>
              </SelectControl>
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              <span className={fieldLabelClass}>Status</span>
              <SelectControl name="status" defaultValue={f.status ?? ""}>
                <option value="">すべて</option>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </SelectControl>
            </label>
          </div>

          <details className="mt-4" open>
            <summary className="cursor-pointer text-[12px] font-medium text-secondary">日付条件</summary>
            <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-surface-subtle p-3">
              <label className="flex flex-col gap-1">
                <span className={fieldLabelClass}>期日（自）</span>
                <input type="date" name="from" defaultValue={f.dueFrom ?? ""} className={fieldControlClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={fieldLabelClass}>期日（至）</span>
                <input type="date" name="to" defaultValue={f.dueTo ?? ""} className={fieldControlClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={fieldLabelClass}>作成日（自）</span>
                <input type="date" name="created_from" defaultValue={f.createdFrom ?? ""} className={fieldControlClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={fieldLabelClass}>作成日（至）</span>
                <input type="date" name="created_to" defaultValue={f.createdTo ?? ""} className={fieldControlClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={fieldLabelClass}>完了日（自）</span>
                <input type="date" name="completed_from" defaultValue={f.completedFrom ?? ""} className={fieldControlClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={fieldLabelClass}>完了日（至）</span>
                <input type="date" name="completed_to" defaultValue={f.completedTo ?? ""} className={fieldControlClass} />
              </label>
            </div>
          </details>

          {customFields.length > 0 && (
            <details className="mt-3" open>
              <summary className="cursor-pointer text-[12px] font-medium text-secondary">カスタムフィールド</summary>
              <div className="mt-2 grid gap-3 rounded-lg bg-surface-subtle p-3 sm:grid-cols-3">
                {customFields.map((customField) => (
                  <label key={customField.id} className="flex min-w-0 flex-col gap-1">
                    <span className={`${fieldLabelClass} truncate`} title={`${customField.project_name} / ${customField.name}`}>
                      {customField.name}
                    </span>
                    {(customField.field_type === "select" || customField.field_type === "multi_select") ? (
                      <SelectControl name={`cf_${customField.id}`} defaultValue={str(sp, `cf_${customField.id}`)}>
                        <option value="">すべて</option>
                        {customField.options.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </SelectControl>
                    ) : (
                      <input
                        name={`cf_${customField.id}`}
                        defaultValue={str(sp, `cf_${customField.id}`)}
                        type={customField.field_type === "number" ? "number" : customField.field_type === "date" ? "date" : "text"}
                        className={fieldControlClass}
                      />
                    )}
                  </label>
                ))}
              </div>
            </details>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="submit" className={primaryButtonClass}>
              検索
            </button>
            <Link href="/search" className={quietButtonClass}>
              条件をクリア
            </Link>
          </div>
        </form>

        {ws && <SavedSearchBar workspaceId={ws.id} saved={savedSearches} />}

        {searched && <p data-search-total={total} className="mt-5 text-[13px] text-muted">合計 <span className="tabular-nums">{total}</span>件</p>}
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
    </div>
  );
}
