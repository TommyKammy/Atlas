"use client";

import { useEffect, useRef, useState } from "react";
import { formatDay } from "./calendar";
import { toast } from "./ui-feedback";

export type TimelineDraft = { sectionId: number | null; day: number; key: number } | null;

/** Inline timeline draft: focus management, creation and reveal-on-create. */
export function useTimelineDraft({
  projectId,
  refresh,
  expandSection,
  onCreated,
}: {
  projectId: number;
  refresh: () => void;
  expandSection: (sectionId: number | null) => void;
  onCreated: (taskId: number | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<TimelineDraft>(null);
  const seq = useRef(0);
  const [draft, setDraft] = useState<TimelineDraft>(null);

  useEffect(() => {
    if (!draft) return;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [draft?.key, draft]);

  const openDraft = (sectionId: number | null, day: number) => {
    expandSection(sectionId);
    seq.current += 1;
    const next: TimelineDraft = { sectionId, day, key: seq.current };
    draftRef.current = next;
    setDraft(next);
  };

  const finishDraft = (value: string) => {
    const current = draftRef.current;
    if (!current) return;
    draftRef.current = null;
    setDraft(null);
    const name = value.trim();
    if (!name) return;
    void (async () => {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          section_id: current.sectionId,
          name,
          start_on: formatDay(current.day),
          due_on: formatDay(current.day),
        }),
      });
      if (!res.ok) {
        toast(`作成に失敗しました: ${res.status}`);
        return;
      }
      const created = await res.json();
      onCreated(typeof created.id === "number" ? created.id : null);
      refresh();
    })();
  };

  return { draft, draftInputRef: inputRef, draftRef, openDraft, finishDraft };
}
