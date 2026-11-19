"use client";

import {
  dialogCloseClass,
  dialogTitleClass,
  secondaryButtonClass,
} from "@/components/ui/form-controls";
import { isImeComposing } from "@/lib/ime-keyboard";
import { shouldIgnoreSingleKeyShortcut } from "@/lib/keyboard-shortcuts";
import { useFocusTrap } from "@/lib/use-focus-trap";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

const VIEW_KEYS: Record<string, string> = {
  o: "overview",
  d: "dashboard",
  l: "list",
  b: "board",
  t: "timeline",
  c: "calendar",
  m: "messages",
  f: "files",
};

const HELP: [string, string][] = [
  ["?", "ショートカット一覧の表示/非表示"],
  ["n", "タスク追加欄にフォーカス"],
  ["g → o/d/l/b/t/c/m/f", "概要/ダッシュボード/リスト/ボード/タイムライン/カレンダー/メッセージ/ファイルへ移動"],
  ["↑ / ↓", "リスト内のタスク行を移動"],
  ["j / k", "リスト内のタスク行を移動（次 / 前）"],
  ["Enter", "選択中のタスクを開く"],
  ["Esc", "タスクペイン / ヘルプを閉じる"],
];

export default function Shortcuts({ projectId }: { projectId: number }) {
  const router = useRouter();
  const [help, setHelp] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const armed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const helpTitleId = useId();

  useFocusTrap(panelRef, help, () => setHelp(false));

  useEffect(() => {
    const disarm = () => {
      armed.current = false;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };

    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName ?? "";
      // Escape still leaves a plain text field before the shortcut guard runs.
      if (
        e.key === "Escape" &&
        !isImeComposing(e) &&
        (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
      ) {
        (document.activeElement as HTMLElement | null)?.blur?.();
        return;
      }
      if (shouldIgnoreSingleKeyShortcut(e)) {
        // A g prefix must not survive a detour through an input or an IME.
        disarm();
        return;
      }
      if (help) {
        if (e.key === "Escape" || e.key === "?") {
          setHelp(false);
          disarm();
        }
        return;
      }
      if (e.key === "?") {
        setHelp((current) => !current);
        disarm();
        return;
      }
      if (e.key === "Escape") {
        setHelp(false);
        disarm();
        return;
      }
      if (armed.current) {
        disarm();
        const view = VIEW_KEYS[e.key];
        if (view) router.push(`/projects/${projectId}?view=${view}`);
        return;
      }
      if (e.key === "g") {
        disarm();
        armed.current = true;
        timer.current = setTimeout(() => {
          armed.current = false;
          timer.current = null;
        }, 800);
        return;
      }
      if (e.key === "n") {
        const input = document.querySelector<HTMLInputElement>("input[data-add-task]");
        if (input) {
          input.focus();
        } else {
          document.querySelector<HTMLButtonElement>("button[data-add-task-open]")?.click();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      disarm();
    };
  }, [help, projectId, router]);

  if (!help) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
      onClick={() => setHelp(false)}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={helpTitleId}
        data-shortcuts-dialog
        onClick={(e) => e.stopPropagation()}
        className="w-[28rem] max-w-[90vw] overflow-hidden rounded-lg border border-line bg-surface shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line-subtle px-5 py-4">
          <h2 id={helpTitleId} className={dialogTitleClass}>
            キーボードショートカット
          </h2>
          <button type="button" aria-label="閉じる" onClick={() => setHelp(false)} className={dialogCloseClass}>
            ×
          </button>
        </div>
        <div className="space-y-2 px-5 py-4 text-sm">
          {HELP.map(([k, desc]) => (
            <div key={k} className="flex gap-3">
              <kbd className="shrink-0 rounded border border-line bg-surface-muted px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
              <span className="text-secondary">{desc}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-end border-t border-line-subtle px-5 py-3">
          <button type="button" onClick={() => setHelp(false)} className={secondaryButtonClass}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
