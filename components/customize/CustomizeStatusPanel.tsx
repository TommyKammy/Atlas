"use client";

type StatusDraft = { key: number; original: string | null; value: string };

/** Status field name/options editor. */
export default function CustomizeStatusPanel({
  canAdmin,
  statusFieldName,
  onStatusFieldName,
  drafts,
  onChangeDraft,
  onRemoveDraft,
  onAddDraft,
  onDelete,
  onSave,
  busy,
  primaryButton,
}: {
  canAdmin: boolean;
  statusFieldName: string;
  onStatusFieldName: (value: string) => void;
  drafts: StatusDraft[];
  onChangeDraft: (key: number, value: string) => void;
  onRemoveDraft: (key: number) => void;
  onAddDraft: () => void;
  onDelete: () => void;
  onSave: () => void;
  busy: boolean;
  primaryButton: string;
}) {
  return (
    <div className="p-5">
      <p className="text-[13px] text-secondary">
        ステータスフィールドの名前と選択肢を編集します。選択肢名を変更すると、既存タスクの値も一緒に更新されます。
      </p>
      {!canAdmin && (
        <p className="mt-2 rounded-md bg-warning-soft px-3 py-2 text-[12px] text-warning">
          ステータスの変更はプロジェクト管理者のみ可能です。
        </p>
      )}
      <label className="mt-4 block text-[12px] font-medium text-secondary">
        フィールド名
        <input
          data-customize-status-name
          value={statusFieldName}
          disabled={!canAdmin}
          onChange={(event) => onStatusFieldName(event.target.value)}
          className="mt-1 h-8 w-full rounded-md border border-neutral-200 px-2 text-[13px] outline-none focus:border-[#2c60b8] disabled:bg-neutral-50"
        />
      </label>
      <div className="mt-4 text-[12px] font-medium text-secondary">選択肢</div>
      <div className="mt-2 space-y-2">
        {drafts.map((draft) => (
          <div key={draft.key} className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#8db8ff]" />
            <input
              data-customize-status-input={draft.key}
              value={draft.value}
              disabled={!canAdmin}
              onChange={(event) => onChangeDraft(draft.key, event.target.value)}
              className="h-8 min-w-0 flex-1 rounded-md border border-neutral-200 px-2 text-[13px] outline-none focus:border-[#2c60b8] disabled:bg-neutral-50"
            />
            {canAdmin && (
              <button
                type="button"
                aria-label="ステータスを削除"
                onClick={() => onRemoveDraft(draft.key)}
                className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-red-600"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      {canAdmin && (
        <>
          <button
            type="button"
            data-customize-status-add
            onClick={onAddDraft}
            className="mt-3 flex h-8 items-center gap-1 rounded-md px-2 text-[13px] text-accent-text hover:bg-[#eff4fd]"
          >
            ＋ ステータスを追加
          </button>
          <div className="mt-5 flex items-center justify-between">
            <button type="button" onClick={onDelete} className="text-[12px] text-danger hover:underline">
              フィールドを削除
            </button>
            <button type="button" data-customize-status-save onClick={onSave} disabled={busy} className={primaryButton}>
              保存
            </button>
          </div>
        </>
      )}
    </div>
  );
}
