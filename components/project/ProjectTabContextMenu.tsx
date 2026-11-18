"use client";

import { useRef } from "react";
import { createPortal } from "react-dom";
import type { ProjectTab } from "@/lib/data";
import { useMenuKeyboard } from "@/lib/use-menu-keyboard";

export type ProjectTabMenuAction = "rename" | "default" | "duplicate" | "copy" | "delete";

/** Right-click menu for one project tab, matching Asana's option set. */
export default function ProjectTabContextMenu({
  tab,
  pos,
  isDefault,
  canEdit,
  canDelete,
  busy,
  onClose,
  onAction,
}: {
  tab: ProjectTab;
  pos: { x: number; y: number };
  isDefault: boolean;
  canEdit: boolean;
  canDelete: boolean;
  busy: boolean;
  onClose: () => void;
  onAction: (action: ProjectTabMenuAction) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useMenuKeyboard({ containerRef: panelRef, onClose });

  if (typeof document === "undefined") return null;
  const item =
    "flex h-9 w-full items-center px-3 text-left text-[14px] text-neutral-800 hover:bg-neutral-100 disabled:cursor-default disabled:text-neutral-400 disabled:hover:bg-white";

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[80]"
        onMouseDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={panelRef}
        role="menu"
        aria-label={`${tab.name}のタブメニュー`}
        data-project-tab-menu
        style={{ left: pos.x, top: pos.y }}
        className="fixed z-[90] w-[190px] rounded-md border border-line bg-surface py-1 shadow-[0_4px_16px_rgba(0,0,0,0.18)]"
      >
        <button
          type="button"
          role="menuitem"
          data-project-tab-menu-item="rename"
          disabled={!canEdit || busy}
          onClick={() => onAction("rename")}
          className={item}
        >
          名前を変更
        </button>
        <button
          type="button"
          role="menuitem"
          data-project-tab-menu-item="default"
          disabled={isDefault || busy}
          onClick={() => onAction("default")}
          className={item}
        >
          デフォルトとして設定
        </button>
        <button
          type="button"
          role="menuitem"
          data-project-tab-menu-item="duplicate"
          disabled={!canEdit || busy}
          onClick={() => onAction("duplicate")}
          className={item}
        >
          コピーを作成
        </button>
        <button
          type="button"
          role="menuitem"
          data-project-tab-menu-item="copy"
          disabled={busy}
          onClick={() => onAction("copy")}
          className={item}
        >
          リンクをコピー
        </button>
        <button
          type="button"
          role="menuitem"
          data-project-tab-menu-item="delete"
          disabled={!canEdit || !canDelete || busy}
          onClick={() => onAction("delete")}
          className={`${item} text-red-600 hover:bg-red-50 disabled:text-neutral-400 disabled:hover:bg-white`}
        >
          削除
        </button>
      </div>
    </>,
    document.body,
  );
}
