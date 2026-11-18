"use client";

import { isImeComposing } from "@/lib/ime-keyboard";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
  ["Enter", "選択中のタスクを開く"],
  ["Esc", "タスクペイン / ヘルプを閉じる"],
];

export default function Shortcuts({ projectId }: { projectId: number }) {
  const router = useRouter();
  const [help, setHelp] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.metaKey || e.ctrlKey || e.altKey) {
        if (e.key === "Escape") (document.activeElement as HTMLElement | null)?.blur?.();
        return;
      }
      if (e.key === "?") {
        setHelp((h) => !h);
        setArmed(false);
        return;
      }
      if (e.key === "Escape") {
        setHelp(false);
        setArmed(false);
        return;
      }
      if (armed) {
        setArmed(false);
        if (timer) clearTimeout(timer);
        const view = VIEW_KEYS[e.key];
        if (view) router.push(`/projects/${projectId}?view=${view}`);
        return;
      }
      if (e.key === "g") {
        setArmed(true);
        timer = setTimeout(() => setArmed(false), 800);
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
      if (timer) clearTimeout(timer);
    };
  }, [armed, projectId, router]);

  if (!help) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim" onClick={() => setHelp(false)}>
      <div className="w-[28rem] max-w-[90vw] rounded-lg bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-bold">キーボードショートカット</h2>
        <div className="mt-3 space-y-2 text-sm">
          {HELP.map(([k, desc]) => (
            <div key={k} className="flex gap-3">
              <kbd className="shrink-0 rounded border bg-surface-muted px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
              <span className="text-secondary">{desc}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 text-right">
          <button onClick={() => setHelp(false)} className="rounded bg-inverse-surface px-3 py-1 text-sm text-on-strong">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
