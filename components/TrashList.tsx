"use client";

import { confirmAction } from "@/lib/ui-feedback";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { smallDangerButtonClass, smallSecondaryButtonClass } from "./ui/form-controls";

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
    return <p className="mt-2 rounded-lg bg-surface-subtle px-3 py-2 text-[13px] text-muted">ゴミ箱は空です。</p>;
  }
  return (
    <div className="mt-2">
      {initial.map((t) => (
        <div key={t.id} className="flex min-h-[40px] flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-subtle px-1 py-1 hover:bg-hover">
          <span className="min-w-0 w-full truncate text-[13px] text-muted line-through sm:w-auto sm:flex-1">{t.name}</span>
          <span className="shrink-0 text-[12px] text-muted">{t.project_name ?? "–"}</span>
          <button
            onClick={() => restore(t.id)}
            disabled={!t.can_edit || busy === t.id}
            className={smallSecondaryButtonClass}
          >
            復元
          </button>
          <button
            onClick={() => purge(t.id, t.name)}
            disabled={!t.can_edit || busy === t.id}
            className={smallDangerButtonClass}
          >
            完全削除
          </button>
        </div>
      ))}
    </div>
  );
}
