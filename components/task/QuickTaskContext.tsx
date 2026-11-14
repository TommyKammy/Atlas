"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Section, TaskRow } from "@/lib/data";
import { api, ApiError } from "@/lib/api-client";
import { todayISO } from "@/lib/dates";
import { shiftDay } from "@/lib/calendar";
import { isImeComposing } from "@/lib/ime-keyboard";

type Kind = "task" | "approval" | "milestone";
type Draft = { task: TaskRow; text: string; editing: boolean; creating: boolean; saving: boolean; error: string; ready: Promise<void> };
type Context = {
  drafts: Draft[]; create: (kind?: Kind) => void; change: (draft: Draft, text: string) => void;
  finish: (draft: Draft) => Promise<void>; edit: (draft: Draft) => void; canEdit: boolean;
};
const QuickContext = createContext<Context | null>(null);
export const useQuickTask = () => useContext(QuickContext);

/** Local rows appear before the network round-trip. Only this explicit path permits an empty name. */
export function QuickTaskProvider({ projectId, sections, view, canEdit, children }: {
  projectId: number; sections: Section[]; view: "list" | "board" | "timeline" | "calendar";
  canEdit: boolean; children: ReactNode;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const nextId = useRef(-1);
  const redraw = () => setDrafts(current => [...current]);
  const finish = async (draft: Draft) => {
    if (draft.saving) return;
    draft.saving = true; redraw();
    await draft.ready;
    if (draft.creating || draft.task.id < 0) { draft.saving = false; redraw(); return; }
    const name = draft.text.trim();
    if (!name || name === draft.task.name) {
      draft.editing = false; draft.saving = false; redraw(); return;
    }
    try {
      await api(`/api/tasks/${draft.task.id}`, "PATCH", { name, expected_updated_at: draft.task.updated_at });
      draft.task = { ...draft.task, name }; draft.text = name;
      draft.editing = false; draft.error = "";
      router.refresh();
    } catch (error) {
      draft.error = error instanceof ApiError && error.status === 409
        ? "別の変更がありました。入力内容をコピーして、再読み込みしてください。"
        : "名前を保存できませんでした。入力を保持しています。Enterで再試行できます。";
      draft.editing = true;
    } finally { draft.saving = false; redraw(); }
  };
  const create = (kind: Kind = "task") => {
    if (!canEdit) return;
    const today = todayISO();
    const dated = view === "timeline" || view === "calendar";
    const stamp = new Date().toISOString();
    const task: TaskRow = {
      id: nextId.current--, project_id: projectId, section_id: sections[0]?.id ?? null,
      eff_section_id: sections[0]?.id ?? null, parent_task_id: null, name: "", description: "",
      assignee_id: null, assignee_name: null, created_by: null, creator_name: null,
      completed: false, completed_at: null, start_on: dated ? today : null,
      due_on: dated ? (view === "timeline" && kind !== "milestone" ? shiftDay(today, 4) : today) : null,
      progress: 0, status: "", is_milestone: kind === "milestone", position: -Date.now(),
      created_at: stamp, updated_at: stamp, recurrence: "none", timeline_row: null,
      timeline_row_updated_at: null, comment_count: 0, subtask_count: 0, blocked_by_count: 0, blocking_count: 0,
    };
    const draft: Draft = { task, text: "", editing: true, creating: true, saving: false, error: "", ready: Promise.resolve() };
    setDrafts(current => [...current, draft]);
    draft.ready = (async () => {
      try {
        const result = await api<{ id: number; updated_at: string }>("/api/tasks", "POST", {
          project_id: projectId, section_id: task.section_id, name: "", quick_add: true,
          start_on: task.start_on, due_on: task.due_on, is_milestone: task.is_milestone,
        });
        draft.task = { ...task, id: result.id, updated_at: result.updated_at };
        if (kind === "approval") {
          draft.editing = false;
          const query = new URLSearchParams(window.location.search);
          query.set("task", String(result.id)); query.set("approval", "1");
          router.push(`/projects/${projectId}?${query}`);
        }
        router.refresh();
      } catch {
        // Do not repeat a POST after an ambiguous network failure: it may already have committed.
        draft.error = "追加を確認できませんでした。入力内容をコピーして再読み込みし、一覧を確認してください。";
      } finally { draft.creating = false; redraw(); }
    })();
  };
  return <QuickContext.Provider value={{ drafts, create, finish, canEdit,
    change: (draft, text) => { draft.text = text; redraw(); },
    edit: draft => { draft.editing = true; redraw(); },
  }}>{children}</QuickContext.Provider>;
}

/** Retain optimistic names until refresh returns the saved value. */
export function useQuickTasks<T extends { id: number; name: string }>(tasks: T[]): T[] {
  const drafts = useQuickTask()?.drafts;
  return useMemo(() => {
    if (!drafts?.length) return tasks;
    const result = [...tasks];
    for (const draft of drafts) {
      const index = result.findIndex(task => task.id === draft.task.id);
      if (index < 0) result.unshift({ ...draft.task, quickAdd: true } as unknown as T);
      else {
        result[index] = { ...result[index], quickAdd: true, ...(draft.editing || draft.saving || ("updated_at" in result[index] && result[index].updated_at === draft.task.updated_at) ? { name: draft.task.name } : {}) };
      }
    }
    return result;
  }, [tasks, drafts]);
}

/** Name editing stays on the row/card/bar; existing tasks retain their usual navigation. */
export function QuickTaskName({ task, children }: { task: { id: number; name: string }; children: ReactNode }) {
  const context = useQuickTask();
  const draft = context?.drafts.find(item => item.task.id === task.id);
  const input = useRef<HTMLInputElement>(null);
  const editingId = draft?.editing ? draft.task.id : null;
  useEffect(() => {
    if (editingId === null) return;
    const frame = requestAnimationFrame(() => {
      input.current?.focus({ preventScroll: true });
      input.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [editingId]);
  if (!context || !draft) return children;
  if (!draft.editing && !draft.error) return children;
  return <span className="relative block min-w-[100px] flex-1" data-quick-task={task.id}
    onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}
    onKeyDown={event => event.stopPropagation()} draggable={false} onDragStart={event => { event.preventDefault(); event.stopPropagation(); }}>
    <input ref={input} autoFocus aria-label="新しいタスク名" placeholder="タスク名を入力" maxLength={1000}
      readOnly={draft.saving} aria-busy={draft.saving} value={draft.text} onChange={event => context.change(draft, event.target.value)}
      className="pointer-events-auto h-6 w-full min-w-0 rounded border border-blue-500 bg-white px-1 text-[13px] text-neutral-900 outline-none focus:ring-1 focus:ring-blue-500"
      onFocus={event => event.target.scrollIntoView({ block: "nearest", inline: "nearest" })}
      onBlur={() => { void context.finish(draft); }}
      onKeyDown={event => {
        if (isImeComposing(event)) return;
        if (event.key === "Enter" || event.key === "Escape") { event.preventDefault(); void context.finish(draft); }
      }} />
    {draft.error && <span role="alert" className="absolute left-0 top-full z-50 mt-1 w-64 whitespace-normal rounded border border-red-200 bg-white p-2 text-xs text-red-700 shadow">{draft.error}</span>}
  </span>;
}
