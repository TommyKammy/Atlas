"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function CreateMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  const firstProject = async (): Promise<number | null> => {
    try {
      const res = await fetch("/api/lookup");
      if (!res.ok) return null;
      const rows = (await res.json()) as { id: number }[];
      return rows[0]?.id ?? null;
    } catch {
      return null;
    }
  };

  const newTask = async () => {
    setOpen(false);
    const id = await firstProject();
    if (id === null) {
      router.push("/");
      return;
    }
    router.push(`/projects/${id}?view=list&focus=add`);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-1 rounded-full bg-[#f06a6a] px-3 text-sm font-medium text-white hover:bg-[#ec5b5b]"
      >
        <span className="text-base leading-none">＋</span> 作成
      </button>
      {open && (
        <div className="absolute top-9 left-0 z-50 w-48 rounded-lg border bg-white py-1 text-sm text-neutral-800 shadow-xl">
          <button onClick={newTask} className="block w-full px-3 py-1.5 text-left hover:bg-neutral-100">
            タスク
          </button>
          <button
            onClick={() => {
              setOpen(false);
              router.push("/");
            }}
            className="block w-full px-3 py-1.5 text-left hover:bg-neutral-100"
          >
            プロジェクト
          </button>
        </div>
      )}
    </div>
  );
}
