"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import Dialog from "../ui/Dialog";
import { PROJECT_DIALOG_PRIMARY, PROJECT_DIALOG_SECONDARY } from "./RenameProjectDialog";

export default function CreateTableDialog({
  projectId,
  projectName,
  isAdmin,
  onClose,
  onCreated,
}: {
  projectId: number;
  projectName: string;
  isAdmin: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState(`${projectName} テーブル`);
  const [includeTasks, setIncludeTasks] = useState(true);
  const [archiveSource, setArchiveSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: number; row_count: number } | null>(null);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ id: number; row_count: number }>(`/api/projects/${projectId}/table`, "POST", {
        name: name.trim(),
        include_tasks: includeTasks,
        archive_source: archiveSource,
      });
      setCreated(result);
      onCreated();
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
      title="プロジェクトからテーブルを作成"
      backdropClassName="fixed inset-0 z-[100] flex items-center justify-center bg-black/25 p-4"
      panelClassName="w-[min(540px,94vw)] rounded-xl bg-white text-sm shadow-2xl"
    >
      <div data-project-table-dialog className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">プロジェクトからテーブルを作成</h2>
            <p className="mt-0.5 text-xs text-neutral-500">{projectName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-xl leading-none text-neutral-400 hover:text-neutral-700">
            ×
          </button>
        </div>
        {created ? (
          <div className="mt-5 rounded-lg border border-green-200 bg-green-50 p-4" data-table-created>
            <p className="font-medium text-green-900">テーブルを作成しました（{created.row_count}行）</p>
            <div className="mt-3 flex gap-2">
              <a
                href={`/tables/${created.id}`}
                className="flex h-8 items-center rounded-md bg-[#4075cf] px-3 text-sm font-medium text-white hover:bg-[#3567b8]"
              >
                テーブルを開く
              </a>
              <a
                href={`/api/tables/${created.id}/export?format=xlsx`}
                className={PROJECT_DIALOG_SECONDARY}
              >
                XLSXをダウンロード
              </a>
            </div>
          </div>
        ) : (
          <>
            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-medium text-neutral-600">テーブルの名前</span>
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                className="h-9 w-full rounded-md border border-neutral-300 px-2.5 text-sm outline-none focus:border-[#4075cf] focus:ring-2 focus:ring-[#4075cf]/20"
              />
            </label>
            <div className="mt-4 space-y-1.5">
              <label className="flex items-start gap-2 rounded-md border border-neutral-200 p-2.5">
                <input type="checkbox" checked={includeTasks} onChange={(event) => setIncludeTasks(event.target.checked)} className="mt-0.5" />
                <span>
                  <span className="block font-medium">タスクをレコードとして取り込む</span>
                  <span className="block text-xs text-neutral-500">セクション、タスク、担当者、期日、カスタムフィールドを列に変換します。</span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-md border border-neutral-200 p-2.5">
                <input
                  type="checkbox"
                  checked={archiveSource}
                  disabled={!isAdmin}
                  onChange={(event) => setArchiveSource(event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium">元のプロジェクトをアーカイブ</span>
                  <span className="block text-xs text-neutral-500">
                    変換後、元のプロジェクトをサイドバーから非表示にします{!isAdmin ? "（管理者のみ）" : ""}。
                  </span>
                </span>
              </label>
            </div>
            <p className="mt-3 text-xs text-neutral-400">
              テーブルは作成時点のスナップショットです。元のプロジェクトを変更しても自動更新されません。
            </p>
            {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={PROJECT_DIALOG_SECONDARY} onClick={onClose} disabled={busy}>
                キャンセル
              </button>
              <button type="button" className={PROJECT_DIALOG_PRIMARY} onClick={() => void submit()} disabled={busy || !name.trim()}>
                {busy ? "作成中…" : "テーブルを作成"}
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
