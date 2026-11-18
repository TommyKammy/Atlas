"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { toast } from "@/lib/ui-feedback";
import Dialog from "../ui/Dialog";
import { PROJECT_DIALOG_PRIMARY, PROJECT_DIALOG_SECONDARY } from "./RenameProjectDialog";

export default function SaveProjectTemplateDialog({
  projectId,
  projectName,
  onClose,
  onSaved,
}: {
  projectId: number;
  projectName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(projectName);
  const [includeTasks, setIncludeTasks] = useState(true);
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [includeFields, setIncludeFields] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/projects/${projectId}/template`, "POST", {
        name: name.trim(),
        include_tasks: includeTasks,
        include_completed: includeCompleted,
        include_custom_fields: includeFields,
      });
      toast("プロジェクトテンプレートを保存しました");
      onSaved();
      onClose();
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
      title="テンプレートとして保存"
      backdropClassName="backdrop:bg-scrim"
      panelClassName="w-[min(540px,94vw)] rounded-xl bg-surface text-sm shadow-2xl"
    >
      <div data-project-template-dialog className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">テンプレートとして保存</h2>
            <p className="mt-0.5 text-xs text-muted">{projectName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-xl leading-none text-subtle hover:text-secondary">
            ×
          </button>
        </div>
        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-secondary">テンプレートのタイトル</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            className="h-9 w-full rounded-md border border-line-strong px-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-focus-ring/20"
          />
        </label>
        <div className="mt-4 space-y-1.5">
          <label className="flex items-start gap-2 rounded-md border border-line p-2.5">
            <input type="checkbox" checked={includeTasks} onChange={(event) => setIncludeTasks(event.target.checked)} className="mt-0.5" />
            <span>
              <span className="block font-medium">タスクとサブタスク</span>
              <span className="block text-xs text-muted">セクション、タスク名、説明、担当者、期日、Status を保存します。</span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-md border border-line p-2.5">
            <input
              type="checkbox"
              checked={includeCompleted}
              disabled={!includeTasks}
              onChange={(event) => setIncludeCompleted(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="block font-medium">完了したタスクを含める</span>
              <span className="block text-xs text-muted">
                通常、完了済みタスクはテンプレートから除外されます。含める場合、作成時は未完了にリセットされます。
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-md border border-line p-2.5">
            <input type="checkbox" checked={includeFields} onChange={(event) => setIncludeFields(event.target.checked)} className="mt-0.5" />
            <span>
              <span className="block font-medium">カスタムフィールドと値</span>
              <span className="block text-xs text-muted">フィールド定義、選択肢、編集権限、タスクの値を保存します。</span>
            </span>
          </label>
        </div>
        <p className="mt-3 text-xs text-subtle">アプリ、オートメーション、フォーム、ダッシュボードの内容は保存されません。</p>
        {error && <p className="mt-3 text-xs text-danger">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={PROJECT_DIALOG_SECONDARY} onClick={onClose} disabled={busy}>
            キャンセル
          </button>
          <button type="button" className={PROJECT_DIALOG_PRIMARY} onClick={() => void submit()} disabled={busy || !name.trim()}>
            {busy ? "保存中…" : "テンプレートを保存"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
