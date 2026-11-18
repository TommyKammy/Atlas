"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type CreateMenuVariant = "sidebar" | "mobile" | "rail";

const ACTION = "bg-[#c94848] text-white hover:bg-[#b83c3c]";
const MENU_PANEL = "absolute z-50 w-48 rounded-lg border bg-surface py-1 text-sm text-neutral-800 shadow-xl";
const MENU_ITEM = "block w-full px-3 py-1.5 text-left hover:bg-neutral-100";

const BUTTON: Record<CreateMenuVariant, string> = {
  sidebar: `flex h-8 shrink-0 items-center justify-center gap-0.5 rounded-md px-1.5 text-[13px] font-medium ${ACTION}`,
  mobile: `flex h-8 shrink-0 items-center justify-center gap-1 rounded-full px-2.5 text-[13px] font-medium ${ACTION}`,
  rail: `flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${ACTION}`,
};

const MENU_POSITION: Record<CreateMenuVariant, string> = {
  sidebar: "top-9 left-0",
  mobile: "top-9 right-0",
  rail: "top-0 left-full ml-2",
};

export default function CreateMenu({
  canCreateProject,
  variant = "sidebar",
}: {
  canCreateProject: boolean;
  variant?: CreateMenuVariant;
}) {
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
  }, [open]);

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

  const rail = variant === "rail";

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        data-create-menu
        onClick={() => setOpen((o) => !o)}
        aria-label={rail ? "作成" : undefined}
        title={rail ? "作成" : undefined}
        aria-expanded={open}
        className={BUTTON[variant]}
      >
        {rail ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
            className="h-[18px] w-[18px]"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        ) : (
          <>
            <span aria-hidden="true" className="text-base leading-none">＋</span> 作成
          </>
        )}
      </button>
      {open && (
        <div className={`${MENU_PANEL} ${MENU_POSITION[variant]}`}>
          <button type="button" onClick={newTask} className={MENU_ITEM}>
            タスク
          </button>
          {canCreateProject && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push("/projects/new");
              }}
              className={MENU_ITEM}
            >
              プロジェクト
            </button>
          )}
        </div>
      )}
    </div>
  );
}
