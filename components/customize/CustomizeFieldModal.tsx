"use client";

import type { FormEvent } from "react";
import type { CustomField } from "@/lib/custom-fields";
import CustomizeModal from "./CustomizeModal";

export type FieldDraft = {
  id: number | null;
  name: string;
  field_type: CustomField["field_type"];
  options: string;
};

/** Add/edit custom field modal. */
export default function CustomizeFieldModal({
  draft,
  onDraft,
  onClose,
  onSubmit,
  busy,
  fieldTypeClass,
  primaryButton,
  secondaryButton,
}: {
  draft: FieldDraft;
  onDraft: (draft: FieldDraft) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  busy: boolean;
  fieldTypeClass: string;
  primaryButton: string;
  secondaryButton: string;
}) {
  return (
    <CustomizeModal title={draft.id === null ? "フィールドを追加" : "フィールドを編集"} onClose={onClose}>
      <form onSubmit={onSubmit} className="p-5">
        <label className="block text-[12px] font-medium text-neutral-700">
          フィールド名
          <input
            data-customize-field-name
            value={draft.name}
            onChange={(event) => onDraft({ ...draft, name: event.target.value })}
            placeholder="優先度、ステージ、見積もり…"
            className={fieldTypeClass}
          />
        </label>
        <label className="mt-4 block text-[12px] font-medium text-neutral-700">
          フィールドタイプ
          <select
            data-customize-field-type
            value={draft.field_type}
            disabled={draft.id !== null}
            onChange={(event) =>
              onDraft({ ...draft, field_type: event.target.value as CustomField["field_type"] })
            }
            className={`${fieldTypeClass} disabled:bg-neutral-50 disabled:text-neutral-500`}
          >
            <option value="text">テキスト</option>
            <option value="number">数値</option>
            <option value="select">単一選択</option>
            <option value="multi_select">複数選択</option>
            <option value="date">日付</option>
          </select>
        </label>
        {(draft.field_type === "select" || draft.field_type === "multi_select") && (
          <label className="mt-4 block text-[12px] font-medium text-neutral-700">
            オプション
            <textarea
              data-customize-field-options
              value={draft.options}
              onChange={(event) => onDraft({ ...draft, options: event.target.value })}
              placeholder="低, 中, 高"
              rows={3}
              className="mt-1 w-full rounded-md border border-neutral-200 px-2 py-1.5 text-[13px] outline-none focus:border-[#2c60b8]"
            />
            <span className="mt-1 block text-[11px] font-normal text-neutral-400">カンマまたは改行で区切ってください。</span>
          </label>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>
            キャンセル
          </button>
          <button type="submit" data-customize-field-save disabled={busy} className={primaryButton}>
            {draft.id === null ? "フィールドを作成" : "保存"}
          </button>
        </div>
      </form>
    </CustomizeModal>
  );
}
