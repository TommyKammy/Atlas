"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { smallSecondaryButtonClass } from "./ui/form-controls";

export default function ArchivedProjects({
  initial,
}: {
  initial: { id: number; name: string; archived_at: string; can_manage: boolean }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);

  const restore = async (id: number) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false }),
      });
      if (!res.ok) throw new Error(`restore: ${res.status}`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  if (initial.length === 0) {
    return <p className="mt-2 rounded-lg bg-surface-subtle px-3 py-2 text-[13px] text-muted">アーカイブ済みのプロジェクトはありません。</p>;
  }
  return (
    <div className="mt-2">
      {initial.map((p) => (
        <div key={p.id} className="flex min-h-[40px] flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-subtle px-1 py-1 hover:bg-hover">
          <span className="min-w-0 w-full truncate text-[13px] text-text sm:w-auto sm:flex-1">{p.name}</span>
          <span className="shrink-0 text-[12px] tabular-nums text-muted">{p.archived_at.slice(0, 10)}</span>
          <button
            onClick={() => restore(p.id)}
            disabled={!p.can_manage || busy === p.id}
            className={smallSecondaryButtonClass}
          >
            復元
          </button>
        </div>
      ))}
    </div>
  );
}
