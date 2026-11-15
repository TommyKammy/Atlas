"use client";

import Dialog from "../ui/Dialog";
import { PROJECT_DIALOG_SECONDARY } from "./RenameProjectDialog";

/** Archive project confirmation dialog. */
export default function ArchiveProjectDialog({
  projectName,
  busy,
  onClose,
  onArchive,
}: {
  projectName: string;
  busy: boolean;
  onClose: () => void;
  onArchive: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title="プロジェクトをアーカイブ"
      backdropClassName="backdrop:bg-black/25"
      panelClassName="w-[min(420px,90vw)] rounded-lg bg-white text-sm shadow-xl"
    >
      <div data-project-archive-dialog className="p-5">
        <h2 className="text-lg font-semibold">プロジェクトをアーカイブ</h2>
        <p className="mt-2 text-neutral-600">
          「{projectName}」をアーカイブしますか？サイドバーから非表示になります。削除済みページから復元できます。
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={PROJECT_DIALOG_SECONDARY} onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className="flex h-8 items-center rounded-md bg-[#c94848] px-3 text-sm font-medium text-white hover:bg-[#b83c3c] disabled:opacity-60"
            disabled={busy}
            onClick={onArchive}
          >
            アーカイブする
          </button>
        </div>
      </div>
    </Dialog>
  );
}
