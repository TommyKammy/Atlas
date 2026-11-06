"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DEFAULT_WIDGETS, type DashboardWidgetKey } from "@/lib/dashboard-widgets";

const LABELS: Record<DashboardWidgetKey, string> = {
  donut: "進捗ドーナツ",
  trend: "完了トレンド",
  sections: "セクション別",
  assignees: "担当者別",
  status: "Status別",
  overdue: "期限超過",
};

export default function DashboardSettings({
  projectId,
  initial,
}: {
  projectId: number;
  initial: { key: DashboardWidgetKey; visible: boolean }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [widgets, setWidgets] = useState(initial);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= widgets.length) return;
    const next = [...widgets];
    [next[i], next[j]] = [next[j], next[i]];
    setWidgets(next);
  };

  const save = async () => {
    const res = await fetch("/api/dashboard-prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, widgets }),
    });
    if (res.ok) {
      setOpen(false);
      router.refresh();
    }
  };

  const reset = async () => {
    setWidgets(DEFAULT_WIDGETS);
    const res = await fetch("/api/dashboard-prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, widgets: DEFAULT_WIDGETS }),
    });
    if (res.ok) {
      setOpen(false);
      router.refresh();
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex h-7 items-center rounded-md border bg-white px-2 text-[13px] text-neutral-700 hover:bg-neutral-50"
      >
        ＋ ウィジェットを追加
      </button>
    );
  }
  return (
    <div className="mb-3 rounded-lg border bg-white p-3 shadow">
      {widgets.map((w, i) => (
        <div key={w.key} className="flex items-center gap-2 border-b py-1 text-sm last:border-0">
          <input
            type="checkbox"
            checked={w.visible}
            onChange={() =>
              setWidgets((ws) => ws.map((x, j) => (j === i ? { ...x, visible: !x.visible } : x)))
            }
          />
          <span className="min-w-0 flex-1">{LABELS[w.key]}</span>
          <button onClick={() => move(i, -1)} className="px-1 text-neutral-400 hover:text-black" title="上へ">
            ↑
          </button>
          <button onClick={() => move(i, 1)} className="px-1 text-neutral-400 hover:text-black" title="下へ">
            ↓
          </button>
        </div>
      ))}
      <div className="mt-2 flex gap-2">
        <button onClick={save} className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700">
          保存
        </button>
        <button onClick={reset} className="rounded border px-3 py-1 text-sm hover:bg-neutral-50">
          既定に戻す
        </button>
        <button onClick={() => setOpen(false)} className="px-2 text-sm text-neutral-500">
          閉じる
        </button>
      </div>
    </div>
  );
}
