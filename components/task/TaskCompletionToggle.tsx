"use client";

import type { ButtonHTMLAttributes } from "react";
import { LIST_ROW_STATE_LABELS, type ListRowState } from "@/lib/list-row-state";
import TaskMilestoneIcon from "./TaskMilestoneIcon";
import TaskStateIcon from "./TaskStateIcon";

const stateColor: Record<ListRowState, string> = {
  complete: "text-success",
  overdue: "text-danger",
  "in-progress": "text-warning",
  todo: "text-muted",
};

/**
 * Shared completion control. Keeps click propagation local (used inside
 * draggable bars/cards/rows) and normalizes the check icon and colors.
 * Milestones replace the circular check with Asana's green diamond.
 *
 * Pass `state` in the list to draw the four-state circle from the C mockup.
 * Other views keep the previous square check, so their layout and tests do
 * not change.
 */
export default function TaskCompletionToggle({
  completed,
  onToggle,
  milestone = false,
  state,
  size = "h-4 w-4",
  className = "",
  title,
  ...rest
}: {
  completed: boolean;
  onToggle: () => void;
  milestone?: boolean;
  state?: ListRowState;
  size?: string;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type">) {
  const actionLabel = milestone
    ? completed
      ? "マイルストーンを未完了に戻す"
      : "マイルストーンを完了にする"
    : completed
      ? "未完了に戻す"
      : "完了にする";
  const stateLabel = state && !milestone ? LIST_ROW_STATE_LABELS[state] : null;
  const activeState = stateLabel ? state : null;
  const stateClass = state ? stateColor[state] : "";
  return (
    <button
      type="button"
      aria-label={stateLabel ? `${stateLabel}（${actionLabel}）` : actionLabel}
      title={title ?? stateLabel ?? undefined}
      {...rest}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={
        milestone
          ? `${size} flex shrink-0 items-center justify-center ${className}`
          : stateLabel
            ? `${size} flex shrink-0 items-center justify-center rounded-full ${stateClass} ${className}`
            : `${size} flex shrink-0 items-center justify-center rounded-full border ${
                completed
                  ? "border-success-strong bg-success-strong text-on-strong"
                  : "border-line-strong bg-surface/70 text-transparent hover:border-success-strong hover:text-success"
              } ${className}`
      }
      data-completion-state={stateLabel ? state : undefined}
    >
      {milestone ? (
        <TaskMilestoneIcon completed={completed} sizeClassName="h-full w-full" />
      ) : activeState ? (
        <TaskStateIcon state={activeState} />
      ) : (
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M2.5 6.2 5 8.6l4.5-5" />
        </svg>
      )}
    </button>
  );
}
