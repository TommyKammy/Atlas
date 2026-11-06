"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { Attachment, CommentRow, TaskRow, User } from "@/lib/data";
import { todayISO } from "@/lib/dates";
import AttachmentPreview from "./AttachmentPreview";
import type { CustomField, CustomValue } from "@/lib/custom-fields";
import { renderMarkdown } from "@/lib/markdown";
import MarkdownToolbar from "./MarkdownToolbar";
import { useApiRefresh } from "./ListView";

async function api(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
  return res.json();
}

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
}) {
  const refresh = useApiRefresh();
  const [commentDraft, setCommentDraft] = useState("");
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
    status: "Status",
    description: "説明",
    section_id: "セクション",
  };

  const patch = async (fields: Record<string, unknown>) => {
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fields, expected_updated_at: task.updated_at }),
    });
    if (res.status === 409) {
      const data = (await res.json().catch(() => null)) as {
        updated_at?: string;
        current?: Record<string, string | number | boolean | null> | null;
      } | null;
      if (data?.current && data.updated_at) {
        const keys = Object.keys(fields).filter((k) => k in FIELD_LABELS);
        setConflict({ current: data.current, attempted: fields, stamp: data.updated_at });
        if (keys.length === 0) refresh();
        return;
      }
      alert("他のユーザーが先に更新しました。最新を表示します。");
      refresh();
      return;
    }
    if (!res.ok) throw new Error(`PATCH /api/tasks/${task.id}: ${res.status}`);
    refresh();
  };

  const retryOverwrite = async () => {
    if (!conflict) return;
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...conflict.attempted, expected_updated_at: conflict.stamp }),
    });
    setConflict(null);
    if (res.status === 409) {
      alert("再度競合しました。最新を表示します。");
    } else if (!res.ok) {
      alert(`保存に失敗しました: ${res.status}`);
    }
    refresh();
  };

  const toggle = () => patch({ completed: !task.completed });

  const remove = async () => {
    if (!confirm(`「${task.name}」を削除しますか？`)) return;
    await api(`/api/tasks/${task.id}`, "DELETE");
    window.location.href = closeHref;
  };

  const addComment = async () => {
    if (!commentDraft.trim()) return;
    await api("/api/comments", "POST", { task_id: task.id, body: commentDraft });
    setCommentDraft("");
    setMentionOpen(false);
    refresh();
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
          defaultValue={v?.value_number ?? ""}
          key={`cf-${task.id}-${f.id}`}
          onBlur={(e) => setCustomValue(f.id, e.target.value === "" ? null : Number(e.target.value))}
          className="w-28 rounded border px-2 py-1"
        />
      );
    }
    if (f.field_type === "select") {
      return (
        <select
          defaultValue={v?.value_text ?? ""}
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
        defaultValue={v?.value_text ?? ""}
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
    if (!confirm("添付を削除しますか？")) return;
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
    <aside className="taskpane-enter flex w-full shrink-0 flex-col border-t bg-white md:w-[520px] md:border-l md:border-t-0 xl:w-[600px]">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <button
          onClick={toggle}
          className={`flex h-7 items-center gap-1.5 rounded-full border px-3 text-sm ${
            task.completed
              ? "border-green-600 bg-green-600 text-white"
              : "border-neutral-300 hover:border-green-600"
          }`}
        >
          <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[9px] ${task.completed ? "border-white" : "border-neutral-400"}`}>
            {task.completed ? "✓" : ""}
          </span>
          {task.completed ? "完了" : "完了にする"}
        </button>
        <span className="ml-1 hidden min-w-0 flex-1 truncate text-xs text-neutral-400 lg:block" title={collaborators}>
          {collaborators}
        </span>
        <span className="flex-1 lg:hidden" />
        <button title="いいね（v1では無効）" className="cursor-default px-1.5 text-lg leading-none text-neutral-300">
          ♡
        </button>
        <button onClick={remove} title="削除" className="px-2 text-sm text-neutral-400 hover:text-red-600">
          削除
        </button>
        <Link href={closeHref} className="px-1.5 text-neutral-500 hover:text-black" title="閉じる">
          ×
        </Link>
      </div>
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
              <span className="text-neutral-400">〜</span>
              <input
                type="date"
                defaultValue={task.due_on ?? ""}
                key={`d-${task.id}`}
                onChange={(e) => patch({ due_on: e.target.value || null })}
                title="期日"
                className={`w-[130px] cursor-pointer rounded bg-transparent px-1 py-1 text-sm outline-none hover:bg-white ${
                  isOverdue ? "font-semibold text-red-600" : "text-neutral-800"
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
          <div className="flex h-9 items-center gap-2 rounded-md px-1 hover:bg-neutral-50">
            <span className="w-28 shrink-0 text-sm text-neutral-500">Status</span>
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
                      {isPrimary && <span className="ml-1 text-xs text-neutral-400">（主）</span>}
                    </span>
                    {!isPrimary && (
                      <button
                        onClick={() => removeMembership(m.id)}
                        className="text-neutral-300 hover:text-red-600"
                        title="所属を外す"
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
              {!addingProject ? (
                <button onClick={openAddProject} className="flex h-8 items-center text-sm text-neutral-400 hover:text-neutral-700">
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
        <div className="mt-2">
          <div className="flex min-h-9 items-start gap-2 rounded-md px-1 py-1 hover:bg-neutral-50">
            <span className="w-28 shrink-0 pt-1.5 text-sm text-neutral-500">依存関係</span>
            <div className="min-w-0 flex-1">
              {dependencies.length === 0 && (
                <div className="flex h-8 items-center text-sm text-neutral-400">依存関係を追加</div>
              )}
              {dependencies.map((d) => (
                <div key={d.id} className="flex h-8 items-center gap-2 border-b text-sm">
                  <span className="flex-1 truncate">⛔ {d.name}</span>
                  <button
                    onClick={() => removeDependency(d.id)}
                    className="text-neutral-300 hover:text-red-600"
                    title="依存を外す"
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="mt-1 flex gap-2">
                <select
                  value={depDraft}
                  onChange={(e) => setDepDraft(e.target.value)}
                  className="w-full rounded border px-2 py-1 text-sm"
                >
                  <option value="">このタスクの前に…</option>
                  {taskOptions
                    .filter((o) => o.id !== task.id && !dependencies.some((d) => d.id === o.id))
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                </select>
                <button
                  onClick={addDependency}
                  className="shrink-0 rounded bg-neutral-200 px-3 py-1 text-sm hover:bg-neutral-300"
                >
                  追加
                </button>
              </div>
            </div>
          </div>
        </div>
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
              className="w-full rounded-md p-2 text-left text-sm text-neutral-400 hover:bg-neutral-50 hover:text-neutral-600"
            >
              このタスクの内容を入力します
            </button>
          )}
        </div>
        <div className="mt-2 rounded-lg border p-2">
          <div className="mb-1">
            <MarkdownToolbar target={commentRef} onChange={setCommentDraft} />
          </div>
          {mentionOpen && mentionCandidates.length > 0 && (
            <div className="mb-1 max-h-32 overflow-auto rounded border bg-white shadow">
              {mentionCandidates.map((u, i) => (
                <button
                  key={u.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMention(u.name);
                  }}
                  onMouseEnter={() => setMentionIndex(i)}
                  className={`flex w-full items-center gap-2 px-2 py-1 text-left text-sm ${
                    i === mentionIndex ? "bg-blue-50" : ""
                  }`}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-400 text-[10px] font-bold text-white">
                    {u.name.slice(0, 1)}
                  </span>
                  {u.name}
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={commentRef}
            value={commentDraft}
            onChange={(e) => onCommentChange(e.target.value, e.target.selectionStart)}
            onKeyDown={(e) => {
              if (!mentionOpen) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMentionIndex((i) => Math.min(i + 1, mentionCandidates.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setMentionIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" || e.key === "Tab") {
                const pick = mentionCandidates[mentionIndex];
                if (pick) {
                  e.preventDefault();
                  pickMention(pick.name);
                }
              } else if (e.key === "Escape") {
                setMentionOpen(false);
              }
            }}
            placeholder="コメントを追加するか、チームメイトを @メンションします"
            rows={2}
            className="w-full text-sm outline-none"
          />
          <div className="text-right">
            <button
              onClick={addComment}
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
            >
              投稿
            </button>
          </div>
        </div>
        {customFields.length > 0 && (
          <div className="mt-2 space-y-0.5">
            {customFields.map((f) => (
              <div key={f.id} className="flex h-9 items-center gap-2 rounded-md px-1 hover:bg-neutral-50">
                <span className="w-28 shrink-0 truncate text-sm text-neutral-500">{f.name}</span>
                <span className="min-w-0 flex-1">{renderCustomEditor(f)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4">
          <div className="mb-1 flex items-center gap-1 text-sm text-neutral-500">
            サブタスク（{subtasks.length}）
            <button
              onClick={() => setAddingSubtask(true)}
              title="サブタスクを追加"
              className="rounded px-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            >
              ＋
            </button>
          </div>
          {subtasks.map((s) => (
            <div key={s.id} className="group/sub flex items-center gap-2 border-b py-1 text-sm">
              <button
                onClick={() => api(`/api/tasks/${s.id}`, "PATCH", { completed: !s.completed }).then(refresh)}
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                  s.completed ? "border-green-600 bg-green-600 text-white" : "border-neutral-400"
                }`}
              >
                {s.completed && "✓"}
              </button>
              <Link
                href={`/projects/${projectId}?view=${view}&task=${s.id}`}
                className={`min-w-0 flex-1 truncate hover:underline ${s.completed ? "text-neutral-400 line-through" : ""}`}
              >
                {s.name}
              </Link>
              <button
                onClick={() => {
                  if (!confirm(`サブタスク「${s.name}」を削除しますか？`)) return;
                  api(`/api/tasks/${s.id}`, "DELETE").then(refresh);
                }}
                title="サブタスクを削除"
                className="invisible shrink-0 text-neutral-300 hover:text-red-600 group-hover/sub:visible"
              >
                ×
              </button>
            </div>
          ))}
          {addingSubtask ? (
            <div className="mt-1 flex gap-2">
              <input
                value={subtaskDraft}
                onChange={(e) => setSubtaskDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addSubtask();
                  if (e.key === "Escape") {
                    setAddingSubtask(false);
                    setSubtaskDraft("");
                  }
                }}
                onBlur={() => {
                  if (subtaskDraft.trim() === "") setAddingSubtask(false);
                }}
                placeholder="サブタスク名を入力"
                autoFocus
                className="w-full rounded border px-2 py-1 text-sm outline-none focus:border-blue-500"
              />
              <button
                onClick={addSubtask}
                className="shrink-0 rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
              >
                追加
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAddingSubtask(true)}
              className="mt-1 flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm text-neutral-400 hover:bg-neutral-50 hover:text-neutral-600"
            >
              <span className="min-w-0 flex-1 truncate">サブタスクを追加</span>
              <span className="flex shrink-0 items-center gap-1 text-neutral-300">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed">👤</span>
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed">📅</span>
              </span>
            </button>
          )}
        </div>
        <div className="mt-4">
          <div className="mb-1 text-sm text-neutral-500">添付ファイル（{attachments.length}）</div>
          {attachments.map((a) => (
            <div key={a.id} className="border-b py-1.5 text-sm">
              <div className="flex items-center gap-2">
                <a href={`/api/attachments/${a.id}`} className="min-w-0 flex-1 truncate text-blue-700 hover:underline">
                  {a.file_name}
                </a>
              <button
                onClick={() => removeAttachment(a.id)}
                className="text-neutral-300 hover:text-red-600"
                title="添付を削除"
              >
                ×
              </button>
              </div>
              <div className="mt-1">
                <AttachmentPreview id={a.id} mime={a.mime_type} name={a.file_name} />
              </div>
            </div>
          ))}
          <label className="mt-1 inline-block cursor-pointer rounded border px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-50">
            {uploading ? "アップロード中…" : "＋ ファイルを選択"}
            <input
              type="file"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadFile(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <div className="mt-4">
          <div className="flex items-center gap-3 border-b pb-1 text-sm">
            <button
              onClick={() => setFeedTab("comments")}
              className={`rounded px-2 py-1 ${feedTab === "comments" ? "font-semibold text-neutral-900" : "text-neutral-500 hover:text-neutral-800"}`}
            >
              コメント
            </button>
            <button
              onClick={() => setFeedTab("activity")}
              className={`rounded px-2 py-1 ${feedTab === "activity" ? "font-semibold text-neutral-900" : "text-neutral-500 hover:text-neutral-800"}`}
            >
              すべてのアクティビティ
            </button>
          </div>
          {feedTab === "comments" ? (
            comments.length === 0 ? (
              <div className="py-3 text-sm text-neutral-400">まだコメントはありません</div>
            ) : (
              comments.map((c) => (
            <div key={c.id} className="flex gap-2 py-2 text-sm">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-300 text-xs font-bold text-white">
                {(c.author_name ?? "?").slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1 rounded-lg bg-neutral-50 px-3 py-2">
                <div className="text-xs font-semibold text-neutral-600">{c.author_name ?? "–"}</div>
                <div
                  className="mt-0.5 text-sm [&_a]:text-blue-700 [&_code]:rounded [&_code]:bg-neutral-200 [&_code]:px-1 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(c.body) }}
                />
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {(reactionMap[c.id] ?? []).map((r) => (
                    <button
                      key={r.emoji}
                      type="button"
                      onClick={() => toggleReaction(c.id, r.emoji)}
                      title="リアクション切替"
                      className={`rounded-full border px-1.5 py-0.5 text-xs ${
                        r.mine ? "border-blue-500 bg-blue-50" : "hover:bg-neutral-100"
                      }`}
                    >
                      {r.emoji} {r.n}
                    </button>
                  ))}
                  {QUICK.filter((e) => !(reactionMap[c.id] ?? []).some((r) => r.emoji === e))
                    .slice(0, 3)
                    .map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => toggleReaction(c.id, e)}
                        title="リアクションする"
                        className="rounded-full border border-dashed px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-100"
                      >
                        {e} ＋
                      </button>
                    ))}
                </div>
              </div>
            </div>
          ))
            )
          ) : (
            <div>
              {events.length === 0 && (
                <div className="py-3 text-sm text-neutral-400">アクティビティはまだありません</div>
              )}
              {events.map((ev) => (
                <div key={ev.id} className="flex gap-2 py-1.5 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[10px] font-bold text-neutral-600">
                    {(ev.actor_name ?? "?").slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-neutral-700">{ev.actor_name ?? "システム"}</span>{" "}
                    <span className="text-neutral-600">{ev.summary}</span>
                    <div className="text-xs text-neutral-400">{ev.created_at.slice(0, 16).replace("T", " ")}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
