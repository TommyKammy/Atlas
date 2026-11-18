"use client";

import { confirmAction } from "@/lib/ui-feedback";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function TrashList({
  initial,
}: {
  initial: { id: number; name: string; project_name: string | null; can_edit: boolean; deleted_at: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);

  const restore = async (id: number) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/tasks/${id}/restore`, { method: "POST" });
      if (!res.ok) throw new Error(`restore: ${res.status}`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const purge = async (id: number, name: string) => {
    if (!await confirmAction(`「${name}」を完全に削除しますか？（元に戻せません）`)) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/tasks/${id}?force=1`, { method: "DELETE" });
      if (!res.ok) throw new Error(`purge: ${res.status}`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  if (initial.length === 0) {
    return <p className="mt-4 text-sm text-muted">ゴミ箱は空です。</p>;
  }
  return (
    <div className="mt-4 max-w-4xl">
      {initial.map((t) => (
        <div key={t.id} className="flex items-center gap-3 border-b py-2 text-sm">
          <span className="min-w-0 flex-1 truncate text-muted line-through">{t.name}</span>
          <span className="shrink-0 text-xs text-subtle">{t.project_name ?? "–"}</span>
          <button
            onClick={() => restore(t.id)}
            disabled={!t.can_edit || busy === t.id}
            className="shrink-0 rounded border px-2 py-0.5 hover:bg-neutral-100 disabled:opacity-50"
          >
            復元
          </button>
          <button
            onClick={() => purge(t.id, t.name)}
            disabled={!t.can_edit || busy === t.id}
            className="shrink-0 rounded border border-red-300 px-2 py-0.5 text-danger hover:bg-red-50 disabled:opacity-50"
          >
            完全削除
          </button>
        </div>
      ))}
    </div>
  );
}
