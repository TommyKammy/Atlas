"use client";

import type { CustomField } from "@/lib/custom-fields";

const CORE_LABELS = { assignee: "担当者", due: "期日", progress: "進捗" } as const;

/** Pills that let the user restore hidden core/status/custom columns. */
export default function ListHiddenColumnsBar({
  hiddenCore,
  hiddenCols,
  statusHidden,
  statusFieldEnabled,
  statusFieldName,
  customFields,
  onShowCore,
  onShowStatus,
  onShowField,
}: {
  hiddenCore: Set<string>;
  hiddenCols: Set<number>;
  statusHidden: boolean;
  statusFieldEnabled: boolean;
  statusFieldName: string;
  customFields: CustomField[];
  onShowCore: (key: keyof typeof CORE_LABELS) => void;
  onShowStatus: () => void;
  onShowField: (id: number) => void;
}) {
  const coreKeys = (Object.keys(CORE_LABELS) as (keyof typeof CORE_LABELS)[]).filter((key) =>
    hiddenCore.has(key),
  );
  const hiddenFields = customFields.filter((field) => hiddenCols.has(field.id));
  const showStatus = statusFieldEnabled && statusHidden;
  if (coreKeys.length === 0 && hiddenFields.length === 0 && !showStatus) return null;

  return (
    <div className="flex items-center gap-1 py-1 text-[11px] font-normal text-muted">
      非表示:
      {coreKeys.map((key) => (
        <button
          key={key}
          onClick={() => onShowCore(key)}
          title={`${CORE_LABELS[key]}列を再表示`}
          className="rounded-full border px-2 py-0.5 hover:bg-hover hover:text-neutral-600"
        >
          {CORE_LABELS[key]}を再表示
        </button>
      ))}
      {showStatus && (
        <button
          onClick={onShowStatus}
          title={`${statusFieldName}列を再表示`}
          className="rounded-full border px-2 py-0.5 hover:bg-hover hover:text-neutral-600"
        >
          {statusFieldName}を再表示
        </button>
      )}
      {hiddenFields.map((field) => (
        <button
          key={field.id}
          onClick={() => onShowField(field.id)}
          title={`${field.name}列を再表示`}
          className="rounded-full border px-2 py-0.5 hover:bg-hover hover:text-neutral-600"
        >
          {field.name}を再表示
        </button>
      ))}
    </div>
  );
}
