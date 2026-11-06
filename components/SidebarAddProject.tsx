"use client";

import { useRef, useState } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useRouter } from "next/navigation";

export default function SidebarAddProject({ workspaceId }: { workspaceId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open, () => setOpen(false));

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId, name: trimmed }),
      });
      if (!res.ok) throw new Error(`POST /api/projects: ${res.status}`);
      const { id } = await res.json();
      setOpen(false);
      setName("");
      router.push(`/projects/${id}?view=list`);
      router.refresh();
    } catch {
      setError("プロジェクトの作成に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        data-sidebar-add-project
        aria-label="新規プロジェクト"
        title="新規プロジェクト"
        onClick={() => setOpen(true)}
        className="flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-white/10 hover:text-white"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M8 3v10M3 8h10" />
        </svg>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
          onClick={() => setOpen(false)}
        >
          <div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sidebar-add-project-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl bg-white p-5 text-neutral-900 shadow-2xl"
          >
            <div id="sidebar-add-project-title" className="text-lg font-semibold">
              新規プロジェクト
            </div>
            <p className="mt-1 text-sm text-neutral-500">プロジェクト名を入力してください。</p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") create();
              }}
              placeholder="プロジェクト名"
              aria-label="プロジェクト名"
              className="mt-4 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
            {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={create}
                disabled={saving || !name.trim()}
                className="rounded-md bg-[#4075cf] px-4 py-1.5 text-sm text-white hover:bg-[#3567b8] disabled:opacity-40"
              >
                {saving ? "作成中…" : "作成"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
