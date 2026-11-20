"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  KEYBOARD_SHORTCUT_SCOPES,
  SHORTCUT_SCOPE_DESCRIPTIONS,
  SHORTCUT_SCOPE_LABELS,
  shortcutsForScope,
} from "@/lib/keyboard-shortcuts";

export default function SidebarHelpButton() {
  const [open, setOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The menu is fixed to the viewport next to the button. Keep it fully on
  // screen and follow the button if the layout settles after opening.
  const placeMenu = useCallback(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 8;
    const height = menuRef.current?.offsetHeight ?? 0;
    const maxBottom = Math.max(margin, window.innerHeight - margin - height);
    const bottom = Math.min(Math.max(margin, window.innerHeight - rect.bottom), maxBottom);
    setPos((current) =>
      current && current.left === rect.right + 8 && current.bottom === bottom
        ? current
        : { left: rect.right + 8, bottom },
    );
  }, []);

  const openMenu = () => {
    placeMenu();
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    placeMenu();
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [open, placeMenu]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
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
            ref={menuRef}
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
            <Link href="/help#new-ui" data-help-new-ui onClick={() => setOpen(false)} className="block rounded px-3 py-2 hover:bg-hover">
              新しい画面について
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
              <div className="mt-3 space-y-4 text-sm">
                {KEYBOARD_SHORTCUT_SCOPES.map((scope) => (
                  <div key={scope} data-shortcut-group={scope}>
                    <h3 className="text-[12px] font-semibold text-text">{SHORTCUT_SCOPE_LABELS[scope]}</h3>
                    <p className="mt-0.5 text-[11px] text-muted">{SHORTCUT_SCOPE_DESCRIPTIONS[scope]}</p>
                    <div className="mt-2 space-y-2">
                      {shortcutsForScope(scope).map((shortcut) => (
                        <div key={shortcut.id} className="flex gap-3">
                          <kbd className="shrink-0 rounded border border-line bg-surface-muted px-1.5 py-0.5 font-mono text-xs">{shortcut.keys}</kbd>
                          <span className="text-secondary">{shortcut.description}</span>
                        </div>
                      ))}
                    </div>
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
