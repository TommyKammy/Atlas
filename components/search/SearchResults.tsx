import Link from "next/link";
import type {
  AdvancedTaskHit,
  GlobalFileHit,
  GlobalKnowledgeHit,
  GlobalMessageHit,
  GlobalProjectHit,
} from "@/lib/repositories/search";
import { fileHref, knowledgeHref, messageHref, projectHref, taskHref } from "@/lib/search-types";

import { searchPageHref, type SearchPage, type SearchParams, type SearchPageKey } from "@/lib/search-pagination";

const sectionTitle = "mb-1 mt-4 text-[13px] font-semibold text-neutral-700";
const rowCls = "flex items-center gap-3 border-b border-neutral-200 py-2 text-sm hover:bg-neutral-50";

/** Full search result sections used by /search. */
export default function SearchResults({
  searched,
  total,
  tasks,
  projects,
  messages,
  knowledge,
  files,
  pagination,
  searchParams,
}: {
  q: string;
  searched: boolean;
  total: number;
  tasks: AdvancedTaskHit[];
  projects: GlobalProjectHit[];
  messages: GlobalMessageHit[];
  knowledge: GlobalKnowledgeHit[];
  files: GlobalFileHit[];
  pagination: Record<"tasks" | "projects" | "messages" | "knowledge" | "files", Omit<SearchPage<unknown>, "items">>;
  searchParams: SearchParams;
}) {
  return (
    <div className="mt-1 max-w-5xl">
      {tasks.length > 0 && (
        <div id="search-tasks" data-search-section="tasks" data-search-section-total={pagination.tasks.total}>
          <div className={sectionTitle}>タスク（{pagination.tasks.total}件）</div>
          {tasks.map((task) => (
            <div key={task.id} data-search-result-id={task.id} className={rowCls}>
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  task.completed ? "border-green-700 bg-green-700 text-white" : "border-neutral-400"
                }`}
              >
                {task.completed && "✓"}
              </span>
              <Link
                href={taskHref(task)}
                className={`min-w-0 flex-1 truncate hover:underline ${task.completed ? "text-muted line-through" : ""}`}
              >
                {task.name}
              </Link>
              <span className="hidden w-32 shrink-0 truncate text-xs text-muted md:inline">
                {task.project_name}
              </span>
              <span className="hidden w-24 shrink-0 truncate text-xs text-muted md:inline">
                {task.assignee_name ?? "–"}
              </span>
              <span className="w-24 shrink-0 text-secondary">{task.due_on ?? "–"}</span>
            </div>
          ))}
          <SearchPager page={pagination.tasks} pageKey="tasks_page" params={searchParams} label="タスク" />
        </div>
      )}

      {projects.length > 0 && (
        <div id="search-projects" data-search-section="projects" data-search-section-total={pagination.projects.total}>
          <div className={sectionTitle}>プロジェクト（{pagination.projects.total}件）</div>
          {projects.map((project) => (
            <div key={project.id} data-search-result-id={project.id} className={rowCls}>
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-[10px] font-bold"
                style={{ backgroundColor: project.color ?? "#f1bd6c", color: "#171717" }}
              >
                {project.name.slice(0, 1)}
              </span>
              <Link href={projectHref(project)} className="min-w-0 flex-1 truncate font-medium hover:underline">
                {project.name}
              </Link>
              <span className="w-20 shrink-0 text-right text-xs text-muted">プロジェクト</span>
            </div>
          ))}
          <SearchPager page={pagination.projects} pageKey="projects_page" params={searchParams} label="プロジェクト" />
        </div>
      )}

      {messages.length > 0 && (
        <div id="search-messages" data-search-section="messages" data-search-section-total={pagination.messages.total}>
          <div className={sectionTitle}>メッセージ（{pagination.messages.total}件）</div>
          {messages.map((message) => (
            <div key={message.id} data-search-result-id={message.id} className={rowCls}>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-blue-100 text-[10px] text-blue-800">
                M
              </span>
              <Link href={messageHref(message)} className="min-w-0 flex-1 hover:underline">
                <span className="block truncate font-medium">{message.title || "(件名なし)"}</span>
                <span className="block truncate text-xs text-muted">{message.body}</span>
              </Link>
              <span className="hidden w-32 shrink-0 truncate text-xs text-muted md:inline">
                {message.project_name}
              </span>
            </div>
          ))}
          <SearchPager page={pagination.messages} pageKey="messages_page" params={searchParams} label="メッセージ" />
        </div>
      )}

      {knowledge.length > 0 && (
        <div id="search-knowledge" data-search-section="knowledge" data-search-section-total={pagination.knowledge.total}>
          <div className={sectionTitle}>知識（{pagination.knowledge.total}件）</div>
          {knowledge.map((note) => (
            <div key={note.id} data-search-result-id={note.id} className={rowCls}>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-amber-100 text-[10px] text-warning">
                K
              </span>
              <Link href={knowledgeHref(note)} className="min-w-0 flex-1 hover:underline">
                <span className="block truncate font-medium">{note.title}</span>
                <span className="block truncate text-xs text-muted">{note.body}</span>
              </Link>
              <span className="hidden w-32 shrink-0 truncate text-xs text-muted md:inline">
                {note.project_name}
              </span>
            </div>
          ))}
          <SearchPager page={pagination.knowledge} pageKey="knowledge_page" params={searchParams} label="知識" />
        </div>
      )}

      {files.length > 0 && (
        <div id="search-files" data-search-section="files" data-search-section-total={pagination.files.total}>
          <div className={sectionTitle}>ファイル（{pagination.files.total}件）</div>
          {files.map((file) => (
            <div key={file.id} data-search-result-id={file.id} className={rowCls}>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-surface-muted text-[10px] text-neutral-700">
                F
              </span>
              <Link href={fileHref(file)} className="min-w-0 flex-1 hover:underline">
                <span className="block truncate font-medium">{file.file_name}</span>
                <span className="block truncate text-xs text-muted">
                  {file.task_name} / {file.project_name}
                </span>
              </Link>
              <span className="w-20 shrink-0 text-right text-xs text-muted">ファイル</span>
            </div>
          ))}
          <SearchPager page={pagination.files} pageKey="files_page" params={searchParams} label="ファイル" />
        </div>
      )}

      {searched && total === 0 && (
        <div data-search-empty className="rounded-lg border border-dashed border-neutral-200 px-4 py-10 text-center text-[13px] text-muted">
          条件に一致する結果はありません。
        </div>
      )}
    </div>
  );
}

function SearchPager({ page, pageKey, params, label }: {
  page: Omit<SearchPage<unknown>, "items">;
  pageKey: SearchPageKey;
  params: SearchParams;
  label: string;
}) {
  const from = (page.page - 1) * page.pageSize + 1;
  const to = Math.min(page.page * page.pageSize, page.total);
  const linkClass = "rounded border border-neutral-200 px-3 py-1 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-blue-600";
  return (
    <nav data-search-pagination={pageKey} aria-label={`${label}の検索結果ページ`} className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-secondary">
      <span data-search-range>{from}–{to} / {page.total}件</span>
      {page.pageCount > 1 && <span data-search-current-page>{page.page} / {page.pageCount}ページ</span>}
      {page.page > 1 && <Link prefetch={false} href={searchPageHref(params, pageKey, page.page - 1)} data-search-page="previous" className={linkClass}>前へ<span className="sr-only">（{label}）</span></Link>}
      {page.page < page.pageCount && <Link prefetch={false} href={searchPageHref(params, pageKey, page.page + 1)} data-search-page="next" className={linkClass}>次へ<span className="sr-only">（{label}）</span></Link>}
    </nav>
  );
}
