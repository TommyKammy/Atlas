"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import Dialog from "../ui/Dialog";
import { PROJECT_DIALOG_PRIMARY, PROJECT_DIALOG_SECONDARY } from "./RenameProjectDialog";

const OPTIONS = [
  { key: "include_tasks", label: "タスク", description: "タスク名・説明・担当者・期日・進捗・Status をコピーします。" },
  { key: "include_subtasks", label: "サブタスク", description: "サブタスクの階層もコピーします。" },
  { key: "include_completed", label: "完了したタスク", description: "完了済みのタスクも含めます。" },
  { key: "include_fields", label: "カスタムフィールド", description: "フィールド定義と値、編集権限をコピーします。" },
  { key: "include_members", label: "プロジェクトメンバー", description: "メンバーと役割をコピーします。" },
] as const;

type OptionKey = (typeof OPTIONS)[number]["key"];

export default function DuplicateProjectDialog({
  projectId,
  projectName,
  onClose,
  onDuplicated,
}: {
  projectId: number;
  projectName: string;
  onClose: () => void;
  onDuplicated: (id: number) => void;
}) {
  const [name, setName] = useState(`${projectName} のコピー`);
  const [options, setOptions] = useState<Record<OptionKey, boolean>>({
    include_tasks: true,
    include_subtasks: true,
    include_completed: true,
    include_fields: true,
    include_members: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ id: number }>(`/api/projects/${projectId}/duplicate`, "POST", {
        name: name.trim(),
        ...options,
      });
      onDuplicated(result.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="プロジェクトを複製"
      backdropClassName="backdrop:bg-scrim"
      panelClassName="max-h-[90vh] w-[min(580px,94vw)] overflow-y-auto rounded-xl bg-surface text-sm shadow-2xl"
    >
      <div data-project-duplicate-dialog className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">プロジェクトを複製</h2>
            <p className="mt-0.5 text-xs text-muted">{projectName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-xl leading-none text-subtle hover:text-secondary">
            ×
          </button>
        </div>
        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-secondary">プロジェクト名</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            className="h-9 w-full rounded-md border border-field-line px-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-focus-ring/20"
          />
        </label>
        <div className="mt-4 text-xs font-medium text-secondary">コピーする内容</div>
        <div className="mt-2 space-y-1.5">
          {OPTIONS.map((option) => (
            <label
              key={option.key}
              className="flex cursor-pointer items-start gap-2 rounded-md border border-line p-2.5 hover:bg-hover"
            >
              <input
                type="checkbox"
                checked={options[option.key]}
                onChange={(event) =>
                  setOptions((current) => ({ ...current, [option.key]: event.target.checked }))
                }
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium">{option.label}</span>
                <span className="block text-xs text-muted">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-subtle">
          複製先は元のプロジェクトから独立します。オートメーション、フォーム、タブ、コメント、添付、依存関係はコピーされません。
        </p>
        {error && <p className="mt-3 text-xs text-danger">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={PROJECT_DIALOG_SECONDARY} onClick={onClose} disabled={busy}>
            キャンセル
          </button>
          <button type="button" className={PROJECT_DIALOG_PRIMARY} onClick={() => void submit()} disabled={busy || !name.trim()}>
            {busy ? "複製中…" : "複製する"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
