"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api-client";
import { useFocusTrap } from "@/lib/use-focus-trap";
import {
  CURRENCY_CHOICES,
  NUMBER_FORMAT_LABELS,
  formatNumberValue,
  normalizeCustomFieldConfig,
  type CustomField,
  type CustomFieldType,
  type NumberFormat,
} from "@/lib/custom-fields";
import { toast } from "@/lib/ui-feedback";

const TYPE_LABELS: Record<CustomFieldType, string> = {
  select: "単一選択",
  text: "テキスト",
  number: "数値",
};

/** Asana-style create/edit dialog for a list custom field. */
export default function FieldDialog({
  projectId,
  mode,
  initialType,
  field,
  onClose,
  onSaved,
}: {
  projectId: number;
  mode: "create" | "edit";
  initialType: CustomFieldType;
  field: CustomField | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onClose);
  const [name, setName] = useState(field?.name ?? "");
  const [type, setType] = useState<CustomFieldType>(field?.field_type ?? initialType);
  const [description, setDescription] = useState(field?.description ?? "");
  const [options, setOptions] = useState<string[]>(field?.options.length ? field.options : [""]);
  const [numberFormat, setNumberFormat] = useState<NumberFormat>(
    field?.config?.number_format ?? "number",
  );
  const [currency, setCurrency] = useState(field?.config?.currency ?? "JPY");
  const [decimals, setDecimals] = useState(field?.config?.decimals ?? 0);
  const [customSuffix, setCustomSuffix] = useState(field?.config?.custom_suffix ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const config = useMemo(
    () =>
      normalizeCustomFieldConfig({
        number_format: numberFormat,
        currency,
        decimals,
        custom_suffix: customSuffix,
        column_function: field?.config?.column_function ?? "sum",
        include_subtasks: field?.config?.include_subtasks ?? false,
      }),
    [numberFormat, currency, decimals, customSuffix, field?.config],
  );
  const preview = formatNumberValue(1000, config);
  const numberField = type === "number";
  const selectField = type === "select";

  const updateOption = (index: number, value: string) => {
    setOptions((current) => current.map((item, i) => (i === index ? value : item)));
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("フィールドタイトルを入力してください");
      return;
    }
    setSaving(true);
    setError("");
    const body = {
      name: trimmed,
      field_type: type,
      description: description.trim(),
      options: selectField ? options.map((option) => option.trim()).filter((option) => option !== "") : [],
      config: numberField ? config : {},
    };
    try {
      if (mode === "edit" && field) {
        await api(`/api/custom-fields/${field.id}`, "PATCH", {
          name: body.name,
          description: body.description,
          options: body.options,
          config: body.config,
        });
      } else {
        await api("/api/custom-fields", "POST", { project_id: projectId, ...body });
      }
      onSaved();
      onClose();
    } catch (saveError) {
      setError(`保存に失敗しました: ${saveError instanceof Error ? saveError.message : saveError}`);
      toast("フィールドを保存できませんでした");
    } finally {
      setSaving(false);
    }
  };

  const label = "mt-3 block text-[11px] font-medium text-neutral-500";
  const fieldClass =
    "mt-1 h-9 w-full rounded-md border border-neutral-300 bg-white px-2.5 text-[13px] text-neutral-800 outline-none focus:border-[#4075cf] focus:ring-2 focus:ring-[#4075cf]/10";

  return createPortal(
    <div
      className="fixed inset-0 z-[190] flex items-center justify-center bg-black/35 p-4"
      onClick={onClose}
      data-field-dialog
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "edit" ? "フィールドを編集" : "フィールドを追加"}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
          <div>
            <h2 className="text-[17px] font-semibold text-neutral-900">
              {mode === "edit" ? "フィールドを編集" : "フィールドを追加"}
            </h2>
            {mode === "edit" && field && (
              <div className="mt-0.5 text-[10px] text-neutral-400">フィールドタイプは変更できません</div>
            )}
          </div>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            className="rounded p-1 text-xl leading-none text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label className="block text-[11px] font-medium text-neutral-500">
            フィールドタイトル <span className="text-red-500">*</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={numberField ? "費用、数量、売上…" : "フィールド名"}
              data-field-dialog-name
              className={fieldClass}
            />
          </label>

          <label className={label}>
            フィールドタイプ
            {mode === "edit" ? (
              <div className="mt-1 flex h-9 items-center rounded-md border border-neutral-200 bg-neutral-50 px-2.5 text-[13px] text-neutral-600">
                {TYPE_LABELS[type]}
              </div>
            ) : (
              <select
                value={type}
                onChange={(event) => setType(event.target.value as CustomFieldType)}
                className={fieldClass}
              >
                <option value="select">単一選択</option>
                <option value="text">テキスト</option>
                <option value="number">数値</option>
              </select>
            )}
          </label>

          <label className={label}>
            説明
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              placeholder="説明を追加（任意）"
              className="mt-1 w-full resize-y rounded-md border border-neutral-300 bg-white px-2.5 py-2 text-[13px] outline-none focus:border-[#4075cf] focus:ring-2 focus:ring-[#4075cf]/10"
            />
          </label>

          {numberField && (
            <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
              <div className="text-[12px] font-semibold text-neutral-700">数値の表示</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-[11px] text-neutral-500">
                  フォーマット
                  <select
                    value={numberFormat}
                    onChange={(event) => setNumberFormat(event.target.value as NumberFormat)}
                    className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                  >
                    {Object.entries(NUMBER_FORMAT_LABELS).map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-neutral-500">
                  小数桁数
                  <input
                    type="number"
                    min={0}
                    max={6}
                    value={decimals}
                    onChange={(event) =>
                      setDecimals(Math.max(0, Math.min(6, Number(event.target.value) || 0)))
                    }
                    className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                  />
                </label>
                {numberFormat === "currency" && (
                  <label className="text-[11px] text-neutral-500">
                    通貨
                    <select
                      value={currency}
                      onChange={(event) => setCurrency(event.target.value)}
                      className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                    >
                      {CURRENCY_CHOICES.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {numberFormat === "custom" && (
                  <label className="text-[11px] text-neutral-500">
                    ラベル
                    <input
                      value={customSuffix}
                      onChange={(event) => setCustomSuffix(event.target.value)}
                      placeholder="例: lbs"
                      className="mt-1 h-8 w-full rounded border border-neutral-300 bg-white px-2 text-[12px] outline-none focus:border-[#4075cf]"
                    />
                  </label>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-500">
                <span>例</span>
                <span className="font-medium text-neutral-700">{preview}</span>
              </div>
              <div className="mt-1 text-[10px] text-neutral-400">
                セクション合計は列メニューの「列の関数」から変更できます。
              </div>
            </div>
          )}

          {selectField && (
            <div className="mt-4">
              <div className="text-[11px] font-medium text-neutral-500">選択肢</div>
              <div className="mt-1 space-y-1">
                {options.map((option, index) => (
                  <div key={index} className="flex items-center gap-1.5">
                    <input
                      value={option}
                      onChange={(event) => updateOption(index, event.target.value)}
                      placeholder={`選択肢 ${index + 1}`}
                      className="h-8 min-w-0 flex-1 rounded border border-neutral-300 px-2 text-[12px] outline-none focus:border-[#4075cf]"
                    />
                    <button
                      type="button"
                      onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
                      className="rounded px-1.5 text-[12px] text-neutral-400 hover:bg-neutral-100 hover:text-red-600"
                      aria-label="選択肢を削除"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setOptions((current) => [...current, ""])}
                className="mt-1 rounded px-1.5 py-1 text-[11px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
              >
                ＋ 選択肢を追加
              </button>
            </div>
          )}

          {error && <p className="mt-3 text-[12px] text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-100"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || name.trim() === ""}
            data-field-dialog-save
            className="rounded-md bg-[#2f6fd0] px-4 py-1.5 text-[12px] font-medium text-white hover:bg-[#2459ad] disabled:bg-neutral-200 disabled:text-neutral-500"
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
