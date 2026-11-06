"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewProjectForm({ workspaceId }: { workspaceId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const create = async () => {
    if (!name.trim()) return;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_id: workspaceId, name }),
    });
    if (!res.ok) throw new Error(`POST /api/projects: ${res.status}`);
    const { id } = await res.json();
    router.push(`/projects/${id}?view=list`);
    router.refresh();
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-4 rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700"
      >
        ＋ 新規プロジェクト
      </button>
    );
  }
  return (
    <div className="mt-4 flex max-w-md gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && create()}
        placeholder="プロジェクト名"
        autoFocus
        className="w-full rounded border px-2 py-1.5 text-sm outline-none focus:border-blue-500"
      />
      <button
        onClick={create}
        className="shrink-0 rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700"
      >
        作成
      </button>
      <button onClick={() => setOpen(false)} className="shrink-0 px-2 text-sm text-neutral-500">
        キャンセル
      </button>
    </div>
  );
}
