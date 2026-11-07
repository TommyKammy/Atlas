"use client";

import type { Attachment } from "@/lib/data";
import AttachmentPreview from "../AttachmentPreview";

/** Attachments list, preview and uploader inside the task pane. */
export default function TaskAttachmentsSection({
  attachments,
  uploading,
  onUpload,
  onDelete,
}: {
  attachments: Attachment[];
  uploading: boolean;
  onUpload: (file: File) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="mt-4">
      <div className="mb-1 text-sm text-neutral-500">添付ファイル（{attachments.length}）</div>
      {attachments.map((a) => (
        <div key={a.id} className="border-b py-1.5 text-sm">
          <div className="flex items-center gap-2">
            <a href={`/api/attachments/${a.id}`} className="min-w-0 flex-1 truncate text-blue-700 hover:underline">
              {a.file_name}
            </a>
            <button
              onClick={() => onDelete(a.id)}
              className="text-neutral-500 hover:text-red-600"
              title="添付を削除"
            >
              ×
            </button>
          </div>
          <div className="mt-1">
            <AttachmentPreview id={a.id} mime={a.mime_type} name={a.file_name} />
          </div>
        </div>
      ))}
      <label className="mt-1 inline-block cursor-pointer rounded border px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-50">
        {uploading ? "アップロード中…" : "＋ ファイルを選択"}
        <input
          type="file"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}
