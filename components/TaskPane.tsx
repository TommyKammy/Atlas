"use client";

import { confirmAction, toast as toastMessage } from "@/lib/ui-feedback";

import { ApiError, api } from "@/lib/api-client";
import { patchTask, TaskConflictError } from "@/lib/task-client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Attachment, CommentRow, TaskRow, User } from "@/lib/data";
import { todayISO } from "@/lib/dates";
import { customValueToInput, type CustomField, type CustomValue } from "@/lib/custom-fields";
import { renderMarkdown } from "@/lib/markdown";
import MarkdownToolbar from "./MarkdownToolbar";
import { useApiRefresh } from "@/lib/use-api-refresh";
import { useFocusTrap } from "@/lib/use-focus-trap";
import TaskPaneHeader from "./task/TaskPaneHeader";
import TaskSubtasksSection from "./task/TaskSubtasksSection";
import TaskAttachmentsSection from "./task/TaskAttachmentsSection";
import TaskDependenciesSection from "./task/TaskDependenciesSection";
import TaskCustomFieldsSection from "./task/TaskCustomFieldsSection";
import TaskCommentComposer from "./task/TaskCommentComposer";
import TaskFeedSection from "./task/TaskFeedSection";


export default function TaskPane({
  projectId,
  view,
  task,
  subtasks,
  comments,
  users,
  memberships,
  dependencies,
  taskOptions,
  customFields,
  customValues,
  attachments,
  reactions,
  events,
  statusOptions,
  statusFieldName,
  statusFieldEnabled,
  viewerId,
  viewerCanModerate,
}: {
  projectId: number;
  view: string;
  task: TaskRow;
  subtasks: TaskRow[];
  comments: CommentRow[];
  users: User[];
  memberships: { id: number; name: string; section_name: string | null }[];
  dependencies: { id: number; name: string }[];
  taskOptions: { id: number; name: string }[];
  customFields: CustomField[];
  customValues: Record<number, CustomValue>;
  attachments: Attachment[];
  reactions: Record<number, { emoji: string; n: number; mine: boolean }[]>;
  events: { id: number; summary: string; actor_name: string | null; created_at: string }[];
  statusOptions: string[];
  statusFieldName: string;
  statusFieldEnabled: boolean;
  viewerId: number;
  viewerCanModerate: boolean;
}) {
  const refresh = useApiRefresh();
  const [commentDraft, setCommentDraft] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [commentEditDraft, setCommentEditDraft] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [editingDesc, setEditingDesc] = useState(false);
  const descRef = useRef<HTMLTextAreaElement | null>(null);
  const commentRef = useRef<HTMLTextAreaElement | null>(null);
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [depDraft, setDepDraft] = useState("");
  const [conflict, setConflict] = useState<{
    current: Record<string, string | number | boolean | null>;
    attempted: Record<string, unknown>;
    stamp: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const router = useRouter();
  const paneRef = useRef<HTMLElement>(null);
  const [reactionMap, setReactionMap] = useState(reactions);
  const [feedTab, setFeedTab] = useState<"comments" | "activity">("comments");

  const toggleReaction = async (commentId: number, emoji: string) => {
    const res = await fetch(`/api/comments/${commentId}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji }),
    });
    if (!res.ok) return;
    const data = await res.json();
    setReactionMap((m) => ({ ...m, [commentId]: data.reactions }));
  };

  const QUICK = ["👍", "🎉", "❤️", "😄", "😮"];
  const [addingProject, setAddingProject] = useState(false);
  const [allProjects, setAllProjects] = useState<{ id: number; name: string }[]>([]);
  const [newMemberProject, setNewMemberProject] = useState("");
  const [newMemberSections, setNewMemberSections] = useState<{ id: number; name: string }[]>([]);
  const [newMemberSection, setNewMemberSection] = useState("");
  const closeHref = `/projects/${projectId}?view=${view}`;
  useFocusTrap(paneRef, true, () => router.push(closeHref));
  const todayStr = todayISO();
  const isOverdue = !task.completed && task.due_on !== null && task.due_on < todayStr;

  const userName = (id: number | null) =>
    id === null ? "–" : (users.find((u) => u.id === id)?.name ?? `ID:${id}`);

  const describeValue = (key: string, v: unknown): string => {
    if (v === null || v === undefined || v === "") return "–";
    if (key === "completed") return v === true ? "完了" : "未完了";
    if (key === "assignee_id") return userName(typeof v === "number" ? v : null);
    if (key === "progress") return `${v}%`;
    return String(v);
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
    section_id: "セクション",
  };

  const patch = async (fields: Record<string, unknown>) => {
    try {
      await patchTask(task.id, fields, task.updated_at);
    } catch (error) {
      if (error instanceof TaskConflictError) {
        if (error.current && error.updatedAt) {
          const keys = Object.keys(fields).filter((k) => k in FIELD_LABELS);
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
    if (!await confirmAction(`「${task.name}」を削除しますか？`)) return;
    await api(`/api/tasks/${task.id}`, "DELETE");
    router.push(closeHref);
  };

  const addComment = async () => {
    if (!commentDraft.trim()) return;
    await api("/api/comments", "POST", { task_id: task.id, body: commentDraft });
    setCommentDraft("");
    setMentionOpen(false);
    refresh();
  };

  const startEditComment = (comment: CommentRow) => {
    setEditingCommentId(comment.id);
    setCommentEditDraft(comment.body);
  };

  const saveComment = async (commentId: number) => {
    if (!commentEditDraft.trim()) return;
    await api(`/api/comments/${commentId}`, "PATCH", { body: commentEditDraft });
    setEditingCommentId(null);
    setCommentEditDraft("");
    refresh();
  };

  const deleteComment = async (commentId: number) => {
    if (!await confirmAction("このコメントを削除しますか？")) return;
    await api(`/api/comments/${commentId}`, "DELETE");
    if (editingCommentId === commentId) setEditingCommentId(null);
    refresh();
  };

  const renderCommentBody = (body: string): string => {
    const html = renderMarkdown(body);
    const names = [...users]
      .map((u) => u.name)
      .filter((name) => name !== "")
      .sort((a, b) => b.length - a.length);
    if (names.length === 0) return html;
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`@(${names.map(escape).join("|")})`, "g");
    return html
      .split(/(<[^>]+>)/)
      .map((part) => {
        if (part.startsWith("<")) return part;
        return part.replace(
          pattern,
          (match) =>
            `<span data-comment-mention="${match.slice(1)}" class="rounded bg-blue-50 px-1 font-medium text-blue-700">${match}</span>`,
        );
      })
      .join("");
  };

  const mentionCandidates = users.filter((u) =>
    mentionQuery === "" ? true : u.name.toLowerCase().includes(mentionQuery.toLowerCase()),
  );

  const onCommentChange = (value: string, cursor: number | null) => {
    setCommentDraft(value);
    if (cursor === null) {
      setMentionOpen(false);
      return;
    }
    const before = value.slice(0, cursor);
    const m = before.match(/@([^@\s]*)$/);
    if (m) {
      setMentionQuery(m[1]);
      setMentionIndex(0);
      setMentionOpen(true);
    } else {
      setMentionOpen(false);
    }
  };

  const pickMention = (name: string) => {
    const el = commentRef.current;
    if (!el) return;
    const pos = el.selectionStart ?? commentDraft.length;
    const before = commentDraft.slice(0, pos);
    const after = commentDraft.slice(pos);
    const replaced = before.replace(/@([^@\s]*)$/, `@${name} `);
    const next = replaced + after;
    setCommentDraft(next);
    setMentionOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(replaced.length, replaced.length);
    });
  };

  const addSubtask = async () => {
    if (!subtaskDraft.trim()) return;
    await api("/api/tasks", "POST", {
      project_id: projectId,
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

  const onPickMemberProject = async (pid: string) => {
    setNewMemberProject(pid);
    setNewMemberSection("");
    if (!pid) {
      setNewMemberSections([]);
      return;
    }
    const res = await fetch(`/api/lookup?project_id=${pid}`);
    setNewMemberSections(await res.json());
  };

  const addMembership = async () => {
    if (!newMemberProject) return;
    await api("/api/memberships", "POST", {
      task_id: task.id,
      project_id: Number(newMemberProject),
      section_id: newMemberSection === "" ? null : Number(newMemberSection),
    });
    setAddingProject(false);
    setNewMemberProject("");
    setNewMemberSection("");
    refresh();
  };

  const setCustomValue = async (fieldId: number, value: string | number | null) => {
    await api("/api/task-values", "POST", { task_id: task.id, field_id: fieldId, value });
    refresh();
  };

  const renderCustomEditor = (f: CustomField) => {
    const v = customValues[f.id];
    if (f.field_type === "number") {
      return (
        <input
          type="number"
          defaultValue={customValueToInput(f, v)}
          key={`cf-${task.id}-${f.id}`}
          onBlur={(e) => setCustomValue(f.id, e.target.value === "" ? null : Number(e.target.value))}
          className="w-28 rounded border px-2 py-1"
        />
      );
    }
    if (f.field_type === "select") {
      return (
        <select
          defaultValue={customValueToInput(f, v)}
          key={`cf-${task.id}-${f.id}`}
          onChange={(e) => setCustomValue(f.id, e.target.value === "" ? null : e.target.value)}
          className="rounded border px-2 py-1"
        >
          <option value="">–</option>
          {f.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        defaultValue={customValueToInput(f, v)}
        key={`cf-${task.id}-${f.id}`}
        onBlur={(e) => setCustomValue(f.id, e.target.value === "" ? null : e.target.value)}
        className="w-full rounded border px-2 py-1"
      />
    );
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

  const removeAttachment = async (aid: number) => {
    if (!await confirmAction("添付を削除しますか？")) return;
    await fetch(`/api/attachments/${aid}`, { method: "DELETE" });
    refresh();
  };

  const removeMembership = async (pid: number) => {
    await fetch(`/api/memberships?task_id=${task.id}&project_id=${pid}`, { method: "DELETE" });
    refresh();
  };

  const removeDependency = async (depId: number) => {
    await fetch(`/api/dependencies?task_id=${task.id}&depends_on_id=${depId}`, { method: "DELETE" });
    refresh();
  };

  const collaboratorNames = (() => {
    const names = [
      ...(task.assignee_id !== null
        ? [users.find((u) => u.id === task.assignee_id)?.name ?? null]
        : []),
      ...comments.map((c) => c.author_name),
    ].filter((n): n is string => Boolean(n));
    const uniq = [...new Set(names)];
    return uniq.length > 0 ? uniq.slice(0, 3).join("・") + (uniq.length > 3 ? ` 他${uniq.length - 3}人` : "") : "誰にも";
  })();
  const collaborators = `このタスクは${collaboratorNames}に表示されています。`;

  return (
    <aside
      ref={paneRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="タスク詳細"
      className="taskpane-enter fixed inset-0 z-[80] flex w-full shrink-0 flex-col overflow-y-auto border-t bg-white md:static md:z-auto md:w-[520px] md:overflow-y-auto md:border-l md:border-t-0 xl:w-[600px] 2xl:w-[700px]"
    >
      <TaskPaneHeader
        task={task}
        collaborators={collaborators}
        closeHref={closeHref}
        onToggle={toggle}
        onRemove={remove}
      />
      <div className="flex-1 overflow-y-auto p-4">
        {conflict && (
          <div className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm">
            <div className="font-semibold text-red-700">他のユーザーが先に更新しました</div>
            <div className="mt-1 space-y-0.5">
              {Object.keys(conflict.attempted)
                .filter((k) => k in FIELD_LABELS)
                .map((k) => (
                  <div key={k}>
                    {FIELD_LABELS[k]}: {describeValue(k, conflict.attempted[k])} →{" "}
                    {k === "assignee_id"
                      ? (conflict.current.assignee_name as string) ?? "–"
                      : describeValue(k, conflict.current[k])}
                    （現在値）
                  </div>
                ))}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={retryOverwrite}
                className="rounded bg-red-600 px-3 py-1 text-white hover:bg-red-700"
              >
                最新で上書きする
              </button>
              <button
                onClick={() => {
                  setConflict(null);
                  refresh();
                }}
                className="rounded border px-3 py-1 hover:bg-white"
              >
                破棄して最新表示
              </button>
            </div>
          </div>
        )}
        <input
          defaultValue={task.name}
          key={`name-${task.id}`}
          onBlur={(e) => e.target.value.trim() && e.target.value !== task.name && patch({ name: e.target.value.trim() })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="w-full text-2xl font-medium outline-none focus:border-b focus:border-blue-500"
        />
        <div className="mt-3 space-y-0.5">
          <div className="flex h-9 items-center gap-2 rounded-md px-1 hover:bg-neutral-50">
            <span className="w-28 shrink-0 text-sm text-neutral-500">担当者</span>
            <select
              value={task.assignee_id ?? ""}
              onChange={(e) => patch({ assignee_id: e.target.value === "" ? null : Number(e.target.value) })}
              className="min-w-0 flex-1 cursor-pointer appearance-none truncate rounded bg-transparent py-1 pr-6 text-sm text-neutral-800 outline-none hover:bg-white"
            >
              <option value="">未割当</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.is_guest ? "（ゲスト）" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex h-9 items-center gap-2 rounded-md px-1 hover:bg-neutral-50">
            <span className="w-28 shrink-0 text-sm text-neutral-500">期日</span>
            <span className="flex min-w-0 flex-1 items-center gap-1">
              <input
                type="date"
                defaultValue={task.start_on ?? ""}
                key={`s-${task.id}`}
                onChange={(e) => patch({ start_on: e.target.value || null })}
                title="開始日"
                className="w-[130px] cursor-pointer rounded bg-transparent px-1 py-1 text-sm text-neutral-800 outline-none hover:bg-white"
              />
              <span className="text-neutral-500">〜</span>
              <input
                type="date"
                defaultValue={task.due_on ?? ""}
                key={`d-${task.id}`}
                onChange={(e) => patch({ due_on: e.target.value || null })}
                title="期日"
                className={`w-[130px] cursor-pointer rounded bg-transparent px-1 py-1 text-sm outline-none hover:bg-white ${
                  isOverdue ? "font-semibold text-red-700" : "text-neutral-800"
                }`}
              />
            </span>
          </div>
          <div className="flex h-9 items-center gap-2 rounded-md px-1 hover:bg-neutral-50">
            <span className="w-28 shrink-0 text-sm text-neutral-500">進捗</span>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <input
                type="number"
                min={0}
                max={100}
                defaultValue={task.progress}
                key={`p-${task.id}`}
                onBlur={(e) => patch({ progress: Math.max(0, Math.min(100, Number(e.target.value))) })}
                className="w-16 rounded bg-transparent px-1 py-1 text-sm text-neutral-800 outline-none hover:bg-white"
              />
              <span className="h-1.5 w-24 overflow-hidden rounded bg-neutral-200">
                <span className="block h-full rounded bg-green-500" style={{ width: `${task.progress}%` }} />
              </span>
            </span>
          </div>
          {statusFieldEnabled && (
            <div className="flex h-9 items-center gap-2 rounded-md px-1 hover:bg-neutral-50">
              <span className="w-28 shrink-0 truncate text-sm text-neutral-500">{statusFieldName}</span>
              <select
                value={task.status}
                key={`st-${task.id}`}
                onChange={(e) => e.target.value && patch({ status: e.target.value })}
                className="min-w-0 flex-1 cursor-pointer appearance-none rounded bg-transparent px-1 py-1 text-sm text-neutral-800 outline-none hover:bg-white"
              >
                {!statusOptions.includes(task.status) && <option value={task.status}>{task.status}</option>}
                {statusOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex h-9 items-center gap-2 rounded-md px-1 hover:bg-neutral-50">
            <span className="w-28 shrink-0 text-sm text-neutral-500">繰り返し</span>
            <select
              value={task.recurrence ?? "none"}
              onChange={(e) => patch({ recurrence: e.target.value })}
              className="min-w-0 flex-1 cursor-pointer appearance-none rounded bg-transparent py-1 pr-6 text-sm text-neutral-800 outline-none hover:bg-white"
            >
              <option value="none">なし</option>
              <option value="daily">毎日</option>
              <option value="weekly">毎週</option>
              <option value="monthly">毎月</option>
            </select>
          </div>
          <div className="flex min-h-9 items-start gap-2 rounded-md px-1 py-1 hover:bg-neutral-50">
            <span className="w-28 shrink-0 pt-1.5 text-sm text-neutral-500">プロジェクト</span>
            <div className="min-w-0 flex-1 text-neutral-800">
              {memberships.map((m) => {
                const isPrimary = m.id === task.project_id;
                return (
                  <div key={m.id} className="flex h-8 items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {m.name}
                      {m.section_name ? ` / ${m.section_name}` : ""}
                      {isPrimary && <span className="ml-1 text-xs text-neutral-500">（主）</span>}
                    </span>
                    {!isPrimary && (
                      <button
                        onClick={() => removeMembership(m.id)}
                        className="text-neutral-500 hover:text-red-600"
                        title="所属を外す"
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
              {!addingProject ? (
                <button onClick={openAddProject} className="flex h-8 items-center text-sm text-neutral-500 hover:text-neutral-700">
                  ＋ 他プロジェクトに追加
                </button>
              ) : (
                <div className="mt-1 flex flex-col gap-1">
                  <select
                    value={newMemberProject}
                    onChange={(e) => onPickMemberProject(e.target.value)}
                    className="rounded border px-2 py-1 text-sm"
                  >
                    <option value="">プロジェクトを選択</option>
                    {allProjects
                      .filter((p) => !memberships.some((m) => m.id === p.id))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                  {newMemberProject && (
                    <div className="flex gap-1">
                      <select
                        value={newMemberSection}
                        onChange={(e) => setNewMemberSection(e.target.value)}
                        className="w-full rounded border px-2 py-1 text-sm"
                      >
                        <option value="">セクションなし</option>
                        {newMemberSections.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={addMembership}
                        className="shrink-0 rounded bg-neutral-200 px-3 py-1 text-sm hover:bg-neutral-300"
                      >
                        追加
                      </button>
                    </div>
                  )}
                  <button onClick={() => setAddingProject(false)} className="self-start text-sm text-neutral-500">
                    キャンセル
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <TaskDependenciesSection
          taskId={task.id}
          dependencies={dependencies}
          taskOptions={taskOptions}
          draft={depDraft}
          onDraftChange={setDepDraft}
          onAdd={addDependency}
          onRemove={removeDependency}
        />
        <div className="mt-4">
          {editingDesc ? (
            <div>
              <div className="mb-1">
                <MarkdownToolbar
                  target={descRef}
                  onChange={() => undefined}
                />
              </div>
              <textarea
                ref={descRef}
                defaultValue={task.description}
                key={`desc-${task.id}`}
                onBlur={(e) => {
                  if (e.target.value !== task.description) patch({ description: e.target.value });
                  setEditingDesc(false);
                }}
                placeholder="このタスクの内容を入力します（Markdown可）"
                rows={4}
                autoFocus
                className="w-full rounded-md bg-neutral-50 p-2 text-sm outline-none focus:bg-white focus:ring-1 focus:ring-blue-500"
              />
            </div>
          ) : task.description ? (
            <div
              onClick={() => setEditingDesc(true)}
              title="クリックで編集"
              className="prose-sm max-w-none cursor-pointer rounded-md p-2 text-sm hover:bg-neutral-50 [&_a]:text-blue-700 [&_code]:rounded [&_code]:bg-neutral-100 [&_code]:px-1 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(task.description) }}
            />
          ) : (
            <button
              onClick={() => setEditingDesc(true)}
              className="w-full rounded-md p-2 text-left text-sm text-neutral-500 hover:bg-neutral-50 hover:text-neutral-600"
            >
              このタスクの内容を入力します
            </button>
          )}
        </div>
        <TaskCommentComposer
          commentRef={commentRef}
          draft={commentDraft}
          onDraftChange={setCommentDraft}
          onCommentChange={onCommentChange}
          mentionOpen={mentionOpen}
          mentionCandidates={mentionCandidates}
          mentionIndex={mentionIndex}
          onMentionHover={setMentionIndex}
          onMentionPick={pickMention}
          onMentionClose={() => setMentionOpen(false)}
          onSubmit={addComment}
        />
        <TaskCustomFieldsSection customFields={customFields} renderEditor={renderCustomEditor} />
        <TaskSubtasksSection
          projectId={projectId}
          view={view}
          subtasks={subtasks}
          adding={addingSubtask}
          draft={subtaskDraft}
          onStartAdd={() => setAddingSubtask(true)}
          onCancelAdd={() => {
            setAddingSubtask(false);
            setSubtaskDraft("");
          }}
          onDraftChange={setSubtaskDraft}
          onAdd={addSubtask}
          onToggle={(s) =>
            void api(`/api/tasks/${s.id}`, "PATCH", { completed: !s.completed }).then(refresh)
          }
          onDelete={async (s) => {
            if (!await confirmAction(`サブタスク「${s.name}」を削除しますか？`)) return;
            void api(`/api/tasks/${s.id}`, "DELETE").then(refresh);
          }}
        />
        <TaskAttachmentsSection
          attachments={attachments}
          uploading={uploading}
          onUpload={uploadFile}
          onDelete={removeAttachment}
        />
        <TaskFeedSection
          feedTab={feedTab}
          onFeedTab={setFeedTab}
          comments={comments}
          events={events}
          viewerId={viewerId}
          viewerCanModerate={viewerCanModerate}
          editingCommentId={editingCommentId}
          commentEditDraft={commentEditDraft}
          onCommentEditDraft={setCommentEditDraft}
          onStartEdit={startEditComment}
          onCancelEdit={() => setEditingCommentId(null)}
          onSaveEdit={(commentId) => void saveComment(commentId)}
          onDelete={(commentId) => void deleteComment(commentId)}
          reactionMap={reactionMap}
          quickEmojis={QUICK}
          onToggleReaction={toggleReaction}
          renderCommentBody={renderCommentBody}
        />
      </div>
    </aside>
  );
}
