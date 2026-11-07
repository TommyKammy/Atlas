"use client";

import type { ButtonHTMLAttributes } from "react";

/**
 * Shared completion control. Keeps click propagation local (used inside
 * draggable bars/cards/rows) and normalizes the check icon and colors.
 */
export default function TaskCompletionToggle({
  completed,
  onToggle,
  size = "h-4 w-4",
  className = "",
  ...rest
}: {
  completed: boolean;
  onToggle: () => void;
  size?: string;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type">) {
  return (
    <button
      type="button"
      aria-label={completed ? "未完了に戻す" : "完了にする"}
      {...rest}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={`${size} flex shrink-0 items-center justify-center rounded-full border ${
        completed
          ? "border-green-700 bg-green-700 text-white"
          : "border-neutral-400 bg-white/70 text-transparent hover:border-green-700 hover:text-green-700"
      } ${className}`}
    >
      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M2.5 6.2 5 8.6l4.5-5" />
      </svg>
    </button>
  );
}
