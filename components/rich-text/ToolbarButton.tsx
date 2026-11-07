"use client";

import type { MouseEvent, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Toolbar button with an Asana-style tooltip rendered above the control. */
export default function ToolbarButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const [tooltip, setTooltip] = useState<{ x: number; y: number; above: boolean } | null>(null);

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const show = () => {
    clearTimer();
    timer.current = setTimeout(() => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const above = rect.top > 48;
      const x = Math.min(Math.max(rect.left + rect.width / 2, 48), window.innerWidth - 48);
      setTooltip({
        x,
        y: above ? rect.top - 8 : rect.bottom + 8,
        above,
      });
    }, 240);
  };

  const hide = () => {
    clearTimer();
    setTooltip(null);
  };

  useEffect(() => clearTimer, []);

  const onMouseDown = (event: MouseEvent) => event.preventDefault();

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={active}
        aria-describedby={tooltip ? id : undefined}
        disabled={disabled}
        onMouseDown={onMouseDown}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => {
          onClick();
          hide();
        }}
        className={`flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-[13px] transition-colors ${
          active
            ? "bg-blue-50 text-blue-700"
            : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
        } disabled:cursor-not-allowed disabled:opacity-35`}
      >
        {children}
      </button>
      {tooltip &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            style={{
              position: "fixed",
              left: tooltip.x,
              top: tooltip.y,
              transform: tooltip.above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
            }}
            className="pointer-events-none z-[320] whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg"
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  );
}
