import { ProjectViewToolbar, ViewAddButton } from "@/components/view/ProjectViewToolbar";
import Link from "next/link";
import type { Attachment } from "@/lib/data";
import AttachmentPreview from "./AttachmentPreview";
import EmptyState from "./EmptyState";

function fmtSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export default function FilesView({
  projectId,
  attachments,
}: {
  projectId: number;
  attachments: Attachment[];
}) {
  return (
    <div className="flex h-full min-h-0 flex-col px-4">
      <ProjectViewToolbar>
        <span title="タスク詳細ペインから添付してください">
          <ViewAddButton disabled aria-describedby="project-files-upload-help">ファイルを追加</ViewAddButton>
        </span>
        <span className="ml-auto text-[12px] text-muted">{attachments.length} 件 · 上限25MB/件</span>
      </ProjectViewToolbar>
      <div data-page-scroll className="min-h-0 flex-1 overflow-auto pb-16">
      <p id="project-files-upload-help" className="my-4 text-[12px] text-muted">ファイルはタスク詳細ペインから添付できます。</p>
      {attachments.length === 0 ? (
        <EmptyState
          scope="files"
          title="まだファイルがありません"
          description="タスク詳細ペインから添付すると、ここに表示されます。"
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {attachments.map((a) => (
            <div key={a.id} className="rounded-lg border bg-surface p-3 hover:shadow-sm">
              <div className="mb-2 flex h-24 items-center justify-center overflow-hidden rounded-md bg-surface-subtle">
                <AttachmentPreview id={a.id} mime={a.mime_type} name={a.file_name} />
              </div>
              <a
                href={`/api/attachments/${a.id}`}
                className="block truncate font-medium text-accent-text hover:underline"
              >
                {a.file_name}
              </a>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                <Link
                  href={`/projects/${projectId}?view=list&task=${a.task_id}`}
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {a.task_name ?? `タスク${a.task_id}`}
                </Link>
                <span className="shrink-0">{fmtSize(a.size_bytes)}</span>
                <span className="shrink-0 truncate">{a.author_name ?? "–"}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
