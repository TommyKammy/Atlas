"use client";

import { confirmAction } from "@/lib/ui-feedback";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { ProjectTab } from "@/lib/data";
import { useFocusTrap } from "@/lib/use-focus-trap";

const VIEW_OPTIONS = [
  ["overview", "概要"],
  ["dashboard", "ダッシュボード"],
  ["list", "リスト"],
  ["board", "ボード"],
  ["timeline", "タイムライン"],
  ["calendar", "カレンダー"],
  ["messages", "メッセージ"],
  ["knowledge", "知識"],
  ["files", "ファイル"],
  ["forms", "フォーム"],
] as const;

function tabHref(projectId: number, tab: ProjectTab) {
  const base = `/projects/${projectId}?view=${tab.view_type}`;
  return tab.is_custom ? `${base}&tab=${encodeURIComponent(tab.tab_key)}` : base;
}

export default function ProjectTabs({
  projectId,
  active,
  activeTabKey,
  tabs,
}: {
  projectId: number;
  active: string;
  activeTabKey: string | null;
  tabs: ProjectTab[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [viewType, setViewType] = useState("list");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [draggingTab, setDraggingTab] = useState(false);
  const dialogRef = useRef<HTMLFormElement>(null);
  useFocusTrap(dialogRef, open, () => setOpen(false));
  const dragging = useRef(false);
  const draggedId = useRef<number | null>(null);

  const activeKey = activeTabKey ?? tabs.find((tab) => tab.view_type === active)?.tab_key ?? null;

  const addTab = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/project-tabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, name: name.trim(), view_type: viewType }),
      });
      if (!res.ok) throw new Error(`タブの追加に失敗しました (${res.status})`);
      setOpen(false);
      setName("");
      setViewType("list");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "タブの追加に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const reorder = async (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    const next = [...tabs];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    const res = await fetch("/api/project-tabs/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, ids: next.map((tab) => tab.id) }),
    });
    if (res.ok) router.refresh();
  };

  const removeTab = async (tab: ProjectTab) => {
    if (!tab.is_custom || !await confirmAction(`「${tab.name}」タブを削除しますか？`)) return;
    const res = await fetch(`/api/project-tabs/${tab.id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  };

  return (
    <>
      <nav className="relative flex items-center gap-2 overflow-x-auto px-6 py-[3px] text-sm whitespace-nowrap">
        {tabs.map((tab, index) => (
          <div
            key={tab.id}
            draggable
            data-project-tab={tab.tab_key}
            onDragStart={(event) => {
              dragging.current = true;
              draggedId.current = tab.id;
              setDraggingTab(true);
              event.dataTransfer.setData("text/atlas-tab", String(tab.id));
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => {
              setTimeout(() => {
                dragging.current = false;
                draggedId.current = null;
                setDraggingTab(false);
                setDropIndex(null);
              }, 0);
            }}
            className={`group relative flex shrink-0 items-center rounded-md ${
              dropIndex === index ? "border-l-2 border-[#2c60b8]" : ""
            }`}
          >
            <Link
              href={tabHref(projectId, tab)}
              onClick={(event) => {
                if (dragging.current) event.preventDefault();
              }}
              className={`flex h-7 items-center rounded-md px-2 text-[14px] font-medium ${
                activeKey === tab.tab_key
                  ? "bg-[#eff4fd] text-[#2C60B8]"
                  : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
              }`}
            >
              {tab.name}
            </Link>
            {tab.is_custom && (
              <button
                type="button"
                data-project-tab-delete={tab.id}
                aria-label={`${tab.name}タブを削除`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void removeTab(tab);
                }}
                className="mr-1 hidden h-4 w-4 items-center justify-center rounded text-neutral-400 hover:bg-red-50 hover:text-red-600 group-hover:flex"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {draggingTab && (
          <div
            data-project-tab-dropzone
            className="absolute inset-0 z-10"
            onDragOver={(event) => {
              event.preventDefault();
              const rects = [...document.querySelectorAll<HTMLElement>("[data-project-tab]")].map((el) =>
                el.getBoundingClientRect(),
              );
              let raw = 0;
              for (const rect of rects) {
                if (event.clientX > rect.left + rect.width / 2) raw += 1;
              }
              const from = tabs.findIndex((tab) => tab.id === draggedId.current);
              const index = Math.max(0, Math.min(tabs.length - 1, from >= 0 && from < raw ? raw - 1 : raw));
              setDropIndex(index);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const rects = [...document.querySelectorAll<HTMLElement>("[data-project-tab]")].map((el) =>
                el.getBoundingClientRect(),
              );
              let raw = 0;
              for (const rect of rects) {
                if (event.clientX > rect.left + rect.width / 2) raw += 1;
              }
              const from = tabs.findIndex((tab) => tab.id === draggedId.current);
              const index = Math.max(0, Math.min(tabs.length - 1, from >= 0 && from < raw ? raw - 1 : raw));
              setDropIndex(null);
              void reorder(from, index);
            }}
          />
        )}
        <button
          type="button"
          data-project-tab-add
          aria-label="タブを追加"
          onClick={() => {
            setError("");
            setOpen(true);
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[17px] leading-none text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
        >
          ＋
        </button>
      </nav>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-24" role="dialog" aria-modal="true">
          <form
            ref={dialogRef}
            tabIndex={-1}
            onSubmit={addTab}
            data-project-tab-composer
            className="w-[360px] rounded-lg border border-neutral-200 bg-white p-5 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-neutral-900">タブを追加</h2>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setOpen(false)}
                className="text-lg leading-none text-neutral-400 hover:text-neutral-700"
              >
                ×
              </button>
            </div>
            <label className="mt-4 block text-[12px] font-medium text-neutral-600">
              タブ名
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                data-project-tab-name
                placeholder="例: 週次ボード"
                className="mt-1 h-8 w-full rounded-md border border-neutral-200 px-2 text-[13px] outline-none focus:border-[#2c60b8]"
              />
            </label>
            <label className="mt-3 block text-[12px] font-medium text-neutral-600">
              表示するビュー
              <select
                value={viewType}
                onChange={(event) => setViewType(event.target.value)}
                data-project-tab-view
                className="mt-1 h-8 w-full rounded-md border border-neutral-200 bg-white px-2 text-[13px] outline-none focus:border-[#2c60b8]"
              >
                {VIEW_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {error && <p className="mt-3 text-[12px] text-red-600">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded px-3 py-1.5 text-[13px] text-neutral-500 hover:bg-neutral-100"
              >
                キャンセル
              </button>
              <button
                type="submit"
                data-project-tab-save
                disabled={busy}
                className="rounded bg-[#2c60b8] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#24529c] disabled:opacity-50"
              >
                追加
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
