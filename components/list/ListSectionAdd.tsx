"use client";

import { isImeComposing } from "@/lib/ime-keyboard";

/** Add-section footer shown below all list groups. */
export default function ListSectionAdd({
  adding,
  name,
  onNameChange,
  onCreate,
  onCancel,
  onStart,
}: {
  adding: boolean;
  name: string;
  onNameChange: (value: string) => void;
  onCreate: () => void;
  onCancel: () => void;
  onStart: () => void;
}) {
  return (
    <div className="pt-4" id="custom-field-add">
      {adding ? (
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            data-add-section-input
            onKeyDown={(event) => !isImeComposing(event) && event.key === "Enter" && onCreate()}
            placeholder="セクション名"
            autoFocus
            className="rounded border px-2 py-1 text-sm outline-none focus:border-blue-500"
          />
          <button
            onClick={onCreate}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
          >
            追加
          </button>
          <button onClick={onCancel} className="px-2 text-sm text-neutral-500">
            キャンセル
          </button>
        </div>
      ) : (
        <button onClick={onStart} className="text-sm text-neutral-500 hover:text-neutral-800">
          ＋ セクションを追加
        </button>
      )}
    </div>
  );
}
