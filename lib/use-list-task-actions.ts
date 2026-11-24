"use client";

import { useState } from "react";
import { useQuickTask } from "@/components/task/QuickTaskContext";
import { ApiError, api } from "./api-client";
import type { CustomField } from "./custom-fields";
import type { Section, TaskRow } from "./data";
import { patchTask, TaskConflictError } from "./task-client";
import { rememberTaskDeletion, undoLastTaskDeletion } from "./task-undo";
import { toast as toastMessage } from "./ui-feedback";

/**
 * Row editing and add-task/subtask mutations for the list view.
 * Keeping them here keeps ListView's render tree free of API bookkeeping.
 */
export function useListTaskActions({
  projectId,
  refresh,
  customFields,
  sections,
  groupSections,
}: {
  projectId: number;
  refresh: () => void;
  customFields: CustomField[];
  sections: Section[];
  groupSections: Record<string, number | null>;
}) {
  const quick = useQuickTask();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [subAdding, setSubAdding] = useState<number | null>(null);
  const [subDraft, setSubDraft] = useState("");
  const [editing, setEditing] = useState<{ id: number; field: string } | null>(null);
  const [editVal, setEditVal] = useState("");
  const [editStart, setEditStart] = useState("");
  const [addingTo, setAddingTo] = useState<number | string | null>(null);
  const [addCommitting, setAddCommitting] = useState<Record<string, boolean>>({});
  // Custom-field writes advance tasks.updated_at. Until refreshed props carry
  // the new stamp, remember it so an immediately following row edit does not
  // send the stale stamp from before the write.
  const [customValueStamps, setCustomValueStamps] = useState<
    Record<number, { previous: string; updatedAt: string }>
  >({});
  const expectedUpdatedAt = (task: TaskRow) => {
    const stamp = customValueStamps[task.id];
    return stamp && stamp.previous === task.updated_at ? stamp.updatedAt : task.updated_at;
  };

  const addSubtask = async (parent: TaskRow) => {
    const name = subDraft.trim();
    if (!name) return;
    await api("/api/tasks", "POST", {
      project_id: parent.project_id ?? projectId,
      section_id: parent.section_id,
      parent_task_id: parent.id,
      name,
    });
    setSubDraft("");
    setSubAdding(null);
    refresh();
  };

  const addTask = async (sectionId: number | null) => {
    const name = (drafts[sectionId ?? -1] ?? "").trim();
    if (!name) return;
    await api("/api/tasks", "POST", { project_id: projectId, section_id: sectionId, name });
    setDrafts((current) => ({ ...current, [sectionId ?? -1]: "" }));
    refresh();
  };

  const addTaskGrouped = async (groupKey: string) => {
    const name = (drafts[groupKey] ?? "").trim();
    if (!name) return;
    const sectionId = groupSections[groupKey] ?? sections[0]?.id ?? null;
    await api("/api/tasks", "POST", { project_id: projectId, section_id: sectionId, name });
    setDrafts((current) => ({ ...current, [groupKey]: "" }));
    refresh();
  };

  const toggle = async (task: TaskRow) => {
    try {
      await patchTask(task.id, { completed: !task.completed }, expectedUpdatedAt(task));
    } catch (error) {
      if (error instanceof TaskConflictError) {
        toastMessage("他のユーザーが先に更新しました。最新を表示します。");
        refresh();
        return;
      }
      throw error;
    }
    refresh();
  };

  const remove = async (task: TaskRow) => {
    await api(`/api/tasks/${task.id}`, "DELETE");
    quick?.forget(task.id);
    rememberTaskDeletion(task.id, refresh);
    toastMessage("タスクを削除しました", {
      actionLabel: "元に戻す",
      action: () => void undoLastTaskDeletion(),
    });
    refresh();
  };

  const openEdit = (event: React.MouseEvent, task: TaskRow, field: string, initial: string) => {
    if (event.shiftKey || event.ctrlKey || event.metaKey) return;
    event.stopPropagation();
    setEditing({ id: task.id, field });
    setEditVal(initial);
  };

  const patchFields = async (
    task: TaskRow,
    fields: Record<string, unknown>,
    options?: { close?: boolean },
  ) => {
    try {
      await patchTask(task.id, fields, expectedUpdatedAt(task));
    } catch (error) {
      if (error instanceof TaskConflictError) {
        toastMessage("他のユーザーが先に更新しました。最新を表示します。");
      } else {
        toastMessage(`更新に失敗しました: ${error instanceof ApiError ? error.status : ""}`);
      }
    }
    if (options?.close !== false) setEditing(null);
    refresh();
  };

  const commitEdit = async (task: TaskRow, field: string, value: string) => {
    if (!editing || editing.id !== task.id || editing.field !== field) return;
    if (field === "assignee") {
      const next = value === "" ? null : Number(value);
      if (next !== task.assignee_id) await patchFields(task, { assignee_id: next });
      else setEditing(null);
    } else if (field === "due") {
      const next = value === "" ? null : value;
      if (next !== task.due_on) await patchFields(task, { due_on: next });
      else setEditing(null);
    } else if (field === "progress") {
      const next = Math.max(0, Math.min(100, Number(value)));
      if (!Number.isNaN(next) && next !== task.progress) await patchFields(task, { progress: next });
      else setEditing(null);
    } else if (field === "name") {
      const next = value.trim();
      if (next && next !== task.name) await patchFields(task, { name: next });
      else setEditing(null);
    } else if (field === "status") {
      const next = value.trim();
      if (next && next !== task.status) await patchFields(task, { status: next });
      else setEditing(null);
    } else if (field.startsWith("cf-")) {
      const fieldId = Number(field.slice(3));
      const customField = customFields.find((item) => item.id === fieldId);
      let nextValue: unknown = value;
      if (customField?.field_type === "multi_select") {
        try {
          const parsed = JSON.parse(value);
          nextValue = Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
        } catch {
          nextValue = [];
        }
      } else if (customField?.field_type === "people" || customField?.field_type === "reference") {
        try {
          const parsed = JSON.parse(value);
          nextValue = Array.isArray(parsed)
            ? parsed.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)
            : [];
        } catch {
          nextValue = [];
        }
      }
      const result = await api<{ updated_at?: unknown }>("/api/task-values", "POST", { task_id: task.id, field_id: fieldId, value: nextValue });
      const updatedAt = result?.updated_at;
      if (typeof updatedAt === "string") {
        setCustomValueStamps((current) => ({
          ...current,
          [task.id]: { previous: task.updated_at, updatedAt },
        }));
      }
      setEditing(null);
      refresh();
    }
  };

  const cancelEdit = () => setEditing(null);

  const openDueEdit = (event: React.MouseEvent, task: TaskRow) => {
    if (event.shiftKey || event.ctrlKey || event.metaKey) return;
    event.stopPropagation();
    setEditing({ id: task.id, field: "due" });
    setEditStart(task.start_on ?? "");
    setEditVal(task.due_on ?? "");
  };

  const applyDueRange = async (task: TaskRow, start: string, due: string) => {
    const nextStart = start === "" ? null : start;
    const nextDue = due === "" ? null : due;
    if (nextStart === task.start_on && nextDue === task.due_on) return;
    await patchFields(task, { start_on: nextStart, due_on: nextDue }, { close: false });
  };

  const cancelAddTask = (key: number | string) => {
    setDrafts((current) => ({ ...current, [key]: "" }));
    setAddingTo(null);
  };

  const commitSectionTask = async (id: number) => {
    const commitKey = `s:${id}`;
    if (addCommitting[commitKey]) return;
    const name = (drafts[id] ?? "").trim();
    if (!name) {
      cancelAddTask(id);
      return;
    }
    setAddCommitting((current) => ({ ...current, [commitKey]: true }));
    try {
      await addTask(id);
      setAddingTo(null);
    } catch {
      toastMessage("タスクの追加に失敗しました");
    } finally {
      setAddCommitting((current) => {
        const next = { ...current };
        delete next[commitKey];
        return next;
      });
    }
  };

  const commitGroupedTask = async (groupKey: string) => {
    const commitKey = `g:${groupKey}`;
    if (addCommitting[commitKey]) return;
    const name = (drafts[groupKey] ?? "").trim();
    if (!name) {
      cancelAddTask(groupKey);
      return;
    }
    setAddCommitting((current) => ({ ...current, [commitKey]: true }));
    try {
      await addTaskGrouped(groupKey);
      setAddingTo(null);
    } catch {
      toastMessage("タスクの追加に失敗しました");
    } finally {
      setAddCommitting((current) => {
        const next = { ...current };
        delete next[commitKey];
        return next;
      });
    }
  };

  return {
    drafts,
    setDrafts,
    subAdding,
    setSubAdding,
    subDraft,
    setSubDraft,
    editing,
    setEditing,
    editVal,
    setEditVal,
    editStart,
    addingTo,
    setAddingTo,
    addTask,
    addTaskGrouped,
    addSubtask,
    commitSectionTask,
    commitGroupedTask,
    cancelAddTask,
    openEdit,
    patchFields,
    commitEdit,
    cancelEdit,
    openDueEdit,
    applyDueRange,
    toggle,
    remove,
  };
}
