"use client";

import type { FormEvent } from "react";
import type { BundleField } from "@/lib/bundles";
import type { ProjectRule } from "@/lib/automation/types";
import CustomizeModal from "./CustomizeModal";

export type BundleDraft = {
  name: string;
  description: string;
  fields: BundleField[];
  ruleIds: number[];
};

/** Create bundle modal. */
export default function CustomizeBundleModal({
  draft,
  onDraft,
  onClose,
  onSubmit,
  availableRules,
  busy,
  fieldTypeClass,
  primaryButton,
  secondaryButton,
}: {
  draft: BundleDraft;
  onDraft: (draft: BundleDraft) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  availableRules: ProjectRule[];
  busy: boolean;
  fieldTypeClass: string;
  primaryButton: string;
  secondaryButton: string;
}) {
  return (
    <CustomizeModal title="バンドルを作成" onClose={onClose}>
      <form onSubmit={onSubmit} data-customize-bundle-form className="p-5">
        <label className="block text-[12px] font-medium text-secondary">
          バンドル名
          <input
            value={draft.name}
            onChange={(event) => onDraft({ ...draft, name: event.target.value })}
            data-customize-bundle-name
            placeholder="例: プロジェクト管理セット"
            className={fieldTypeClass}
          />
        </label>
        <label className="mt-3 block text-[12px] font-medium text-secondary">
          説明
          <input
            value={draft.description}
            onChange={(event) => onDraft({ ...draft, description: event.target.value })}
            className={fieldTypeClass}
          />
        </label>
        <div className="mt-4 flex items-center justify-between">
          <div className="text-[12px] font-medium text-secondary">フィールド</div>
          <button
            type="button"
            data-customize-bundle-field-add
            onClick={() =>
              onDraft({
                ...draft,
                fields: [...draft.fields, { name: "", field_type: "text", options: [] }],
              })
            }
            className="text-[12px] text-accent-text hover:underline"
          >
            ＋ フィールドを追加
          </button>
        </div>
        <div className="mt-2 space-y-2">
          {draft.fields.map((field, index) => (
            <div key={index} className="rounded-md border border-line p-2">
              <div className="flex items-center gap-2">
                <input
                  value={field.name}
                  onChange={(event) =>
                    onDraft({
                      ...draft,
                      fields: draft.fields.map((entry, i) =>
                        i === index ? { ...entry, name: event.target.value } : entry,
                      ),
                    })
                  }
                  data-customize-bundle-field-name={index}
                  placeholder="フィールド名"
                  className="h-7 min-w-0 flex-1 rounded border border-line px-2 text-[12px] outline-none focus:border-accent"
                />
                <select
                  value={field.field_type}
                  onChange={(event) =>
                    onDraft({
                      ...draft,
                      fields: draft.fields.map((entry, i) =>
                        i === index
                          ? { ...entry, field_type: event.target.value as BundleField["field_type"] }
                          : entry,
                      ),
                    })
                  }
                  data-customize-bundle-field-type={index}
                  className="h-7 rounded border border-line bg-white px-1 text-[12px]"
                >
                  <option value="text">テキスト</option>
                  <option value="number">数値</option>
                  <option value="select">単一選択</option>
                </select>
                {draft.fields.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      onDraft({ ...draft, fields: draft.fields.filter((_, i) => i !== index) })
                    }
                    className="text-subtle hover:text-danger"
                  >
                    ×
                  </button>
                )}
              </div>
              {field.field_type === "select" && (
                <input
                  value={field.options.join(", ")}
                  onChange={(event) =>
                    onDraft({
                      ...draft,
                      fields: draft.fields.map((entry, i) =>
                        i === index
                          ? {
                              ...entry,
                              options: event.target.value
                                .split(",")
                                .map((option) => option.trim())
                                .filter(Boolean),
                            }
                          : entry,
                      ),
                    })
                  }
                  data-customize-bundle-field-options={index}
                  placeholder="選択肢（カンマ区切り）"
                  className="mt-2 h-7 w-full rounded border border-line px-2 text-[12px] outline-none focus:border-accent"
                />
              )}
            </div>
          ))}
        </div>
        {availableRules.length > 0 && (
          <div className="mt-4">
            <div className="text-[12px] font-medium text-secondary">ルールを含める</div>
            <p className="mt-0.5 text-[10px] text-subtle">
              現在のプロジェクトのルールをバンドルに同梱できます。
            </p>
            <div className="mt-2 space-y-1.5">
              {availableRules.map((rule) => (
                <label
                  key={rule.id}
                  className="flex items-start gap-2 rounded-md border border-line p-2 text-[11px]"
                >
                  <input
                    type="checkbox"
                    checked={draft.ruleIds.includes(rule.id)}
                    onChange={(event) =>
                      onDraft({
                        ...draft,
                        ruleIds: event.target.checked
                          ? [...draft.ruleIds, rule.id]
                          : draft.ruleIds.filter((id) => id !== rule.id),
                      })
                    }
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block font-medium text-text">{rule.name}</span>
                    {rule.description && (
                      <span className="block text-[10px] text-muted">{rule.description}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>
            キャンセル
          </button>
          <button type="submit" data-customize-bundle-save disabled={busy} className={primaryButton}>
            作成
          </button>
        </div>
      </form>
    </CustomizeModal>
  );
}
