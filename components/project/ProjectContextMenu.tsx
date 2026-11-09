"use client";

import { createPortal } from "react-dom";
import { useRef } from "react";
import { useMenuKeyboard } from "@/lib/use-menu-keyboard";

type MenuProject = { id: number; name: string };

function MenuIcon({ name }: { name: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "h-4 w-4 shrink-0 text-neutral-500",
  };
  if (name === "share")
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" />
        <path d="M16 4h5v5M21 4l-6 6" />
      </svg>
    );
  if (name === "external")
    return (
      <svg {...common}>
        <path d="M14 4h6v6M20 4l-9 9" />
        <path d="M18 14v5H5V6h5" />
      </svg>
    );
  if (name === "link")
    return (
      <svg {...common}>
        <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5" />
        <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" />
      </svg>
    );
  if (name === "palette")
    return (
      <svg {...common}>
        <path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 1.4-3.4 2 2 0 0 1 1.4-3.4H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3z" />
        <circle cx="7.5" cy="11" r=".8" fill="currentColor" />
        <circle cx="10" cy="7.5" r=".8" fill="currentColor" />
        <circle cx="14.5" cy="7" r=".8" fill="currentColor" />
      </svg>
    );
  if (name === "pencil")
    return (
      <svg {...common}>
        <path d="m4 20 4-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5 16z" />
        <path d="m13.5 7.5 3 3" />
      </svg>
    );
  if (name === "star")
    return (
      <svg {...common}>
        <path d="m12 3 2.7 5.9 6.3.7-4.7 4.3 1.3 6.3-5.6-3.2-5.6 3.2 1.3-6.3L3 9.6l6.3-.7z" />
      </svg>
    );
  if (name === "plus")
    return (
      <svg {...common}>
        <path d="M4 4h16v16H4z" />
        <path d="M12 8v8M8 12h8" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M3 7h18v13H3z" />
      <path d="M3 7h18M9 7V4h6v3" />
      <path d="M10 12h4" />
    </svg>
  );
}

/** Right-click project menu rendered at a viewport position. */
export default function ProjectContextMenu({
  pos,
  project,
  starred,
  busy,
  onClose,
  onShare,
  onOpenNewTab,
  onCopyLink,
  onAppearance,
  onRename,
  onToggleFavorite,
  onAddPortfolio,
  onArchive,
}: {
  pos: { x: number; y: number };
  project: MenuProject;
  starred: boolean;
  busy: boolean;
  onClose: () => void;
  onShare: () => void;
  onOpenNewTab: () => void;
  onCopyLink: () => void;
  onAppearance: () => void;
  onRename: () => void;
  onToggleFavorite: () => void;
  onAddPortfolio: () => void;
  onArchive: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useMenuKeyboard({ containerRef: menuRef, onClose });
  if (typeof document === "undefined") return null;
  const item =
    "flex h-9 w-full items-center gap-2 px-3 text-left text-[14px] text-neutral-800 hover:bg-neutral-100";
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
        ref={menuRef}
        role="menu"
        aria-label={`${project.name}のメニュー`}
        style={{ left: pos.x, top: pos.y }}
        className="fixed z-[90] w-[225px] rounded-md border bg-white py-1 shadow-[0_4px_16px_rgba(0,0,0,0.18)]"
      >
        <button className={item} onClick={onShare}>
          <MenuIcon name="share" /> プロジェクトを共有
        </button>
        <button className={item} onClick={onOpenNewTab}>
          <MenuIcon name="external" /> 新しいタブで開く
        </button>
        <button className={item} onClick={onCopyLink}>
          <MenuIcon name="link" /> リンクをコピー
        </button>
        <button className={item} onClick={onAppearance}>
          <MenuIcon name="palette" /> カラーとアイコンを設定
          <span className="ml-auto text-neutral-400">›</span>
        </button>
        <button className={item} onClick={onRename}>
          <MenuIcon name="pencil" /> 名前を変更
        </button>
        <button className={item} disabled={busy} onClick={onToggleFavorite}>
          <MenuIcon name="star" /> {starred ? "お気に入りから削除" : "お気に入りに追加"}
        </button>
        <button className={item} disabled={busy} onClick={onAddPortfolio}>
          <MenuIcon name="plus" /> ポートフォリオに追加
        </button>
        <button className={item} onClick={onArchive}>
          <MenuIcon name="archive" /> プロジェクトをアーカイブ
        </button>
      </div>
    </>,
    document.body,
  );
}
