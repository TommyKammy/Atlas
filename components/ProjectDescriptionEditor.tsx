"use client";

import { toast as toastMessage } from "@/lib/ui-feedback";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { renderMarkdown } from "@/lib/markdown";

export default function ProjectDescriptionEditor({
  projectId,
  initial,
  canEdit,
  heading = "プロジェクトの説明",
  className = "mt-6",
}: {
  projectId: number;
  initial: string;
  canEdit: boolean;
  heading?: string;
  className?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: value }),
      });
      if (!res.ok) {
        toastMessage(`説明の保存に失敗しました: ${res.status}`);
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id="description" data-project-description className={className}>
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">{heading}</h2>
        {canEdit && !editing && (
          <button
            type="button"
            data-project-description-edit
            onClick={() => {
              setValue(initial);
              setEditing(true);
            }}
            className="text-[12px] text-muted hover:underline"
          >
            編集
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-2">
          <textarea
            data-project-description-input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={4}
            placeholder="プロジェクトの目的、背景、決定事項を入力（Markdown可）"
            className="w-full rounded-md border border-field-line px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded px-3 py-1 text-sm text-secondary hover:bg-hover"
            >
              キャンセル
            </button>
            <button
              type="button"
              data-project-description-save
              disabled={saving}
              onClick={() => void save()}
              className="rounded bg-accent px-4 py-1 text-sm text-on-accent hover:bg-accent-hover disabled:opacity-50"
            >
              保存
            </button>
          </div>
        </div>
      ) : initial ? (
        <div
          data-project-description-body
          onClick={() => {
            if (canEdit) {
              setValue(initial);
              setEditing(true);
            }
          }}
          className={`prose-sm mt-2 max-w-none text-sm text-secondary [&_a]:text-accent-text [&_code]:rounded [&_code]:bg-surface-muted [&_code]:px-1 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5 ${
            canEdit ? "cursor-text rounded p-2 hover:bg-hover" : ""
          }`}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(initial) }}
        />
      ) : (
        <button
          type="button"
          data-project-description-empty
          disabled={!canEdit}
          onClick={() => {
            if (!canEdit) return;
            setValue("");
            setEditing(true);
          }}
          className="mt-2 w-full rounded-md border border-dashed border-line px-3 py-4 text-left text-sm text-muted hover:bg-hover disabled:cursor-default"
        >
          プロジェクトの説明を追加
        </button>
      )}
    </section>
  );
}
