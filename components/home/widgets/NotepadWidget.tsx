"use client";

import { useEffect, useRef, useState } from "react";
import { formatDateTime } from "@/lib/dates";
import type { HomeNotepad } from "@/lib/home-widgets";
import { toast } from "@/lib/ui-feedback";

type SaveState = "idle" | "saving" | "saved";

/** Private per-user scratchpad with debounced autosave. */
export default function NotepadWidget({ initial }: { initial: HomeNotepad }) {
  const [value, setValue] = useState(initial.body);
  const [savedAt, setSavedAt] = useState(initial.updated_at);
  const [state, setState] = useState<SaveState>("idle");
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!dirtyRef.current) return;
    const handle = setTimeout(async () => {
      setState("saving");
      try {
        const res = await fetch("/api/notepad", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: value }),
        });
        if (!res.ok) throw new Error(`保存に失敗しました (${res.status})`);
        const data = (await res.json()) as { notepad: HomeNotepad };
        setSavedAt(data.notepad.updated_at);
        setState("saved");
      } catch (error) {
        setState("idle");
        toast(error instanceof Error ? error.message : "メモの保存に失敗しました");
      }
    }, 700);
    return () => clearTimeout(handle);
  }, [value]);

  return (
    <>
      <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-1.5">
        <span className="text-[11px] text-neutral-400">自分だけに表示されます</span>
        <span className="flex-1" />
        <span data-home-notepad-status className="text-[11px] text-neutral-400">
          {state === "saving" ? "保存中…" : state === "saved" ? "保存しました" : ""}
        </span>
      </div>

      <div className="flex min-h-[170px] flex-1 flex-col p-3">
        <textarea
          data-home-notepad-input
          value={value}
          onChange={(event) => {
            dirtyRef.current = true;
            setValue(event.target.value);
          }}
          placeholder="メモ、アイデア、次のアクションを自由に記録"
          className="min-h-[150px] flex-1 resize-y rounded-md border border-neutral-200 px-3 py-2 text-[13px] leading-5 text-neutral-800 outline-none focus:border-[#4075cf]"
        />
      </div>

      <div className="border-t border-neutral-100 px-4 py-1.5 text-right text-[11px] text-neutral-400">
        {savedAt ? `最終更新 ${formatDateTime(savedAt)}` : "未保存"}
      </div>
    </>
  );
}
