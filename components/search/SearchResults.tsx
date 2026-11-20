import Link from "next/link";
import { PROJECT_INITIAL_BACKGROUND, PROJECT_INITIAL_TEXT } from "@/lib/data-colors";
import type {
  AdvancedTaskHit,
  GlobalFileHit,
  GlobalKnowledgeHit,
  GlobalMessageHit,
  GlobalProjectHit,
} from "@/lib/repositories/search";
import { fileHref, knowledgeHref, messageHref, projectHref, taskHref } from "@/lib/search-types";
import { todayISO } from "@/lib/dates";
import { LIST_ROW_STATE_LABELS, listRowState } from "@/lib/list-row-state";
import DueStateIcon from "@/components/task/DueStateIcon";
import TaskStateIcon from "@/components/task/TaskStateIcon";
import { quietButtonClass } from "@/components/ui/form-controls";

import { searchPageHref, type SearchPage, type SearchParams, type SearchPageKey } from "@/lib/search-pagination";

const rowCls = "flex min-h-[40px] items-center gap-3 border-b border-line-subtle px-1 py-1 hover:bg-hover";

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <h2 className="mt-5 flex items-baseline gap-2 text-[13px] font-semibold text-text">
      {label}
      <span className="text-[12px] font-normal tabular-nums text-muted">{count}件</span>
    </h2>
  );
}

function ResultIcon({ kind }: { kind: "message" | "knowledge" | "file" }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted" aria-hidden="true">
      {kind === "message" ? (
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M2.5 3.5h11v7h-6L4.5 13v-2.5h-2z" strokeLinejoin="round" />
        </svg>
      ) : kind === "knowledge" ? (
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M3 2.5h8.5A1.5 1.5 0 0 1 13 4v9.5H4.5A1.5 1.5 0 0 1 3 12z" strokeLinejoin="round" />
          <path d="M3 11.5h10M5.5 5.5h5M5.5 8h5" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M6 3.5h5.5A1.5 1.5 0 0 1 13 5v7.5H6A2.5 2.5 0 0 1 3.5 10V5A1.5 1.5 0 0 1 5 3.5z" strokeLinejoin="round" />
          <path d="M6 9.5h7" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}

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
  const today = todayISO();
  return (
    <div className="mt-1">
      {tasks.length > 0 && (
        <div id="search-tasks" data-search-section="tasks" data-search-section-total={pagination.tasks.total}>
          <SectionHeading label="タスク" count={pagination.tasks.total} />
          {tasks.map((task) => {
            const state = listRowState({ completed: task.completed, due_on: task.due_on, progress: task.progress }, today);
            const overdue = !task.completed && task.due_on !== null && task.due_on < today;
            const todayDue = !task.completed && task.due_on === today;
            return (
              <div key={task.id} data-search-result-id={task.id} className={rowCls}>
                <span className="flex w-[18px] shrink-0 items-center justify-center">
                  <span className="sr-only">{LIST_ROW_STATE_LABELS[state]}: </span>
                  <TaskStateIcon state={state} />
                </span>
                <Link
                  href={taskHref(task)}
                  className={`min-w-0 flex-1 truncate text-[13px] hover:underline ${
                    task.completed ? "text-muted line-through" : "text-text"
                  }`}
                >
                  {task.name}
                </Link>
                <span className="hidden w-32 shrink-0 truncate text-[12px] text-muted md:inline">
                  {task.project_name}
                </span>
                <span className="hidden w-24 shrink-0 truncate text-[12px] text-muted md:inline">
                  {task.assignee_name ?? "–"}
                </span>
                <span className="w-28 shrink-0 text-right text-[12px] tabular-nums text-muted">
                  {task.due_on ? (
                    <>
                      {overdue && <DueStateIcon state="overdue" className="mr-0.5 align-[-1px] text-danger" />}
                      {todayDue && <DueStateIcon state="today" className="mr-0.5 align-[-1px] text-success" />}
                      {overdue && <span className="sr-only">期限超過: </span>}
                      {todayDue && <span className="sr-only">今日が期日: </span>}
                      {task.due_on}
                    </>
                  ) : (
                    "–"
                  )}
                </span>
              </div>
            );
          })}
          <SearchPager page={pagination.tasks} pageKey="tasks_page" params={searchParams} label="タスク" />
        </div>
      )}

      {projects.length > 0 && (
        <div id="search-projects" data-search-section="projects" data-search-section-total={pagination.projects.total}>
          <SectionHeading label="プロジェクト" count={pagination.projects.total} />
          {projects.map((project) => (
            <div key={project.id} data-search-result-id={project.id} className={rowCls}>
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-[10px] font-bold"
                style={{ backgroundColor: project.color ?? PROJECT_INITIAL_BACKGROUND, color: PROJECT_INITIAL_TEXT }}
                aria-hidden="true"
              >
                {project.name.slice(0, 1)}
              </span>
              <Link href={projectHref(project)} className="min-w-0 flex-1 truncate text-[13px] font-medium text-text hover:underline">
                {project.name}
              </Link>
              <span className="w-20 shrink-0 text-right text-[12px] text-muted">プロジェクト</span>
            </div>
          ))}
          <SearchPager page={pagination.projects} pageKey="projects_page" params={searchParams} label="プロジェクト" />
        </div>
      )}

      {messages.length > 0 && (
        <div id="search-messages" data-search-section="messages" data-search-section-total={pagination.messages.total}>
          <SectionHeading label="メッセージ" count={pagination.messages.total} />
          {messages.map((message) => (
            <div key={message.id} data-search-result-id={message.id} className={rowCls}>
              <ResultIcon kind="message" />
              <Link href={messageHref(message)} className="min-w-0 flex-1 hover:underline">
                <span className="block truncate text-[13px] text-text">{message.title || "(件名なし)"}</span>
                <span className="block truncate text-[12px] text-muted">{message.body}</span>
              </Link>
              <span className="hidden w-32 shrink-0 truncate text-[12px] text-muted md:inline">
                {message.project_name}
              </span>
            </div>
          ))}
          <SearchPager page={pagination.messages} pageKey="messages_page" params={searchParams} label="メッセージ" />
        </div>
      )}

      {knowledge.length > 0 && (
        <div id="search-knowledge" data-search-section="knowledge" data-search-section-total={pagination.knowledge.total}>
          <SectionHeading label="知識" count={pagination.knowledge.total} />
          {knowledge.map((note) => (
            <div key={note.id} data-search-result-id={note.id} className={rowCls}>
              <ResultIcon kind="knowledge" />
              <Link href={knowledgeHref(note)} className="min-w-0 flex-1 hover:underline">
                <span className="block truncate text-[13px] text-text">{note.title}</span>
                <span className="block truncate text-[12px] text-muted">{note.body}</span>
              </Link>
              <span className="hidden w-32 shrink-0 truncate text-[12px] text-muted md:inline">
                {note.project_name}
              </span>
            </div>
          ))}
          <SearchPager page={pagination.knowledge} pageKey="knowledge_page" params={searchParams} label="知識" />
        </div>
      )}

      {files.length > 0 && (
        <div id="search-files" data-search-section="files" data-search-section-total={pagination.files.total}>
          <SectionHeading label="ファイル" count={pagination.files.total} />
          {files.map((file) => (
            <div key={file.id} data-search-result-id={file.id} className={rowCls}>
              <ResultIcon kind="file" />
              <Link href={fileHref(file)} className="min-w-0 flex-1 hover:underline">
                <span className="block truncate text-[13px] text-text">{file.file_name}</span>
                <span className="block truncate text-[12px] text-muted">
                  {file.task_name} / {file.project_name}
                </span>
              </Link>
              <span className="w-20 shrink-0 text-right text-[12px] text-muted">ファイル</span>
            </div>
          ))}
          <SearchPager page={pagination.files} pageKey="files_page" params={searchParams} label="ファイル" />
        </div>
      )}

      {searched && total === 0 && (
        <div data-search-empty className="mt-4 rounded-lg bg-surface-subtle px-4 py-10 text-center text-[13px] text-muted">
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
  return (
    <nav data-search-pagination={pageKey} aria-label={`${label}の検索結果ページ`} className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted">
      <span data-search-range className="tabular-nums">{from}–{to} / {page.total}件</span>
      {page.pageCount > 1 && <span data-search-current-page className="tabular-nums">{page.page} / {page.pageCount}ページ</span>}
      <span className="flex-1" />
      {page.page > 1 && <Link prefetch={false} href={searchPageHref(params, pageKey, page.page - 1)} data-search-page="previous" className={quietButtonClass}>前へ<span className="sr-only">（{label}）</span></Link>}
      {page.page < page.pageCount && <Link prefetch={false} href={searchPageHref(params, pageKey, page.page + 1)} data-search-page="next" className={quietButtonClass}>次へ<span className="sr-only">（{label}）</span></Link>}
    </nav>
  );
}
