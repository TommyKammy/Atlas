"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export type HomeWidgetMenuItem = {
  label: string;
  onClick: () => void;
  danger?: boolean;
  checked?: boolean;
};

/** Shared Asana-style home widget card: header, menu and content shell. */
export default function HomeWidgetCard({
  widgetId,
  widgetType,
  size,
  title,
  locked = false,
  menuItems,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  dragging = false,
  className = "",
  children,
}: {
  widgetId: number;
  widgetType: string;
  size: "half" | "full";
  title: string;
  locked?: boolean;
  menuItems: HomeWidgetMenuItem[];
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver?: (event: React.DragEvent) => void;
  onDrop?: (event: React.DragEvent) => void;
  dragging?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <section
      ref={rootRef}
      data-home-widget
      data-home-widget-id={widgetId}
      data-home-widget-type={widgetType}
      data-home-widget-size={size}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`relative flex min-w-0 flex-col rounded-lg border border-line bg-surface ${
        dragging ? "opacity-50" : ""
      } ${className}`}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <span
          draggable
          data-home-widget-drag-handle
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/home-widget", String(widgetId));
            onDragStart();
          }}
          onDragEnd={onDragEnd}
          title="ドラッグして並び替え"
          className="cursor-grab select-none text-[13px] text-subtle hover:text-muted"
        >
          ⠿
        </span>
        <h2 className="min-w-0 truncate text-[14px] font-semibold text-text">{title}</h2>
        {locked && (
          <span title="非公開" className="text-[11px] text-subtle">
            🔒
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          data-home-widget-menu-button
          aria-label="アクション"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((value) => !value)}
          className="flex h-7 w-7 items-center justify-center rounded text-[18px] leading-none text-subtle hover:bg-hover hover:text-secondary"
        >
          …
        </button>
      </header>
      {menuOpen && (
        <div
          role="menu"
          data-home-widget-menu
          className="absolute right-2 top-11 z-30 w-56 rounded-lg border border-line bg-surface py-1 text-[13px] text-secondary shadow-xl"
        >
          {menuItems.map((item, index) => (
            <button
              key={`${item.label}-${index}`}
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                item.onClick();
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover ${
                item.danger ? "text-danger hover:bg-danger-soft" : ""
              }`}
            >
              <span className="w-4 shrink-0 text-center">
                {item.checked ? "✓" : item.danger ? "×" : ""}
              </span>
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}
