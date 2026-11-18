"use client";

import type { Bundle } from "@/lib/bundles";

/** Workspace bundle list with apply/remove actions. */
export default function CustomizeBundlesPanel({
  bundles,
  canEdit,
  canAdmin,
  busy,
  onAdd,
  onApply,
  onRemove,
  secondaryButton,
}: {
  bundles: Bundle[];
  canEdit: boolean;
  canAdmin: boolean;
  busy: boolean;
  onAdd: () => void;
  onApply: (bundle: Bundle) => void;
  onRemove: (bundle: Bundle) => void;
  secondaryButton: string;
}) {
  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] text-secondary">
          ワークスペースのバンドルは、複数のカスタムフィールドをまとめてプロジェクトへ追加できます。
        </p>
        {canAdmin && (
          <button type="button" data-customize-bundle-add onClick={onAdd} className={secondaryButton}>
            ＋ 作成
          </button>
        )}
      </div>
      <div className="mt-4 space-y-2">
        {bundles.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">
            利用できるバンドルはありません。
          </div>
        ) : (
          bundles.map((bundle) => (
            <div
              key={bundle.id}
              data-customize-bundle={bundle.id}
              className="rounded-lg border border-line bg-surface px-4 py-3"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-text">{bundle.name}</span>
                    {bundle.applied && (
                      <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] text-success">
                        適用済み
                      </span>
                    )}
                  </div>
                  {bundle.description && (
                    <div className="mt-0.5 text-[12px] text-muted">{bundle.description}</div>
                  )}
                  <div className="mt-1 text-[11px] text-subtle">
                    {bundle.fields.length} フィールド ・ {bundle.rules.length} ルール ・{" "}
                    {bundle.applied_count} プロジェクトで利用
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {bundle.fields.map((field) => (
                      <span key={field.name} className="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] text-secondary">
                        {field.name}
                      </span>
                    ))}
                    {bundle.rules.map((rule) => (
                      <span key={rule.name} className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent-text">
                        {rule.name}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    data-customize-bundle-apply={bundle.id}
                    disabled={!canEdit || busy || bundle.applied}
                    onClick={() => onApply(bundle)}
                    className="h-7 rounded-md bg-accent-soft px-2 text-[12px] font-medium text-accent-text hover:bg-accent-soft-hover disabled:opacity-40"
                  >
                    {bundle.applied ? "適用済み" : "適用"}
                  </button>
                  {canAdmin && (
                    <button
                      type="button"
                      data-customize-bundle-remove={bundle.id}
                      aria-label={`${bundle.name}を削除`}
                      onClick={() => onRemove(bundle)}
                      className="flex h-7 w-7 items-center justify-center rounded text-subtle hover:bg-danger-soft hover:text-danger"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
