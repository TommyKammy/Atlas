import Link from "next/link";
import type {
  AdvancedTaskHit,
  GlobalFileHit,
  GlobalKnowledgeHit,
  GlobalMessageHit,
  GlobalProjectHit,
} from "@/lib/repositories/search";
import { fileHref, knowledgeHref, messageHref, projectHref, taskHref } from "@/lib/search-types";

const sectionTitle = "mb-1 mt-4 text-[13px] font-semibold text-neutral-700";
const rowCls = "flex items-center gap-3 border-b border-neutral-200 py-2 text-sm hover:bg-neutral-50";

/** Full search result sections used by /search. */
export default function SearchResults({
  q,
  searched,
  total,
  tasks,
  projects,
  messages,
  knowledge,
  files,
}: {
  q: string;
  searched: boolean;
  total: number;
  tasks: AdvancedTaskHit[];
  projects: GlobalProjectHit[];
  messages: GlobalMessageHit[];
  knowledge: GlobalKnowledgeHit[];
  files: GlobalFileHit[];
}) {
  return (
    <div className="mt-1 max-w-5xl">
      {tasks.length > 0 && (
        <div data-search-section="tasks">
          {q !== "" && <div className={sectionTitle}>タスク（{tasks.length}）</div>}
          {tasks.map((task) => (
            <div key={task.id} className={rowCls}>
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  task.completed ? "border-green-700 bg-green-700 text-white" : "border-neutral-400"
                }`}
              >
                {task.completed && "✓"}
              </span>
              <Link
                href={taskHref(task)}
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

      {projects.length > 0 && (
        <div data-search-section="projects">
          <div className={sectionTitle}>プロジェクト（{projects.length}）</div>
          {projects.map((project) => (
            <div key={project.id} className={rowCls}>
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-[10px] font-bold"
                style={{ backgroundColor: project.color ?? "#f1bd6c", color: "#171717" }}
              >
                {project.name.slice(0, 1)}
              </span>
              <Link href={projectHref(project)} className="min-w-0 flex-1 truncate font-medium hover:underline">
                {project.name}
              </Link>
              <span className="w-20 shrink-0 text-right text-xs text-neutral-500">プロジェクト</span>
            </div>
          ))}
        </div>
      )}

      {messages.length > 0 && (
        <div data-search-section="messages">
          <div className={sectionTitle}>メッセージ（{messages.length}）</div>
          {messages.map((message) => (
            <div key={message.id} className={rowCls}>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-blue-100 text-[10px] text-blue-800">
                M
              </span>
              <Link href={messageHref(message)} className="min-w-0 flex-1 hover:underline">
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

      {knowledge.length > 0 && (
        <div data-search-section="knowledge">
          <div className={sectionTitle}>知識（{knowledge.length}）</div>
          {knowledge.map((note) => (
            <div key={note.id} className={rowCls}>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-amber-100 text-[10px] text-amber-800">
                K
              </span>
              <Link href={knowledgeHref(note)} className="min-w-0 flex-1 hover:underline">
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

      {files.length > 0 && (
        <div data-search-section="files">
          <div className={sectionTitle}>ファイル（{files.length}）</div>
          {files.map((file) => (
            <div key={file.id} className={rowCls}>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-neutral-100 text-[10px] text-neutral-700">
                F
              </span>
              <Link href={fileHref(file)} className="min-w-0 flex-1 hover:underline">
                <span className="block truncate font-medium">{file.file_name}</span>
                <span className="block truncate text-xs text-neutral-500">
                  {file.task_name} / {file.project_name}
                </span>
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
  );
}
