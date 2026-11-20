"use client";

import { isImeComposing } from "@/lib/ime-keyboard";

import Dialog from "../ui/Dialog";

export const PROJECT_DIALOG_PRIMARY =
  "flex h-8 items-center rounded-md bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60";
export const PROJECT_DIALOG_SECONDARY =
  "flex h-8 items-center rounded-md border bg-surface px-3 text-sm text-secondary hover:bg-hover";

/** Rename project dialog. */
export default function RenameProjectDialog({
  value,
  busy,
  onChange,
  onClose,
  onSave,
}: {
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title="名前を変更"
      backdropClassName="backdrop:bg-scrim"
      panelClassName="w-[min(420px,90vw)] rounded-lg bg-surface text-sm shadow-xl"
    >
      <div className="p-5">
        <h2 className="text-lg font-semibold">名前を変更</h2>
        <input
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (isImeComposing(event)) return;
            if (event.key === "Enter") onSave();
          }}
          aria-label="プロジェクト名"
          className="mt-3 h-9 w-full rounded-md border px-2 text-sm outline-none focus:border-accent"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={PROJECT_DIALOG_SECONDARY} onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className={PROJECT_DIALOG_PRIMARY}
            disabled={busy || !value.trim()}
            onClick={onSave}
          >
            保存
          </button>
        </div>
      </div>
    </Dialog>
  );
}
