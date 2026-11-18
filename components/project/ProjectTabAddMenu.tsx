"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { PROJECT_TAB_VIEW_OPTIONS, type ProjectTabViewOption } from "@/lib/project-tab-views";

function ViewIcon({ view }: { view: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "h-5 w-5 shrink-0 text-[#5f7bd0]",
  };
  if (view === "overview")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 10v6M12 7.2v.2" />
      </svg>
    );
  if (view === "dashboard")
    return (
      <svg {...common}>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
    );
  if (view === "list")
    return (
      <svg {...common}>
        <path d="M8 6h13M8 12h13M8 18h13M3 6h.2M3 12h.2M3 18h.2" />
      </svg>
    );
  if (view === "board")
    return (
      <svg {...common}>
        <rect x="3" y="4" width="5" height="16" rx="1" />
        <rect x="10" y="4" width="5" height="11" rx="1" />
        <rect x="17" y="4" width="4" height="7" rx="1" />
      </svg>
    );
  if (view === "timeline")
    return (
      <svg {...common}>
        <path d="M3 6h8M9 12h9M6 18h12" />
        <path d="M3 3v18" />
      </svg>
    );
  if (view === "calendar")
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    );
  if (view === "messages")
    return (
      <svg {...common}>
        <path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" />
        <path d="M8 11h8M8 15h5" />
      </svg>
    );
  if (view === "knowledge")
    return (
      <svg {...common}>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
        <path d="M4 18.5h16" />
      </svg>
    );
  if (view === "files")
    return (
      <svg {...common}>
        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <path d="M14 3v6h6" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8M8 11h8M8 15h5" />
    </svg>
  );
}

/** "＋" tab picker. Mirrors Asana: popular/other groups with descriptions. */
export default function ProjectTabAddMenu({
  pos,
  busyView,
  error,
  onSelect,
  onClose,
}: {
  pos: { x: number; y: number; width: number };
  busyView: string | null;
  error: string;
  onSelect: (option: ProjectTabViewOption) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);

  if (typeof document === "undefined") return null;
  const groups = [
    ["popular", "人気"],
    ["other", "その他"],
  ] as const;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[80]" onMouseDown={onClose} />
      <div
        ref={panelRef}
        role="menu"
        aria-label="タブを追加"
        data-project-tab-add-menu
        style={{
          left: pos.x,
          top: pos.y,
          width: pos.width,
          maxHeight: `calc(100vh - ${pos.y + 8}px)`,
        }}
        className="fixed z-[90] overflow-y-auto rounded-lg border border-line bg-surface p-3 text-sm shadow-[0_8px_28px_rgba(0,0,0,0.18)]"
      >
        {groups.map(([group, label]) => {
          const options = PROJECT_TAB_VIEW_OPTIONS.filter((option) => option.group === group);
          return (
            <section key={group} className={group === "other" ? "mt-3" : ""}>
              <div className="px-2 pb-1 text-[11px] font-medium text-muted">{label}</div>
              <div className="grid grid-cols-1 gap-x-2 sm:grid-cols-2">
                {options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitem"
                    data-project-tab-add-option={option.value}
                    disabled={busyView !== null}
                    onClick={() => onSelect(option)}
                    className="flex items-start gap-3 rounded-md px-2 py-2 text-left hover:bg-hover focus-visible:bg-neutral-50 focus-visible:outline-none disabled:opacity-50"
                  >
                    <ViewIcon view={option.value} />
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium text-text">
                        {option.label}
                        {busyView === option.value && <span className="ml-2 text-[11px] text-muted">追加中…</span>}
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-[1.35] text-muted">
                        {option.description}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
        {error && <p className="mt-2 px-2 text-[12px] text-danger">{error}</p>}
        <div className="mt-2 border-t border-line-subtle px-2 pt-2">
          <a href="/help" className="text-[12px] text-[#6d5bd0] hover:underline">
            フィードバックを送る
          </a>
        </div>
      </div>
    </>,
    document.body,
  );
}
