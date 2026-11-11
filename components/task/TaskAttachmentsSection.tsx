"use client";

import type { Attachment } from "@/lib/data";
import AttachmentPreview from "../AttachmentPreview";
import TaskSectionHeading from "./TaskSectionHeading";

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Attachments list, preview and uploader inside the task pane. */
export default function TaskAttachmentsSection({
  attachments,
  uploading,
  onUpload,
  onDelete,
  canEdit = true,
}: {
  attachments: Attachment[];
  uploading: boolean;
  onUpload: (file: File) => void;
  onDelete: (id: number) => void;
  canEdit?: boolean;
}) {
  return (
    <section className="mt-5" data-task-attachments>
      <TaskSectionHeading
        title="添付"
        count={attachments.length}
        action={
          canEdit ? <label
            className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded text-[16px] ${
              uploading
                ? "cursor-wait text-neutral-300"
                : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
            }`}
            title={uploading ? "アップロード中…" : "添付を追加"}
          >
            ＋
            <input
              type="file"
              className="hidden"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUpload(file);
                event.target.value = "";
              }}
            />
          </label> : undefined
        }
      />

      {attachments.length === 0 ? (
        canEdit ? <label className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-1 text-[13px] text-neutral-400 hover:bg-neutral-50 hover:text-neutral-600">
          <span className="text-base leading-none">＋</span>
          <span>{uploading ? "アップロード中…" : "添付を追加"}</span>
          <input
            type="file"
            className="hidden"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUpload(file);
              event.target.value = "";
            }}
          />
        </label> : <p className="px-1 text-[13px] text-neutral-500">添付はありません</p>
      ) : (
        <div className="space-y-1">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              data-attachment-id={attachment.id}
              className="group/att rounded-md border border-neutral-200 px-2.5 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-neutral-100 text-neutral-500">
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6z" />
                    <path d="M9 2v4h4" />
                  </svg>
                </span>
                <a
                  href={`/api/attachments/${attachment.id}`}
                  className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-800 hover:text-blue-700 hover:underline"
                  title={attachment.file_name}
                >
                  {attachment.file_name}
                </a>
                {canEdit && <button
                  type="button"
                  onClick={() => onDelete(attachment.id)}
                  className="invisible shrink-0 rounded px-1 text-[12px] text-neutral-400 hover:bg-neutral-100 hover:text-red-600 group-hover/att:visible"
                  title="添付を削除"
                  aria-label={`${attachment.file_name} を削除`}
                >
                  ×
                </button>}
              </div>
              <div className="mt-0.5 flex items-center gap-2 pl-9 text-[10px] text-neutral-400">
                <span>{formatSize(attachment.size_bytes)}</span>
                {attachment.author_name && <span>{attachment.author_name}</span>}
                <span>{attachment.created_at.slice(0, 16).replace("T", " ")}</span>
              </div>
              <div className="mt-1 pl-9">
                <AttachmentPreview id={attachment.id} mime={attachment.mime_type} name={attachment.file_name} />
              </div>
            </div>
          ))}
          {canEdit && <label className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-1 text-[12px] text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700">
            <span className="text-sm leading-none">＋</span>
            {uploading ? "アップロード中…" : "ファイルを追加"}
            <input
              type="file"
              className="hidden"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUpload(file);
                event.target.value = "";
              }}
            />
          </label>}
        </div>
      )}
    </section>
  );
}
