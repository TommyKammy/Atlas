"use client";

import type { CustomField } from "@/lib/custom-fields";
import { FIELD_LIBRARY, FIELD_TYPE_ICONS, FIELD_TYPE_LABELS } from "./field-library";

/** Installed custom fields plus the one-click field library. */
export default function CustomizeFieldsPanel({
  fields,
  statusFieldEnabled,
  statusFieldName,
  statusValues,
  canEdit,
  canAdmin,
  busy,
  onAdd,
  onEditField,
  onRemoveField,
  onEditStatus,
  onDeleteStatus,
  onRestoreStatus,
  onAddLibraryField,
  secondaryButton,
}: {
  fields: CustomField[];
  statusFieldEnabled: boolean;
  statusFieldName: string;
  statusValues: string[];
  canEdit: boolean;
  canAdmin: boolean;
  busy: boolean;
  onAdd: () => void;
  onEditField: (field: CustomField) => void;
  onRemoveField: (field: CustomField) => void;
  onEditStatus: () => void;
  onDeleteStatus: () => void;
  onRestoreStatus: () => void;
  onAddLibraryField: (preset: (typeof FIELD_LIBRARY)[number]) => void;
  secondaryButton: string;
}) {
  return (
    <div className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold text-text">プロジェクトに追加済み</h3>
          <p className="mt-0.5 text-[12px] text-muted">
            {fields.length + (statusFieldEnabled ? 1 : 0)} 件のフィールド
          </p>
        </div>
        {canEdit && (
          <button type="button" data-customize-add-field onClick={onAdd} className={secondaryButton}>
            ＋ 追加
          </button>
        )}
      </div>
      <div className="mt-4 space-y-2">
        {statusFieldEnabled && (
          <div className="rounded-lg border border-line px-4 py-3">
            <div className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-[11px] font-semibold text-secondary">
                {FIELD_TYPE_ICONS.select}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-text">{statusFieldName}</div>
                <div className="mt-0.5 text-[12px] text-muted">
                  単一選択
                  {statusValues.length > 0 ? ` ・ ${statusValues.join(" / ")}` : ""}
                </div>
              </div>
              {canAdmin && (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    data-customize-status-field-edit
                    aria-label={`${statusFieldName}を編集`}
                    onClick={onEditStatus}
                    className="flex h-7 w-7 items-center justify-center rounded text-subtle hover:bg-neutral-100 hover:text-secondary"
                  >
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                      <path d="m10.5 2.5 3 3L6 13H3v-3z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    data-customize-status-field-delete
                    aria-label={`${statusFieldName}を削除`}
                    onClick={onDeleteStatus}
                    className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                      <path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8h5.8l.6-8M6.5 7v3M9.5 7v3" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {!statusFieldEnabled && canAdmin && (
          <button
            type="button"
            data-customize-status-field-add
            onClick={onRestoreStatus}
            className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong px-4 py-3 text-[13px] text-accent-text hover:bg-[#eff4fd]"
          >
            ＋ Statusフィールドを追加
          </button>
        )}
        {fields.length === 0 && !statusFieldEnabled ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
            フィールドがありません。追加してタスクの入力項目を増やせます。
          </p>
        ) : (
          fields.map((field) => (
            <div key={field.id} className="rounded-lg border border-line px-4 py-3">
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-[11px] font-semibold text-secondary">
                  {FIELD_TYPE_ICONS[field.field_type]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-text">{field.name}</div>
                  <div className="mt-0.5 text-[12px] text-muted">
                    {FIELD_TYPE_LABELS[field.field_type]}
                    {(field.field_type === "select" || field.field_type === "multi_select") && field.options.length > 0
                      ? ` ・ ${field.options.join(" / ")}`
                      : ""}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      data-customize-field-edit={field.id}
                      aria-label={`${field.name}を編集`}
                      onClick={() => onEditField(field)}
                      className="flex h-7 w-7 items-center justify-center rounded text-subtle hover:bg-neutral-100 hover:text-secondary"
                    >
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                        <path d="m10.5 2.5 3 3L6 13H3v-3z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      data-customize-field-delete={field.id}
                      aria-label={`${field.name}を削除`}
                      onClick={() => onRemoveField(field)}
                      className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                        <path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8h5.8l.6-8M6.5 7v3M9.5 7v3" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {canEdit && (
        <div data-field-library className="mt-6 border-t border-line pt-5">
          <div>
            <h3 className="text-[14px] font-semibold text-text">フィールドライブラリ</h3>
            <p className="mt-0.5 text-[12px] text-muted">よく使うフィールドをワンクリックで追加できます</p>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {FIELD_LIBRARY.map((preset) => {
              const added = fields.some((field) => field.name === preset.name);
              return (
                <div
                  key={preset.name}
                  data-field-library-item={preset.name}
                  className={`rounded-lg border px-3 py-2.5 ${
                    added ? "border-line bg-surface-subtle" : "border-line bg-surface"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-surface-muted text-[10px] font-semibold text-secondary">
                      {FIELD_TYPE_ICONS[preset.field_type]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-text">{preset.name}</div>
                      <div className="mt-0.5 text-[11px] leading-4 text-muted">{preset.description}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    data-field-library-add={preset.name}
                    disabled={added || busy}
                    onClick={() => onAddLibraryField(preset)}
                    className={`mt-2 h-7 w-full rounded-md text-[12px] font-medium ${
                      added
                        ? "cursor-default bg-surface-muted text-subtle"
                        : "bg-[#eff4fd] text-accent-text hover:bg-[#e1ecfc] disabled:opacity-50"
                    }`}
                  >
                    {added ? "追加済み" : "＋ 追加"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
