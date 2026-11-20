"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Section, TaskRow } from "@/lib/data";
import { api, ApiError } from "@/lib/api-client";
import { todayISO } from "@/lib/dates";
import { shiftDay } from "@/lib/calendar";
import { isImeComposing } from "@/lib/ime-keyboard";

type Kind = "task" | "approval" | "milestone";
export type QuickTaskDraft = {
  task: TaskRow;
  text: string;
  editing: boolean;
  saving: boolean;
  error: string;
  cancelled: boolean;
  seenOnServer: boolean;
  openApproval: boolean;
  continuous: boolean;
};
type Draft = QuickTaskDraft;
type CreateOptions = { continuous?: boolean };
type Context = {
  drafts: Draft[];
  paneDraft: Draft | null;
  create: (kind?: Kind, sectionId?: number | null, options?: CreateOptions) => void;
  change: (draft: Draft, text: string) => void;
  finish: (draft: Draft) => Promise<void>;
  cancel: (draft: Draft) => void;
  edit: (draft: Draft) => void;
  retire: (draft: Draft) => void;
  markSeen: (draft: Draft) => void;
  forget: (taskId: number) => void;
  canEdit: boolean;
};
const QuickContext = createContext<Context | null>(null);
export const useQuickTask = () => useContext(QuickContext);

/**
 * Inline creation holds a local row until the user commits a name. Asana does
 * not create a server task for an untouched composer, so opening and
 * abandoning this row performs no write at all.
 *
 * When a task detail pane is open, the row draft is also shown there. The pane
 * keeps the URL task until the name is committed, so cancelling returns to the
 * task that was open and committing navigates once to the created task.
 */
export function QuickTaskProvider({ projectId, sections, view, canEdit, paneTaskId, children }: {
  projectId: number; sections: Section[]; view: "list" | "board" | "timeline" | "calendar";
  canEdit: boolean; paneTaskId: number | null; children: ReactNode;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [paneDraft, setPaneDraft] = useState<Draft | null>(null);
  const paneDraftRef = useRef<Draft | null>(null);
  const expectedPaneTaskId = useRef<number | null>(null);
  const nextId = useRef(-1);
  const nextPosition = useRef(Number.MAX_SAFE_INTEGER - 1_000_000);
  const showPaneDraft = useCallback((draft: Draft | null) => {
    paneDraftRef.current = draft;
    setPaneDraft(draft);
  }, []);
  const redraw = () => setDrafts(current => [...current]);
  const retire = (draft: Draft) =>
    setDrafts(current => current.filter(item => item !== draft));
  const markSeen = (draft: Draft) => {
    if (draft.seenOnServer) return;
    draft.seenOnServer = true;
    redraw();
  };
  const forget = (taskId: number) => {
    if (paneDraftRef.current?.task.id === taskId) showPaneDraft(null);
    setDrafts(current => current.filter(item => item.task.id !== taskId));
  };
  const removeDraft = (draft: Draft) =>
    setDrafts(current => current.filter(item => item !== draft));
  const cancel = (draft: Draft) => {
    draft.cancelled = true;
    if (paneDraftRef.current === draft) {
      showPaneDraft(null);
      // The URL task the pane should return to may have been deleted while the
      // draft was open. Refresh after the cancel so the server can close it.
      if (paneTaskId !== null) {
        requestAnimationFrame(() => router.refresh());
      }
    }
    removeDraft(draft);
  };
  const finish = async (draft: Draft) => {
    if (draft.saving || draft.cancelled) return;
    const name = draft.text.trim();
    if (!name) {
      cancel(draft);
      return;
    }
    if (draft.task.id > 0) {
      if (name === draft.task.name) {
        draft.editing = false;
        redraw();
        return;
      }
      draft.saving = true; redraw();
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
      return;
    }
    draft.saving = true; redraw();
    try {
      const result = await api<{ id: number; updated_at: string }>("/api/tasks", "POST", {
        project_id: projectId,
        section_id: draft.task.section_id,
        name,
        start_on: draft.task.start_on,
        due_on: draft.task.due_on,
        is_milestone: draft.task.is_milestone,
      });
      if (draft.cancelled) {
        await api(`/api/tasks/${result.id}`, "DELETE").catch(() => undefined);
        return;
      }
      const shownInPane = paneDraftRef.current === draft;
      draft.task = { ...draft.task, id: result.id, name, updated_at: result.updated_at };
      draft.text = name;
      draft.editing = false;
      draft.error = "";
      if (draft.openApproval) {
        expectedPaneTaskId.current = result.id;
        const query = new URLSearchParams(window.location.search);
        query.set("task", String(result.id)); query.set("approval", "1");
        router.push(`/projects/${projectId}?${query}`);
      } else if (shownInPane) {
        expectedPaneTaskId.current = result.id;
        const query = new URLSearchParams(window.location.search);
        query.set("task", String(result.id));
        router.push(`/projects/${projectId}?${query}`);
      }
      router.refresh();
      if (draft.continuous) {
        create(
          draft.task.is_milestone ? "milestone" : "task",
          draft.task.section_id,
          { continuous: true },
        );
      }
    } catch {
      // An ambiguous failure may still have committed; keep the text so the
      // user can decide whether to retry from this same composer.
      draft.error = "追加を確認できませんでした。入力内容をコピーして再読み込みし、一覧を確認してください。";
      draft.editing = true;
    } finally { draft.saving = false; redraw(); }
  };
  const create = (
    kind: Kind = "task",
    sectionId: number | null = sections[0]?.id ?? null,
    options: CreateOptions = {},
  ) => {
    if (!canEdit) return;
    const today = todayISO();
    const dated = view === "timeline" || view === "calendar";
    const stamp = new Date().toISOString();
    const task: TaskRow = {
      id: nextId.current--, project_id: projectId, section_id: sectionId,
      eff_section_id: sectionId, parent_task_id: null, name: "", description: "",
      assignee_id: null, assignee_name: null, created_by: null, creator_name: null,
      completed: false, completed_at: null, start_on: dated ? today : null,
      due_on: dated ? (view === "timeline" && kind !== "milestone" ? shiftDay(today, 4) : today) : null,
      progress: 0, status: "", is_milestone: kind === "milestone", position: nextPosition.current++,
      created_at: stamp, updated_at: stamp, recurrence: "none", timeline_row: null,
      timeline_row_updated_at: null, comment_count: 0, subtask_count: 0, blocked_by_count: 0, blocking_count: 0,
    };
    const draft: Draft = {
      task, text: "", editing: true, saving: false, error: "",
      cancelled: false, seenOnServer: false, openApproval: kind === "approval",
      continuous: options.continuous === true,
    };
    setDrafts(current => [...current, draft]);
    // The pane only follows drafts it can return from, so a closed pane is
    // never opened by quick creation.
    if (paneTaskId !== null) showPaneDraft(draft);
  };

  // A URL task change (row click, back/forward, close, or the commit push)
  // ends the draft view. A continuous composer that was opened by that same
  // commit keeps the pane on the next draft.
  useEffect(() => {
    const current = paneDraftRef.current;
    if (paneTaskId === null) {
      expectedPaneTaskId.current = null;
      if (current) showPaneDraft(null);
      return;
    }
    if (!current) {
      expectedPaneTaskId.current = null;
      return;
    }
    if (paneTaskId === current.task.id) {
      expectedPaneTaskId.current = null;
      showPaneDraft(null);
      return;
    }
    if (expectedPaneTaskId.current === paneTaskId) {
      expectedPaneTaskId.current = null;
      return;
    }
    expectedPaneTaskId.current = null;
    showPaneDraft(null);
  }, [paneTaskId, showPaneDraft]);

  return <QuickContext.Provider value={{ drafts, paneDraft, create, finish, cancel, canEdit, retire, markSeen, forget,
    change: (draft, text) => { draft.text = text; redraw(); },
    edit: draft => { draft.editing = true; redraw(); },
  }}>{children}</QuickContext.Provider>;
}

/** Retain optimistic names until refresh returns the saved value. */
export function useQuickTasks<T extends { id: number; name: string }>(tasks: T[]): T[] {
  const context = useQuickTask();
  const drafts = context?.drafts;
  const result = useMemo(() => {
    if (!drafts?.length) return tasks;
    const next = [...tasks];
    for (const draft of drafts) {
      if (draft.cancelled) continue;
      const index = next.findIndex(task => task.id === draft.task.id);
      if (index < 0) {
        // A saved draft whose server row has disappeared was deleted. Do not
        // resurrect it from the optimistic copy; the next refresh stays clean.
        if (draft.seenOnServer && draft.task.name !== "" && !draft.editing && !draft.saving) continue;
        next.push({ ...draft.task, quickAdd: true } as unknown as T);
      } else {
        const preferDraftName = draft.editing || draft.saving || draft.task.name !== "";
        next[index] = { ...next[index], quickAdd: true, ...(preferDraftName ? { name: draft.task.name } : {}) };
      }
    }
    return next;
  }, [tasks, drafts]);

  useEffect(() => {
    if (!context || !drafts?.length) return;
    for (const draft of drafts) {
      const saved = tasks.find(task => task.id === draft.task.id);
      if (saved) context.markSeen(draft);
      if (draft.cancelled || draft.editing || draft.saving || draft.task.id <= 0 || draft.task.name === "") continue;
      if (saved && saved.name === draft.task.name) context.retire(draft);
    }
  }, [tasks, drafts, context]);

  return result;
}

/** Name editing stays on the row/card/bar; existing tasks retain their usual navigation. */
export function QuickTaskName({ task, children }: { task: { id: number; name: string }; children: ReactNode }) {
  const context = useQuickTask();
  const draft = context?.drafts.find(item => item.task.id === task.id);
  const input = useRef<HTMLInputElement>(null);
  const isLatestDraft = context?.drafts.at(-1) === draft;
  const editingId = draft?.editing && isLatestDraft ? draft.task.id : null;
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
    <input ref={input} autoFocus={isLatestDraft} aria-label="新しいタスク名" placeholder="タスク名を入力" maxLength={1000}
      readOnly={draft.saving} aria-busy={draft.saving} value={draft.text} onChange={event => context.change(draft, event.target.value)}
      className="pointer-events-auto h-6 w-full min-w-0 rounded border-0 bg-transparent px-1 text-[13px] text-text outline-none"
      onFocus={event => event.target.scrollIntoView({ block: "nearest", inline: "nearest" })}
      onBlur={event => {
        // Moving into the pane's draft name keeps the same composer active.
        const next = event.relatedTarget;
        if (next instanceof Element && next.closest("[data-draft-pane-name]")) return;
        void context.finish(draft);
      }}
      onKeyDown={event => {
        if (isImeComposing(event)) return;
        if (event.key === "Enter") { event.preventDefault(); void context.finish(draft); }
        if (event.key === "Escape") { event.preventDefault(); context.cancel(draft); }
      }} />
    {draft.error && <span role="alert" className="absolute left-0 top-full z-50 mt-1 w-64 whitespace-normal rounded border border-danger-line bg-surface p-2 text-xs text-danger shadow">{draft.error}</span>}
  </span>;
}
