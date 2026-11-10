"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmAction, toast as toastMessage } from "./ui-feedback";
import { ApiError, api } from "./api-client";
import { patchTask, TaskConflictError } from "./task-client";
import { copyTaskLink as copyTaskLinkAction, deleteTask } from "./task-actions";
import type { TaskRow, User } from "./data";
import type { RichTextDoc } from "./rich-text-types";
import { todayISO } from "./dates";
import { canEditCustomField, type CustomField } from "./custom-fields";
import { useApiRefresh } from "./use-api-refresh";

export const QUICK_REACTIONS = ["👍", "🎉", "❤️", "😄", "😮"];

/**
 * Task-pane state, optimistic updates, conflict recovery and panel actions.
 * The pane component keeps only DOM refs and presentation.
 */
export function useTaskPane({
  projectId,
  view,
  task,
  users,
  reactions,
  viewerId,
  canEdit,
  canAdmin,
  statusFieldName,
}: {
  projectId: number;
  view: string;
  task: TaskRow;
  users: User[];
  reactions: Record<number, { emoji: string; n: number; mine: boolean }[]>;
  viewerId: number;
  canEdit: boolean;
  canAdmin: boolean;
  statusFieldName: string;
}) {
  const router = useRouter();
  const refresh = useApiRefresh();
  const closeHref = `/projects/${projectId}?view=${view}`;
  const todayStr = todayISO();
  const isOverdue = !task.completed && task.due_on !== null && task.due_on < todayStr;

  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [depDraft, setDepDraft] = useState("");
  const [conflict, setConflict] = useState<{
    current: Record<string, string | number | boolean | null>;
    attempted: Record<string, unknown>;
    stamp: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState<number | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [showTitle, setShowTitle] = useState(false);
  const [reactionMap, setReactionMap] = useState(reactions);
  const [feedTab, setFeedTab] = useState<"comments" | "activity">("activity");
  const [addingProject, setAddingProject] = useState(false);
  const [assigneeEditing, setAssigneeEditing] = useState(false);
  const [allProjects, setAllProjects] = useState<{ id: number; name: string }[]>([]);
  const [newMemberProject, setNewMemberProject] = useState("");
  const [newMemberSections, setNewMemberSections] = useState<{ id: number; name: string }[]>([]);
  const [newMemberSection, setNewMemberSection] = useState("");
  const memberSectionsRequest = useRef<AbortController | null>(null);

  useEffect(() => () => memberSectionsRequest.current?.abort(), [task.id]);

  const canEditField = (field: CustomField) =>
    canEditCustomField(field, { viewerId, canEdit, canAdmin });

  const userName = (id: number | null) =>
    id === null ? "–" : (users.find((user) => user.id === id)?.name ?? `ID:${id}`);

  const describeValue = (key: string, value: unknown): string => {
    if (value === null || value === undefined || value === "") return "–";
    if (key === "completed") return value === true ? "完了" : "未完了";
    if (key === "assignee_id") return userName(typeof value === "number" ? value : null);
    if (key === "progress") return `${value}%`;
    if (key === "description_doc") return "リッチテキスト";
    return String(value);
  };

  const FIELD_LABELS: Record<string, string> = {
    name: "名前",
    completed: "完了状態",
    assignee_id: "担当者",
    start_on: "開始日",
    due_on: "期日",
    progress: "進捗",
    status: statusFieldName,
    description: "説明",
    description_doc: "説明",
    section_id: "セクション",
  };

  const toggleReaction = async (commentId: number, emoji: string) => {
    const res = await fetch(`/api/comments/${commentId}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji }),
    });
    if (!res.ok) return;
    const data = await res.json();
    setReactionMap((map) => ({ ...map, [commentId]: data.reactions }));
  };

  const patch = async (fields: Record<string, unknown>) => {
    try {
      await patchTask(task.id, fields, task.updated_at);
    } catch (error) {
      if (error instanceof TaskConflictError) {
        if (error.current && error.updatedAt) {
          const keys = Object.keys(fields).filter((key) => key in FIELD_LABELS);
          setConflict({
            current: error.current as Record<string, string | number | boolean | null>,
            attempted: fields,
            stamp: error.updatedAt,
          });
          if (keys.length === 0) refresh();
          return;
        }
        toastMessage("他のユーザーが先に更新しました。最新を表示します。");
        refresh();
        return;
      }
      if (error instanceof ApiError) throw new Error(`PATCH /api/tasks/${task.id}: ${error.status}`);
      throw error;
    }
    refresh();
  };

  const retryOverwrite = async () => {
    if (!conflict) return;
    try {
      await patchTask(task.id, conflict.attempted, conflict.stamp);
    } catch (error) {
      if (error instanceof TaskConflictError) {
        toastMessage("再度競合しました。最新を表示します。");
      } else {
        toastMessage(`保存に失敗しました: ${error instanceof ApiError ? error.status : ""}`);
      }
    } finally {
      setConflict(null);
      refresh();
    }
  };

  const toggle = () => patch({ completed: !task.completed });

  const remove = async () => {
    if (!(await confirmAction(`「${task.name}」を削除しますか？`))) return;
    await deleteTask(task.id);
    router.push(closeHref);
  };

  const copyTaskLink = async () => {
    await copyTaskLinkAction(
      `${window.location.origin}/projects/${projectId}?view=${view}&task=${task.id}`,
    );
  };

  const shareTask = async () => {
    const url = `${window.location.origin}/projects/${projectId}?view=${view}&task=${task.id}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: task.name, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await copyTaskLink();
  };

  const mentionUsers = users.map((user) => ({
    id: user.id,
    name: user.name,
    avatar_url: user.avatar_url,
  }));

  const addComment = async (doc: RichTextDoc, text: string) => {
    await api("/api/comments", "POST", { task_id: task.id, body_doc: doc, body: text });
    refresh();
  };

  const saveComment = async (commentId: number, doc: RichTextDoc) => {
    await api(`/api/comments/${commentId}`, "PATCH", { body_doc: doc });
    refresh();
  };

  const deleteComment = async (commentId: number) => {
    if (!(await confirmAction("このコメントを削除しますか？"))) return;
    await api(`/api/comments/${commentId}`, "DELETE");
    refresh();
  };

  const addSubtask = async () => {
    if (!subtaskDraft.trim()) return;
    await api("/api/tasks", "POST", {
      project_id: task.project_id ?? projectId,
      section_id: task.section_id,
      parent_task_id: task.id,
      name: subtaskDraft,
    });
    setSubtaskDraft("");
    refresh();
  };

  const addDependency = async () => {
    if (!depDraft) return;
    await api("/api/dependencies", "POST", { task_id: task.id, depends_on_id: Number(depDraft) });
    setDepDraft("");
    refresh();
  };

  const openAddProject = async () => {
    const res = await fetch("/api/lookup");
    setAllProjects(await res.json());
    setAddingProject(true);
  };

  const onPickMemberProject = async (projectIdValue: string) => {
    memberSectionsRequest.current?.abort();
    memberSectionsRequest.current = null;
    setNewMemberProject(projectIdValue);
    setNewMemberSection("");
    setNewMemberSections([]);
    if (!projectIdValue) return;

    const request = new AbortController();
    memberSectionsRequest.current = request;
    try {
      const res = await fetch(`/api/lookup?project_id=${projectIdValue}`, {
        signal: request.signal,
      });
      if (!res.ok) throw new Error(`lookup: ${res.status}`);
      const sections = await res.json();
      if (!Array.isArray(sections)) throw new Error("Invalid section lookup response");
      if (!request.signal.aborted) setNewMemberSections(sections);
    } catch {
      if (!request.signal.aborted) toastMessage("セクションの取得に失敗しました");
    } finally {
      if (memberSectionsRequest.current === request) memberSectionsRequest.current = null;
    }
  };

  const closeAddProject = () => {
    void onPickMemberProject("");
    setAddingProject(false);
  };

  const addMembership = async () => {
    if (!newMemberProject) return;
    await api("/api/memberships", "POST", {
      task_id: task.id,
      project_id: Number(newMemberProject),
      section_id: newMemberSection === "" ? null : Number(newMemberSection),
    });
    closeAddProject();
    refresh();
  };

  const removeMembership = async (projectIdValue: number) => {
    await fetch(`/api/memberships?task_id=${task.id}&project_id=${projectIdValue}`, { method: "DELETE" });
    refresh();
  };

  const setCustomValue = async (
    fieldId: number,
    value: string | number | string[] | number[] | null,
  ) => {
    await api("/api/task-values", "POST", { task_id: task.id, field_id: fieldId, value });
    refresh();
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.set("task_id", String(task.id));
      form.set("file", file);
      const res = await fetch("/api/attachments", { method: "POST", body: form });
      if (!res.ok) throw new Error(`upload: ${res.status}`);
      refresh();
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = async (attachmentId: number) => {
    if (!(await confirmAction("添付を削除しますか？"))) return;
    await fetch(`/api/attachments/${attachmentId}`, { method: "DELETE" });
    refresh();
  };

  const toggleSubtaskCompletion = async (subtask: TaskRow) => {
    await api(`/api/tasks/${subtask.id}`, "PATCH", { completed: !subtask.completed });
    refresh();
  };

  const deleteSubtask = async (subtask: TaskRow) => {
    if (!(await confirmAction(`サブタスク「${subtask.name}」を削除しますか？`))) return;
    await api(`/api/tasks/${subtask.id}`, "DELETE");
    refresh();
  };

  return {
    router,
    refresh,
    closeHref,
    todayStr,
    isOverdue,
    canEditField,
    userName,
    describeValue,
    FIELD_LABELS,
    subtaskDraft,
    setSubtaskDraft,
    addingSubtask,
    setAddingSubtask,
    depDraft,
    setDepDraft,
    conflict,
    setConflict,
    uploading,
    referenceOpen,
    setReferenceOpen,
    maximized,
    setMaximized,
    showTitle,
    setShowTitle,
    reactionMap,
    feedTab,
    setFeedTab,
    addingProject,
    closeAddProject,
    assigneeEditing,
    setAssigneeEditing,
    allProjects,
    newMemberProject,
    newMemberSections,
    newMemberSection,
    setNewMemberSection,
    toggleReaction,
    patch,
    retryOverwrite,
    toggle,
    remove,
    copyTaskLink,
    shareTask,
    mentionUsers,
    addComment,
    saveComment,
    deleteComment,
    addSubtask,
    addDependency,
    openAddProject,
    onPickMemberProject,
    addMembership,
    removeMembership,
    setCustomValue,
    uploadFile,
    removeAttachment,
    toggleSubtaskCompletion,
    deleteSubtask,
  };
}
