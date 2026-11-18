"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PROJECT_MENU_GROUPS,
  canUseProjectAction,
  type ProjectActionKey,
  type ProjectMenuItem,
} from "@/lib/project-actions";
import { PROJECT_ROLES, type ProjectRole } from "@/lib/project-roles";
import ProjectMenuIcon from "./ProjectMenuIcon";

const MENU_WIDTH = 264;
const SUBMENU_WIDTH = 300;

export default function ProjectActionsMenu({
  pos,
  role,
  projectSettings,
  onClose,
  onSelect,
}: {
  pos: { x: number; y: number };
  role: ProjectRole;
  projectSettings?: unknown;
  onClose: () => void;
  onSelect: (action: ProjectActionKey) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const submenuRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [submenu, setSubmenu] = useState<ProjectMenuItem | null>(null);
  const [submenuPos, setSubmenuPos] = useState<{ x: number; y: number } | null>(null);

  const groups = useMemo(
    () =>
      PROJECT_MENU_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => canUseProjectAction(role, item, projectSettings)),
      })).filter((group) => group.items.length > 0),
    [role, projectSettings],
  );

  useEffect(() => {
    const first = itemRefs.current.find((item) => item && !item.disabled);
    first?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onResize = () => onClose();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [onClose]);

  const focusTop = (index: number) => {
    const buttons = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
    if (buttons.length === 0) return;
    const next = ((index % buttons.length) + buttons.length) % buttons.length;
    buttons[next]?.focus({ preventScroll: true });
  };

  const openSubmenu = (item: ProjectMenuItem, element: HTMLButtonElement) => {
    if (!item.submenu) return;
    setSubmenu(item);
    const rect = element.getBoundingClientRect();
    const preferredX = pos.x + MENU_WIDTH + 4;
    const x =
      preferredX + SUBMENU_WIDTH > window.innerWidth - 8
        ? Math.max(8, pos.x - SUBMENU_WIDTH - 4)
        : preferredX;
    setSubmenuPos({
      x,
      y: Math.max(8, Math.min(rect.top - 6, window.innerHeight - Math.min(480, item.submenu.length * 36 + 16) - 8)),
    });
    window.requestAnimationFrame(() => submenuRefs.current[0]?.focus({ preventScroll: true }));
  };

  const closeSubmenu = () => {
    setSubmenu(null);
    setSubmenuPos(null);
  };

  const select = (key: ProjectActionKey) => {
    onClose();
    onSelect(key);
  };

  if (typeof document === "undefined") return null;

  const topButtons = groups.flatMap((group) => group.items);
  const itemClass = (danger: boolean | undefined) =>
    `flex h-9 w-full items-center gap-2.5 px-3 text-left text-[13.5px] leading-5 outline-none transition focus-visible:bg-[#eef3fb] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2c60b8] ${
      danger ? "text-[#b42318] hover:bg-[#fdf2f1] focus-visible:bg-[#fdf2f1]" : "text-neutral-800 hover:bg-neutral-100"
    }`;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[95]"
        onMouseDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={menuRef}
        role="menu"
        aria-label="プロジェクトのアクション"
        data-project-actions-menu
        style={{ left: pos.x, top: pos.y, width: MENU_WIDTH }}
        className="fixed z-[96] max-h-[calc(100vh-24px)] overflow-y-auto rounded-lg border border-neutral-200 bg-surface py-1.5 shadow-[0_8px_28px_rgba(0,0,0,0.18),0_2px_6px_rgba(0,0,0,0.08)]"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (submenu) {
              closeSubmenu();
              const parentIndex = topButtons.findIndex((item) => item.key === submenu.key);
              window.requestAnimationFrame(() => focusTop(parentIndex));
            } else {
              onClose();
            }
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const current = document.activeElement as HTMLElement | null;
            const index = itemRefs.current.findIndex((item) => item === current);
            focusTop(index + (event.key === "ArrowDown" ? 1 : -1));
            closeSubmenu();
            return;
          }
          if (event.key === "ArrowRight") {
            const current = document.activeElement as HTMLButtonElement | null;
            const index = itemRefs.current.findIndex((item) => item === current);
            const item = index >= 0 ? topButtons[index] : null;
            if (item?.submenu && current) {
              event.preventDefault();
              openSubmenu(item, current);
            }
          }
        }}
      >
        {groups.map((group, groupIndex) => (
          <div
            key={group.label}
            data-project-action-group={groupIndex}
            className={groupIndex === 0 ? "" : "mt-1.5 border-t border-neutral-200 pt-1.5"}
          >
            {group.items.map((item, itemIndex) => {
              const flatIndex = groups
                .slice(0, groupIndex)
                .reduce((sum, previous) => sum + previous.items.length, 0) + itemIndex;
              const hasSubmenu = Boolean(item.submenu);
              return (
                <button
                  key={`${item.key}-${itemIndex}`}
                  ref={(element) => {
                    itemRefs.current[flatIndex] = element;
                  }}
                  type="button"
                  role="menuitem"
                  aria-haspopup={hasSubmenu ? "menu" : undefined}
                  aria-expanded={hasSubmenu ? submenu?.key === item.key : undefined}
                  data-project-action={item.key}
                  className={itemClass(item.danger)}
                  onMouseEnter={(event) => {
                    if (hasSubmenu) openSubmenu(item, event.currentTarget);
                    else closeSubmenu();
                  }}
                  onFocus={() => {
                    if (!hasSubmenu) closeSubmenu();
                  }}
                  onClick={(event) => {
                    if (hasSubmenu) {
                      event.preventDefault();
                      if (submenu?.key === item.key) closeSubmenu();
                      else openSubmenu(item, event.currentTarget);
                      return;
                    }
                    select(item.key);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      if (hasSubmenu) {
                        if (submenu?.key === item.key) closeSubmenu();
                        else openSubmenu(item, event.currentTarget);
                      } else {
                        select(item.key);
                      }
                    }
                  }}
                >
                  <ProjectMenuIcon
                    name={item.icon}
                    className={item.danger ? "h-4 w-4 text-[#b42318]" : "h-4 w-4 text-muted"}
                  />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {hasSubmenu && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5 text-subtle">
                      <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {submenu && submenuPos && (
        <div
          role="menu"
          aria-label={submenu.label}
          data-project-actions-submenu={submenu.key}
          style={{ left: submenuPos.x, top: submenuPos.y, width: SUBMENU_WIDTH }}
          className="fixed z-[97] max-h-[calc(100vh-24px)] overflow-y-auto rounded-lg border border-neutral-200 bg-surface py-1.5 shadow-[0_8px_28px_rgba(0,0,0,0.18),0_2px_6px_rgba(0,0,0,0.08)]"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeSubmenu();
              const parentIndex = topButtons.findIndex((item) => item.key === submenu.key);
              window.requestAnimationFrame(() => focusTop(parentIndex));
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const buttons = submenuRefs.current.filter(
                (item): item is HTMLButtonElement => item !== null,
              );
              if (buttons.length === 0) return;
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next = (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
              buttons[next]?.focus();
              return;
            }
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              closeSubmenu();
              const parentIndex = topButtons.findIndex((item) => item.key === submenu.key);
              window.requestAnimationFrame(() => focusTop(parentIndex));
            }
          }}
        >
          {submenu.submenu
            ?.filter((sub) => canUseProjectAction(role, { key: sub.key, roles: sub.roles ?? PROJECT_ROLES }, projectSettings))
            .map((sub, index) => (
            <button
              key={`${sub.key}-${index}`}
              ref={(element) => {
                submenuRefs.current[index] = element;
              }}
              type="button"
              role="menuitem"
              data-project-action={sub.key}
              className={itemClass(false)}
              onClick={() => select(sub.key)}
              onMouseEnter={(event) => {
                event.currentTarget.focus({ preventScroll: true });
              }}
            >
              <ProjectMenuIcon name={sub.icon} className="h-4 w-4 text-muted" />
              <span className="min-w-0 flex-1 truncate">{sub.label}</span>
            </button>
          ))}
        </div>
      )}
    </>,
    document.body,
  );
}
