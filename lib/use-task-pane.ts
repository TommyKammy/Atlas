"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { confirmAction, toast as toastMessage } from "./ui-feedback";
import { ApiError, api } from "./api-client";
import { patchTask, saveTaskCustomValue, TaskConflictError } from "./task-client";
import { rememberTaskDeletion, undoLastTaskDeletion } from "./task-undo";
import { copyTaskLink as copyTaskLinkAction, deleteTask } from "./task-actions";
import type { TaskRow, User } from "./data";
import type { RichTextDoc } from "./rich-text-types";
import { todayISO } from "./dates";
import { canEditCustomField, type CustomField } from "./custom-fields";
import { parseCustomFieldConflict, type CustomFieldConflict } from "./task-conflict";
import { useApiRefresh } from "./use-api-refresh";
import { taskPaneCloseHref } from "./task-pane-navigation";
import type { TaskInputRecovery } from "./task-input-draft";
import { taskSaveErrorMessage, updateTaskSaveState, type TaskSaveState } from "./task-save-state";

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
  const searchParams = useSearchParams();
  const refresh = useApiRefresh();
  const closeHref = taskPaneCloseHref(projectId, view, searchParams.toString());
  const todayStr = todayISO();
  const isOverdue = !task.completed && task.due_on !== null && task.due_on < todayStr;

  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [depDraft, setDepDraft] = useState("");
  const [conflict, setConflict] = useState<{
    current: Record<string, string | number | boolean | null>;
    attempted: Record<string, unknown>;
    stamp: string;
    /** The custom-field write that conflicted, including its server value. */
    customField?: CustomFieldConflict;
    /** Custom-field conflicts retry the value write instead of a field patch. */
    retry?: () => Promise<boolean>;
  } | null>(null);
  const [inputRecovery, setInputRecovery] = useState<TaskInputRecovery | null>(null);
  const [saveStates, setSaveStates] = useState<Record<string, TaskSaveState>>({});
  const [customValueStamp, setCustomValueStamp] = useState<{
    taskId: number;
    previous: string;
    updatedAt: string;
  } | null>(null);
  const [reloadRevision, setReloadRevision] = useState(0);
  const [reloading, startReload] = useTransition();
  const requestId = useRef(0);
  const saveGeneration = useRef(0);
  const latestRequest = useRef<Record<string, number>>({});
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
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

  // A custom-field write advances tasks.updated_at. Keep that stamp locally
  // until the refreshed task props catch up, so an immediately following edit
  // does not compare against the stale stamp from before the write.
  const updatedAt = customValueStamp?.taskId === task.id
    && customValueStamp.previous === task.updated_at
    ? customValueStamp.updatedAt
    : task.updated_at;

  const canEditField = (field: CustomField) =>
    !reloading && canEditCustomField(field, { viewerId, canEdit, canAdmin });

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

  const savePatch = async (fields: Record<string, unknown>, expectedUpdatedAt = updatedAt): Promise<boolean> => {
    const key = Object.keys(fields).sort().join(",");
    const id = ++requestId.current;
    const generation = saveGeneration.current;
    latestRequest.current[key] = id;
    const current = () => alive.current && generation === saveGeneration.current && latestRequest.current[key] === id;
    const label = Object.keys(fields).map((field) => FIELD_LABELS[field] ?? "タスク").join("・");
    const saveState = (state: Partial<TaskSaveState>) => {
      if (current()) setSaveStates((previous) => updateTaskSaveState(previous, { id, key, label, phase: "saving", ...state }));
    };
    if (!canEdit) {
      saveState({ phase: "failed", message: taskSaveErrorMessage(403) });
      return false;
    }
    saveState({ phase: "saving" });
    try {
      await patchTask(task.id, fields, expectedUpdatedAt);
    } catch (error) {
      if (!current()) return false;
      if (error instanceof TaskConflictError) {
        saveState({ phase: "conflict" });
        if (error.current && error.updatedAt) {
          const keys = Object.keys(fields).filter((key) => key in FIELD_LABELS);
          setConflict({
            current: error.current as Record<string, string | number | boolean | null>,
            attempted: fields,
            stamp: error.updatedAt,
          });
          if (keys.length === 0) refresh();
          return false;
        }
        toastMessage("他のユーザーが先に更新しました。最新を表示します。");
        refresh();
        return false;
      }
      const status = error instanceof ApiError ? error.status : null;
      saveState({ phase: "failed", message: taskSaveErrorMessage(status),
        ...(status !== 401 && status !== 403 && status !== 404 ? { retry: async () => { await savePatch(fields, expectedUpdatedAt); } } : {}),
      });
      return false;
    }
    if (!current()) return false;
    saveState({ phase: "saved" });
    refresh();
    return true;
  };

  const patch = async (fields: Record<string, unknown>, expectedUpdatedAt = updatedAt) => {
    await savePatch(fields, expectedUpdatedAt);
  };

  const patchChecked = async (fields: Record<string, unknown>) => {
    if (!await savePatch(fields)) throw new Error("保存が完了していません。入力内容を確認してください。");
  };

  const reloadTask = () => {
    saveGeneration.current++;
    latestRequest.current = {};
    setSubtaskDraft("");
    setAddingSubtask(false);
    setDepDraft("");
    setAssigneeEditing(false);
    closeAddProject();
    setReloadRevision((revision) => revision + 1);
    setInputRecovery((previous) => ({ taskId: task.id, revision: (previous?.revision ?? 0) + 1,
      updatedAt, values: { name: task.name, progress: task.progress } }));
    setSaveStates({});
    setConflict(null);
    startReload(() => router.refresh());
  };

  const discardConflict = () => {
    if (!conflict) return;
    latestRequest.current[Object.keys(conflict.attempted).sort().join(",")] = ++requestId.current;
    // Remount uncontrolled editors (custom fields, dates, description) so
    // their local DOM values cannot outlive the discarded draft.
    setReloadRevision((revision) => revision + 1);
    // The conflict snapshot is usable before the refreshed RSC response arrives.
    // Reset both the visible draft and its lock stamp, not just the warning.
    setInputRecovery((previous) => ({
      taskId: task.id,
      revision: (previous?.revision ?? 0) + 1,
      values: conflict.current,
      updatedAt: conflict.stamp,
    }));
    setConflict(null);
    setSaveStates((previous) => Object.fromEntries(Object.entries(previous).filter(([, state]) => state.phase !== "conflict")));
    refresh();
  };

  const retryOverwrite = async () => {
    if (!conflict) return;
    if (conflict.retry) {
      if (await conflict.retry()) setConflict((current) => current === conflict ? null : current);
      return;
    }
    if (await savePatch(conflict.attempted, conflict.stamp)) setConflict((current) => current === conflict ? null : current);
  };

  const toggle = () => patch({ completed: !task.completed });

  // Creates/uploads/deletes are not automatically retried: a lost response can
  // mean the mutation committed. Show the failure and let the user reload first.
  const mutate = async (key: string, label: string, action: () => Promise<unknown>) => {
    const id = ++requestId.current;
    const generation = saveGeneration.current;
    latestRequest.current[key] = id;
    const current = () => alive.current && generation === saveGeneration.current && latestRequest.current[key] === id;
    const mark = (state: Partial<TaskSaveState>) => {
      if (current()) setSaveStates((previous) => updateTaskSaveState(previous, { id, key, label, phase: "saving", ...state }));
    };
    if (!canEdit) {
      mark({ phase: "failed", message: taskSaveErrorMessage(403) });
      return false;
    }
    mark({ phase: "saving" });
    try {
      await action();
      if (!current()) return false;
      mark({ phase: "saved" });
      refresh();
      return true;
    } catch (error) {
      const status = error instanceof ApiError ? error.status : null;
      mark({ phase: "failed", message: status === 401 || status === 403 || status === 404
        ? taskSaveErrorMessage(status)
        : "操作の結果を確認できませんでした。最新の状態を読み込み、反映されているか確認してください。" });
      return false;
    }
  };

  const remove = async () => {
    if (await mutate("delete", "タスクの削除", () => deleteTask(task.id))) {
      rememberTaskDeletion(task.id, () => router.refresh());
      toastMessage("タスクを削除しました", {
        actionLabel: "元に戻す",
        action: () => void undoLastTaskDeletion(),
      });
      router.push(closeHref);
    }
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
    const saved = await mutate("subtask:create", "サブタスク", () => api("/api/tasks", "POST", {
      project_id: task.project_id ?? projectId,
      section_id: task.section_id,
      parent_task_id: task.id,
      name: subtaskDraft,
    }));
    if (saved && alive.current) setSubtaskDraft("");
  };

  const addDependency = async () => {
    if (!depDraft) return;
    const saved = await mutate("dependency:create", "依存関係", () => api("/api/dependencies", "POST", { task_id: task.id, depends_on_id: Number(depDraft) }));
    if (saved && alive.current) setDepDraft("");
  };

  const removeDependency = async (dependencyId: number) => {
    await mutate(`dependency:${dependencyId}`, "依存関係の削除", () => api(`/api/dependencies?task_id=${task.id}&depends_on_id=${dependencyId}`, "DELETE"));
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
    const saved = await mutate("membership:create", "所属プロジェクト", () => api("/api/memberships", "POST", {
      task_id: task.id,
      project_id: Number(newMemberProject),
      section_id: newMemberSection === "" ? null : Number(newMemberSection),
    }));
    if (saved && alive.current) closeAddProject();
  };

  const removeMembership = async (projectIdValue: number) => {
    await mutate(`membership:${projectIdValue}`, "所属プロジェクトの削除", () => api(`/api/memberships?task_id=${task.id}&project_id=${projectIdValue}`, "DELETE"));
  };

  const saveCustomValue = async (
    fieldId: number,
    value: string | number | string[] | number[] | null,
    expectedStamp = updatedAt,
  ): Promise<boolean> => {
    const key = `custom:${fieldId}`;
    const id = ++requestId.current;
    const generation = saveGeneration.current;
    latestRequest.current[key] = id;
    const current = () => alive.current && generation === saveGeneration.current && latestRequest.current[key] === id;
    const saveState = (state: Partial<TaskSaveState>) => {
      if (current()) setSaveStates((previous) => updateTaskSaveState(previous, { id, key, label: "カスタムフィールド", phase: "saving", ...state }));
    };
    if (!canEdit) {
      saveState({ phase: "failed", message: taskSaveErrorMessage(403) });
      return false;
    }
    saveState({ phase: "saving" });
    try {
      const result = await saveTaskCustomValue(task.id, fieldId, value, expectedStamp);
      if (!current()) return false;
      saveState({ phase: "saved" });
      if (typeof result.updated_at === "string") {
        setCustomValueStamp({
          taskId: task.id,
          previous: task.updated_at,
          updatedAt: result.updated_at,
        });
      }
      refresh();
      return true;
    } catch (error) {
      if (!current()) return false;
      if (error instanceof TaskConflictError) {
        saveState({ phase: "conflict" });
        if (error.current && error.updatedAt) {
          const customField = parseCustomFieldConflict(error.customField, value);
          setConflict({
            current: error.current as Record<string, string | number | boolean | null>,
            attempted: { [`cf-${fieldId}`]: value },
            stamp: error.updatedAt,
            ...(customField ? { customField } : {}),
            retry: () => saveCustomValue(fieldId, value, error.updatedAt as string),
          });
        } else {
          toastMessage("他のユーザーが先に更新しました。最新を表示します。");
          refresh();
        }
        return false;
      }
      const status = error instanceof ApiError ? error.status : null;
      saveState({ phase: "failed", message: taskSaveErrorMessage(status),
        ...(status !== 401 && status !== 403 && status !== 404 ? { retry: async () => { await saveCustomValue(fieldId, value, expectedStamp); } } : {}),
      });
      return false;
    }
  };

  const setCustomValue = async (
    fieldId: number,
    value: string | number | string[] | number[] | null,
    expectedUpdatedAt?: string,
  ) => {
    await saveCustomValue(fieldId, value, expectedUpdatedAt);
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.set("task_id", String(task.id));
      form.set("file", file);
      await mutate("attachment:create", "添付ファイル", async () => {
        const res = await fetch("/api/attachments", { method: "POST", body: form });
        if (!res.ok) throw new ApiError(res.status, `upload: ${res.status}`);
      });
    } finally {
      if (alive.current) setUploading(false);
    }
  };

  const removeAttachment = async (attachmentId: number) => {
    if (!(await confirmAction("添付を削除しますか？"))) return;
    await mutate(`attachment:${attachmentId}`, "添付ファイルの削除", () => api(`/api/attachments/${attachmentId}`, "DELETE"));
  };

  const toggleSubtaskCompletion = async (subtask: TaskRow) => {
    await mutate(`subtask:${subtask.id}`, "サブタスクの完了状態", () => api(`/api/tasks/${subtask.id}`, "PATCH", { completed: !subtask.completed }));
  };

  const deleteSubtask = async (subtask: TaskRow) => {
    if (await mutate(`subtask:${subtask.id}`, "サブタスクの削除", () => api(`/api/tasks/${subtask.id}`, "DELETE"))) {
      rememberTaskDeletion(subtask.id, () => router.refresh());
      toastMessage("サブタスクを削除しました", {
        actionLabel: "元に戻す",
        action: () => void undoLastTaskDeletion(),
      });
    }
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
    discardConflict,
    inputRecovery,
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
    updatedAt,
    patch,
    patchChecked,
    saveStates,
    reloading,
    reloadRevision,
    reloadTask,
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
    removeDependency,
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
