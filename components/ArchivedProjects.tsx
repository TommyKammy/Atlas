"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ArchivedProjects({
  initial,
}: {
  initial: { id: number; name: string; archived_at: string }[];
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
    return <p className="mt-2 text-sm text-neutral-500">アーカイブ済みのプロジェクトはありません。</p>;
  }
  return (
    <div className="mt-2 max-w-4xl">
      {initial.map((p) => (
        <div key={p.id} className="flex items-center gap-3 border-b py-2 text-sm">
          <span className="min-w-0 flex-1 truncate">{p.name}</span>
          <span className="shrink-0 text-xs text-neutral-400">{p.archived_at.slice(0, 10)}</span>
          <button
            onClick={() => restore(p.id)}
            disabled={busy === p.id}
            className="shrink-0 rounded border px-2 py-0.5 hover:bg-neutral-100 disabled:opacity-50"
          >
            復元
          </button>
        </div>
      ))}
    </div>
  );
}
