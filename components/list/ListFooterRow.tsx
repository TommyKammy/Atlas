"use client";

import type { ReactNode } from "react";
import type { CustomField } from "@/lib/custom-fields";

export type ListFooterTotals = Record<number, { label: string; value: string }>;

/**
 * The add-task/footer row. `ghost` is the collapsed add affordance and `add`
 * is the row that holds the inline composer. Both keep the same column grid
 * as ListColumnHeader and TaskListRow.
 */
export default function ListFooterRow({
  variant,
  gridCols,
  visibleCols,
  customFields,
  totals,
  onAdd,
  disabled = false,
  children,
}: {
  variant: "ghost" | "add";
  gridCols: string;
  visibleCols: string[];
  customFields: CustomField[];
  totals: ListFooterTotals;
  onAdd?: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const footerCell = (key: string) => {
    if (!key.startsWith("cf-")) return <span key={key} />;
    const field = customFields.find((item) => `cf-${item.id}` === key);
    const total = field ? totals[field.id] : undefined;
    if (!field || !total) return <span key={key} />;
    return (
      <span
        key={key}
        className="flex min-w-0 items-center gap-1 pl-2 text-[11px] text-muted"
        title={total.label}
      >
        <span className="shrink-0">{total.label}</span>
        <span className="truncate font-medium text-secondary">{total.value}</span>
      </span>
    );
  };

  return (
    <div
      className={`grid items-center [&>*:nth-child(n+3)]:border-l [&>*:nth-child(n+3)]:border-[#eaeaea] border-b border-line px-2 text-sm ${
        variant === "add" ? "py-1.5" : ""
      }`}
      style={{ gridTemplateColumns: gridCols }}
    >
      <span />
      {variant === "ghost" ? (
        <div className="min-w-0">
          <button
            onClick={onAdd}
            disabled={disabled}
            data-add-task-open
            className="flex h-9 w-full items-center rounded pr-2 pl-12 text-left text-[13px] whitespace-nowrap text-muted hover:bg-hover hover:text-secondary"
          >
            タスクを追加
          </button>
        </div>
      ) : (
        <div data-add-task-row className="flex min-w-0 items-center gap-1 pl-12">
          {children}
        </div>
      )}
      {visibleCols.map(footerCell)}
      <span />
    </div>
  );
}
