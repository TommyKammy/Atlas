"use client";

import { useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/lib/use-focus-trap";
import type { CustomField, CustomFieldType } from "@/lib/custom-fields";
import { useFieldDialog } from "@/lib/use-field-dialog";
import {
  checkboxClass,
  dialogCloseClass,
  dialogSubtitleClass,
  dialogTitleClass,
  fieldControlClass,
  fieldLabelClass,
  fieldTextareaClass,
  primaryButtonClass,
  secondaryButtonClass,
  SelectControl,
} from "@/components/ui/form-controls";
import {
  AutoIdFieldEditor,
  FieldAccessEditor,
  FormulaFieldEditor,
  LookupFieldEditor,
  NumberFieldEditor,
  ReferenceFieldEditor,
  RollupFieldEditor,
  SelectOptionsEditor,
  TimeTrackingEditor,
  TimerFieldEditor,
} from "./FieldTypeEditors";

const TYPE_LABELS: Record<CustomFieldType, string> = {
  select: "単一選択",
  multi_select: "複数選択",
  text: "テキスト",
  number: "数値",
  date: "日付",
  people: "メンバー",
  auto_id: "ID",
  project: "プロジェクト",
  completed_on: "完了日",
  created_at: "作成日",
  modified_at: "最終変更日",
  created_by: "作成したユーザー",
  collaborators: "コラボレーター",
  attachments: "添付",
  blocked_by: "先行タスク",
  blocking: "後続を待たせている",
  formula: "数式",
  reference: "リファレンス",
  lookup: "ルックアップ",
  rollup: "集計",
  timer: "タイマー",
  time_tracking: "タイムトラッキング",
};

/** Asana-style create/edit dialog for a list custom field. */
export default function FieldDialog({
  projectId,
  mode,
  initialType,
  field,
  availableFields = [],
  users = [],
  onClose,
  onSaved,
}: {
  projectId: number;
  mode: "create" | "edit";
  initialType: CustomFieldType;
  field: CustomField | null;
  availableFields?: CustomField[];
  users?: { id: number; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onClose);
  const dialog = useFieldDialog({
    projectId,
    mode,
    initialType,
    field,
    availableFields,
    users,
    onClose,
    onSaved,
  });
  const {
    name,
    setName,
    type,
    setType,
    description,
    setDescription,
    numberField,
    timerField,
    timeTrackingField,
    formulaField,
    autoIdField,
    selectField,
    sourceProjectIds,
    setSourceProjectIds,
    addToLibrary,
    setAddToLibrary,
    saving,
    error,
    save,
  } = dialog;

  return createPortal(
    <div
      className="fixed inset-0 z-[190] flex items-center justify-center bg-scrim p-4"
      onClick={onClose}
      data-field-dialog
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "edit" ? "フィールドを編集" : "フィールドを追加"}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl bg-surface shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line-subtle px-5 py-4">
          <div className="min-w-0">
            <h2 className={dialogTitleClass}>
              {mode === "edit" ? "フィールドを編集" : "フィールドを追加"}
            </h2>
            <div className={dialogSubtitleClass}>
              {mode === "edit" && field
                ? "フィールドタイプは変更できません"
                : "プロジェクトに新しいフィールドを追加します"}
            </div>
          </div>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            className={dialogCloseClass}
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <label className="block">
            <span className={fieldLabelClass}>
              フィールドタイトル <span className="text-danger">*</span>
            </span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={numberField ? "費用、数量、売上…" : "フィールド名"}
              data-field-dialog-name
              className={`mt-1.5 ${fieldControlClass}`}
            />
          </label>

          <label className="mt-4 block">
            <span className={fieldLabelClass}>フィールドタイプ</span>
            {mode === "edit" ? (
              <div className="mt-1.5 flex h-8 items-center rounded-md border border-line bg-surface-subtle px-2.5 text-[13px] text-secondary">
                {TYPE_LABELS[type]}
              </div>
            ) : (
              <SelectControl
                containerClassName="mt-1.5"
                value={type}
                onChange={(event) => {
                  const nextType = event.target.value as CustomFieldType;
                  setType(nextType);
                  if (nextType === "reference" && sourceProjectIds.length === 0) {
                    setSourceProjectIds([projectId]);
                  }
                }}
              >
                <option value="select">単一選択</option>
                <option value="multi_select">複数選択</option>
                <option value="date">日付</option>
                <option value="people">メンバー</option>
                <option value="text">テキスト</option>
                <option value="number">数値</option>
                <option value="formula">数式</option>
                <option value="reference">リファレンス</option>
                <option value="lookup">ルックアップ</option>
                <option value="rollup">集計</option>
                <option value="timer">タイマー</option>
                <option value="time_tracking">タイムトラッキング</option>
                <option value="auto_id">ID</option>
                <option value="project">プロジェクト</option>
                <option value="completed_on">完了日</option>
                <option value="modified_at">最終変更日</option>
                <option value="created_at">作成日</option>
                <option value="created_by">作成したユーザー</option>
                <option value="collaborators">コラボレーター</option>
                <option value="attachments">添付</option>
                <option value="blocked_by">先行タスク</option>
                <option value="blocking">後続を待たせている</option>
              </SelectControl>
            )}
          </label>

          <label className="mt-4 block">
            <span className={fieldLabelClass}>説明</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              placeholder="説明を追加（任意）"
              className={`mt-1.5 ${fieldTextareaClass}`}
            />
          </label>

          {numberField && <NumberFieldEditor dialog={dialog} />}
          {timerField && <TimerFieldEditor dialog={dialog} />}
          {timeTrackingField && <TimeTrackingEditor />}
          {type === "reference" && <ReferenceFieldEditor dialog={dialog} />}
          {type === "lookup" && <LookupFieldEditor dialog={dialog} />}
          {type === "rollup" && <RollupFieldEditor dialog={dialog} />}
          {formulaField && <FormulaFieldEditor dialog={dialog} />}
          {autoIdField && <AutoIdFieldEditor dialog={dialog} />}
          {selectField && <SelectOptionsEditor dialog={dialog} />}

          {mode === "create" && (
            <label className="mt-4 flex cursor-pointer items-center gap-2 text-[13px] text-text">
              <input
                type="checkbox"
                checked={addToLibrary}
                onChange={(event) => setAddToLibrary(event.target.checked)}
                className={checkboxClass}
              />
              このフィールドをライブラリに追加する
            </label>
          )}

          <FieldAccessEditor dialog={dialog} />

          {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line-subtle px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className={secondaryButtonClass}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || name.trim() === ""}
            data-field-dialog-save
            className={primaryButtonClass}
          >
            {saving
              ? "保存中…"
              : mode === "edit"
                ? "変更内容を保存"
                : "フィールドを作成"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
