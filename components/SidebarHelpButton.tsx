"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const SHORTCUTS: [string, string][] = [
  ["?", "ショートカット一覧の表示/非表示"],
  ["n", "タスク追加欄にフォーカス"],
  ["g → o/d/l/b/t/c/m/f", "各ビューへ移動"],
  ["Esc", "ヘルプを閉じる"],
];

export default function SidebarHelpButton() {
  const [open, setOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);

  const openMenu = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ left: rect.right + 8, bottom: window.innerHeight - rect.bottom });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        data-sidebar-help
        onClick={openMenu}
        aria-label="ヘルプ"
        title="ヘルプ"
        className="flex h-7 w-7 items-center justify-center rounded-md text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-text-strong"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.6 9a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.2 1-1.2 1.8v.3" />
          <circle cx="12" cy="17" r=".7" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="menu"
            data-sidebar-help-menu
            className="fixed z-[130] w-64 rounded-lg border border-line bg-surface p-1 text-sm text-text shadow-xl"
            style={{ left: pos.left, bottom: pos.bottom }}
          >
            <div className="border-b border-line-subtle px-3 py-2 text-[12px] font-semibold text-muted">
              ヘルプと始め方
            </div>
            <Link href="/help" data-help-features onClick={() => setOpen(false)} className="mt-1 block rounded px-3 py-2 hover:bg-hover">
              機能に関するヘルプ
            </Link>
            <a href="mailto:support@atlas.example" data-help-support onClick={() => setOpen(false)} className="block rounded px-3 py-2 hover:bg-hover">
              サポートに問い合わせる
            </a>
            <Link href="/help#privacy" data-help-privacy onClick={() => setOpen(false)} className="block rounded px-3 py-2 hover:bg-hover">
              プライバシーステートメント
            </Link>
            <Link href="/help#integrations" data-help-integrations onClick={() => setOpen(false)} className="block rounded px-3 py-2 hover:bg-hover">
              アプリと連携
            </Link>
            <button
              type="button"
              data-help-shortcuts
              onClick={() => {
                setOpen(false);
                setShortcuts(true);
              }}
              className="block w-full rounded px-3 py-2 text-left hover:bg-hover"
            >
              キーボードショートカット
            </button>
            <Link href="/help#videos" data-help-videos onClick={() => setOpen(false)} className="block rounded px-3 py-2 hover:bg-hover">
              動画チュートリアル
            </Link>
            <Link href="/help#about" data-help-about onClick={() => setOpen(false)} className="block rounded px-3 py-2 hover:bg-hover">
              Atlas について
            </Link>
            <Link href="/profile" data-help-profile onClick={() => setOpen(false)} className="block rounded px-3 py-2 hover:bg-hover">
              プロフィール
            </Link>
          </div>,
          document.body,
        )}

      {shortcuts &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[140] flex items-center justify-center bg-scrim p-4" onClick={() => setShortcuts(false)}>
            <div data-shortcuts-dialog className="w-[28rem] max-w-[90vw] rounded-lg bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <h2 className="font-bold">キーボードショートカット</h2>
              <div className="mt-3 space-y-2 text-sm">
                {SHORTCUTS.map(([k, desc]) => (
                  <div key={k} className="flex gap-3">
                    <kbd className="shrink-0 rounded border bg-surface-muted px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
                    <span className="text-secondary">{desc}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 text-right">
                <button type="button" data-shortcuts-close onClick={() => setShortcuts(false)} className="rounded bg-accent px-3 py-1 text-sm text-on-accent hover:bg-accent-hover">
                  閉じる
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
