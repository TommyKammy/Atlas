"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { toast } from "@/lib/ui-feedback";
import Dialog from "../ui/Dialog";
import { PROJECT_DIALOG_SECONDARY } from "./RenameProjectDialog";

const CONSEQUENCES = [
  "このプロジェクト内だけに存在するタスクとサブタスク",
  "このプロジェクト限定のカスタムフィールドと値",
  "このプロジェクトのオートメーション、フォーム、タスクテンプレート",
  "このプロジェクトの読み取り専用リンク",
];

export default function DeleteProjectDialog({
  projectId,
  projectName,
  onClose,
  onDeleted,
}: {
  projectId: number;
  projectName: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const matches = confirmName.trim() === projectName;

  const submit = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/projects/${projectId}/trash`, "POST");
      toast("プロジェクトを削除済みに移動しました");
      onDeleted();
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
      title="プロジェクトを削除"
      backdropClassName="fixed inset-0 z-[100] flex items-center justify-center bg-black/25 p-4"
      panelClassName="w-[min(540px,94vw)] rounded-xl bg-white text-sm shadow-2xl"
    >
      <div data-project-delete-dialog className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#b42318]">プロジェクトを削除しますか？</h2>
            <p className="mt-0.5 text-xs text-neutral-500">{projectName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-xl leading-none text-neutral-400 hover:text-neutral-700">
            ×
          </button>
        </div>
        <p className="mt-4 text-neutral-700">
          「{projectName}」を削除済みに移動します。次のデータがプロジェクトと一緒に非表示になります。
        </p>
        <ul className="mt-2 space-y-1 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-xs text-neutral-600">
          {CONSEQUENCES.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="text-neutral-400">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-neutral-500">
          他のプロジェクトにも属しているタスクは削除されず、他のプロジェクトに残ります。削除済みページから復元できます。
        </p>
        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-neutral-600">
            確認のためプロジェクト名「{projectName}」を入力してください
          </span>
          <input
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
            className="h-9 w-full rounded-md border border-neutral-300 px-2.5 text-sm outline-none focus:border-[#b42318] focus:ring-2 focus:ring-[#b42318]/20"
            placeholder={projectName}
          />
        </label>
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={PROJECT_DIALOG_SECONDARY} onClick={onClose} disabled={busy}>
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!matches || busy}
            className="flex h-8 items-center rounded-md bg-[#c94848] px-3 text-sm font-medium text-white hover:bg-[#b83c3c] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "削除中…" : "プロジェクトを削除"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
