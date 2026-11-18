"use client";

import type { ButtonHTMLAttributes } from "react";
import TaskMilestoneIcon from "./TaskMilestoneIcon";

/**
 * Shared completion control. Keeps click propagation local (used inside
 * draggable bars/cards/rows) and normalizes the check icon and colors.
 * Milestones replace the circular check with Asana's green diamond.
 */
export default function TaskCompletionToggle({
  completed,
  onToggle,
  milestone = false,
  size = "h-4 w-4",
  className = "",
  ...rest
}: {
  completed: boolean;
  onToggle: () => void;
  milestone?: boolean;
  size?: string;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type">) {
  return (
    <button
      type="button"
      aria-label={
        milestone
          ? completed
            ? "マイルストーンを未完了に戻す"
            : "マイルストーンを完了にする"
          : completed
            ? "未完了に戻す"
            : "完了にする"
      }
      {...rest}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={
        milestone
          ? `${size} flex shrink-0 items-center justify-center ${className}`
          : `${size} flex shrink-0 items-center justify-center rounded-full border ${
              completed
                ? "border-green-700 bg-green-700 text-on-accent"
                : "border-neutral-400 bg-white/70 text-transparent hover:border-green-700 hover:text-green-700"
            } ${className}`
      }
    >
      {milestone ? (
        <TaskMilestoneIcon completed={completed} sizeClassName="h-full w-full" />
      ) : (
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M2.5 6.2 5 8.6l4.5-5" />
        </svg>
      )}
    </button>
  );
}
