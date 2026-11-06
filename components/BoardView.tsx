"use client";

import Link from "next/link";
import { Fragment, useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Section, TaskRow, User } from "@/lib/data";
import { todayISO } from "@/lib/dates";
import { groupBoardTasks, type BoardGroup } from "@/lib/board-group";
import { useLive } from "@/lib/use-live";
import { useApiRefresh, dueSegs } from "./ListView";
import EmptyState from "./EmptyState";
import { usePersistedViewState } from "@/lib/view-state-client";

async function api(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
  return res.json();
}



export default function BoardView({
  projectId,
  sections,
  tasks,
  users,
  initialGroup,
  statusFieldName,
  statusFieldEnabled,
  statusOptions,
  initial,
}: {
  projectId: number;
  sections: Section[];
  tasks: TaskRow[];
  users: User[];
  initialGroup: "section" | "assignee" | "status";
  statusFieldName: string;
  statusFieldEnabled: boolean;
  statusOptions: string[];
  initial: {
    hide_completed?: boolean;
    assignee?: string;
    status?: string;
    sort?: string;
    sortdir?: "asc" | "desc";
  };
}) {
  const refresh = useApiRefresh();
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<"section" | "assignee" | "status">(
    initialGroup === "status" && !statusFieldEnabled ? "section" : initialGroup,
  );
  const effectiveGroupBy = statusFieldEnabled ? groupBy : groupBy === "status" ? "section" : groupBy;
  const [hideCompleted, setHideCompleted] = useState(initial.hide_completed ?? false);
  const [assigneeFilter, setAssigneeFilter] = useState(initial.assignee ?? "");
  const [statusFilter, setStatusFilter] = useState(initial.status ?? "");
  const [sortKey, setSortKey] = useState<"position" | "due" | "name">(
    initial.sort === "due" || initial.sort === "name" ? initial.sort : "position",
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initial.sortdir === "desc" ? "desc" : "asc");
  const [showEmptyGroups, setShowEmptyGroups] = useState(true);
  const [menu, setMenu] = useState<"filter" | "sort" | "options" | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const onLive = useCallback(() => router.refresh(), [router]);
  useLive(projectId, autoRefresh, onLive);
  const dragging = useRef(false);
  const suppressClick = useRef(false);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [cardLimits, setCardLimits] = useState<Record<string, number>>({});
  usePersistedViewState(projectId, "board", {
    group: effectiveGroupBy,
    hide_completed: hideCompleted,
    assignee: assigneeFilter,
    status: statusFilter,
    sort: sortKey,
    sortdir: sortDir,
  });
  const dropRef = useRef<{ groupKey: string; index: number } | null>(null);
  const [dropHint, setDropHint] = useState<{ groupKey: string; index: number } | null>(null);
  const canReorder = sortKey === "position";
  const openTask = (id: number) => {
    const q = new URLSearchParams(window.location.search);
    q.set("task", String(id));
    router.push(`/projects/${projectId}?${q.toString()}`);
  };
  const cardClick = (e: React.MouseEvent, id: number) => {
    if (dragging.current || suppressClick.current) return;
    if ((e.target as HTMLElement).closest("a,button,input,select,textarea,[contenteditable]")) return;
    openTask(id);
  };

  const today = todayISO();
  const sectionName = new Map(sections.map((s) => [s.id, s.name] as const));
  const boardStatusOptions =
    statusOptions.length > 0
      ? statusOptions
      : [...new Set(tasks.map((t) => t.status).filter((st) => st && st !== "inbox"))].sort((a, b) =>
          a.localeCompare(b, "ja"),
        );

  const visibleTasks = tasks.filter((t) => {
    if (hideCompleted && t.completed) return false;
    if (assigneeFilter === "none" && t.assignee_id !== null) return false;
    if (assigneeFilter !== "" && assigneeFilter !== "none" && String(t.assignee_id ?? "") !== assigneeFilter) return false;
    if (statusFieldEnabled && statusFilter !== "" && t.status !== statusFilter) return false;
    return true;
  });
  const sortItems = (items: TaskRow[]) => {
    if (sortKey === "position") {
      return [...items].sort((a, b) => (sortDir === "desc" ? -1 : 1) * (a.position - b.position || a.id - b.id));
    }
    return [...items].sort((a, b) => {
      const av = sortKey === "name" ? a.name : a.due_on;
      const bv = sortKey === "name" ? b.name : b.due_on;
      if (av === null || av === "") return 1;
      if (bv === null || bv === "") return -1;
      const cmp = String(av).localeCompare(String(bv), "ja");
      return (sortDir === "desc" ? -1 : 1) * cmp;
    });
  };
  const groups: BoardGroup<TaskRow>[] = groupBoardTasks(
    visibleTasks,
    sections.map((sc) => sc.id),
    effectiveGroupBy,
  )
    .map((g) => ({ ...g, items: sortItems(g.items) }))
    .filter((g) => showEmptyGroups || g.items.length > 0);
  for (const g of groups) {
    if (g.sectionId !== undefined) {
      g.label = sections.find((sc) => sc.id === g.sectionId)?.name ?? "";
    }
  }
  const activeFilters =
    (hideCompleted ? 1 : 0) +
    (assigneeFilter !== "" ? 1 : 0) +
    (statusFieldEnabled && statusFilter !== "" ? 1 : 0);
  const pushBoardState = (patch: {
    group?: string;
    hide_completed?: boolean;
    assignee?: string;
    status?: string;
    sort?: string;
    sortdir?: "asc" | "desc";
  } = {}) => {
    const q = new URLSearchParams({ view: "board" });
    const nextGroup = patch.group ?? effectiveGroupBy;
    if (nextGroup !== "section") q.set("group", nextGroup);
    const nextHide = patch.hide_completed ?? hideCompleted;
    if (nextHide) q.set("hide", "1");
    const nextAssignee = patch.assignee ?? assigneeFilter;
    if (nextAssignee !== "") q.set("assignee", nextAssignee);
    const nextStatus = patch.status ?? statusFilter;
    if (statusFieldEnabled && nextStatus !== "") q.set("status", nextStatus);
    const nextSort = patch.sort ?? sortKey;
    if (nextSort !== "position") q.set("sort", nextSort);
    const nextDir = patch.sortdir ?? sortDir;
    if (nextSort !== "position" && nextDir === "desc") q.set("sortdir", "desc");
    router.push(`/projects/${projectId}?${q.toString()}`);
  };

  const patchTask = async (taskId: number, fields: Record<string, unknown>) => {
    const target = tasks.find((t) => t.id === taskId);
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fields, expected_updated_at: target?.updated_at }),
    });
    if (res.status === 409) {
      alert("他のユーザーが先に更新しました。最新を表示します。");
      refresh();
      return;
    }
    if (!res.ok) throw new Error(`PATCH /api/tasks/${taskId}: ${res.status}`);
    refresh();
  };

  const onDrop = async (e: React.DragEvent, g: BoardGroup<TaskRow>) => {
    e.preventDefault();
    const taskId = Number(e.dataTransfer.getData("text/atlas-task"));
    if (!taskId) return;
    const moved = tasks.find((t) => t.id === taskId);
    if (!moved) return;
    const hint = dropRef.current?.groupKey === g.key ? dropRef.current.index : null;
    dropRef.current = null;
    setDropHint(null);
    await applyMove(moved, g, hint);
  };

  const dropPosition = (items: TaskRow[], index: number | null): number | undefined => {
    if (index === null) return undefined;
    const before = items[index - 1];
    const after = items[index];
    if (!before && !after) return 1000;
    if (!before) return after.position - 1000;
    if (!after) return before.position + 1000;
    return (before.position + after.position) / 2;
  };

  const applyMove = async (moved: TaskRow, g: BoardGroup<TaskRow>, index: number | null = null) => {
    const taskId = moved.id;
    const siblings = g.items.filter((t) => t.id !== moved.id);
    const position = dropPosition(siblings, index);
    if (g.sectionId !== undefined) {
      const col = g.items;
      const maxPos = col.reduce((mm, t) => Math.max(mm, t.position), 0);
      if (moved.project_id !== null && moved.project_id !== projectId) {
        await api("/api/memberships", "POST", {
          task_id: taskId,
          project_id: projectId,
          section_id: g.sectionId,
        });
        refresh();
      } else {
        await patchTask(taskId, {
          section_id: g.sectionId,
          position: position ?? maxPos + 1000,
        });
      }
    } else if (g.assigneeId !== undefined) {
      const fields: Record<string, unknown> = {};
      if ((moved.assignee_id ?? null) !== (g.assigneeId ?? null)) fields.assignee_id = g.assigneeId;
      if (position !== undefined) fields.position = position;
      if (Object.keys(fields).length > 0) await patchTask(taskId, fields);
    } else if (g.status !== undefined) {
      const fields: Record<string, unknown> = {};
      if (moved.status !== g.status) fields.status = g.status;
      if (position !== undefined) fields.position = position;
      if (Object.keys(fields).length > 0) await patchTask(taskId, fields);
    }
  };

  const moveCard = async (t: TaskRow, dir: -1 | 1) => {
    const gi = groups.findIndex((g) => g.items.some((x) => x.id === t.id));
    const target = groups[gi + dir];
    if (gi === -1 || !target) return;
    await applyMove(t, target);
  };

  const addTask = async (g: BoardGroup<TaskRow>) => {
    const name = (drafts[g.key] ?? "").trim();
    if (!name) return;
    const sectionId = g.sectionId ?? sections[0]?.id ?? null;
    const base: Record<string, unknown> = { project_id: projectId, section_id: sectionId, name };
    if (g.assigneeId !== undefined && g.assigneeId !== null) base.assignee_id = g.assigneeId;
    if (g.status !== undefined) base.status = g.status;
    await api("/api/tasks", "POST", base);
    setDrafts((d) => ({ ...d, [g.key]: "" }));
    refresh();
  };

  return (
    <div
      data-board-view
      data-board-group={effectiveGroupBy}
      data-board-hide-completed={hideCompleted}
      data-board-assignee={assigneeFilter}
      data-board-status={statusFilter}
      data-board-sort={sortKey}
      data-board-sortdir={sortDir}
    >
      <div className="relative flex flex-wrap items-center gap-1.5 px-4 py-2 text-sm text-neutral-600">
        <span className="font-semibold text-neutral-800">ボード</span>
        <span className="text-[12px] text-neutral-500">{visibleTasks.length} 件</span>
        <span className="ml-auto" />

        <div className="relative">
          <button
            type="button"
            data-board-filter
            onClick={() => setMenu((m) => (m === "filter" ? null : "filter"))}
            className={`flex h-7 items-center gap-1 rounded-md border px-2 text-[13px] ${
              activeFilters > 0 || menu === "filter" ? "border-[#2c60b8] bg-[#eff4fd] text-[#2c60b8]" : "border-[#e1e1e1] bg-white text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M2.5 3h11l-4.2 5v4.2L6.7 13V8L2.5 3Z" />
            </svg>
            フィルター
            {activeFilters > 0 && <span className="rounded-full bg-[#2c60b8] px-1 text-[10px] text-white">{activeFilters}</span>}
          </button>
          {menu === "filter" && (
            <>
              <button type="button" aria-label="メニューを閉じる" onClick={() => setMenu(null)} className="fixed inset-0 z-20 cursor-default bg-transparent" />
              <div data-board-filter-menu className="absolute right-0 top-8 z-30 w-64 rounded-lg border border-neutral-200 bg-white p-3 text-[13px] shadow-lg">
                <label className="flex cursor-pointer items-center gap-2 text-neutral-700">
                  <input
                    type="checkbox"
                    data-board-filter-hide
                    checked={hideCompleted}
                    onChange={(e) => {
                      setHideCompleted(e.target.checked);
                      pushBoardState({ hide_completed: e.target.checked });
                    }}
                    className="h-3.5 w-3.5 accent-[#2c60b8]"
                  />
                  完了済みを非表示
                </label>
                <div className="mt-3 text-[11px] font-medium text-neutral-500">担当者</div>
                <select
                  data-board-filter-assignee
                  value={assigneeFilter}
                  onChange={(e) => {
                    setAssigneeFilter(e.target.value);
                    pushBoardState({ assignee: e.target.value });
                  }}
                  className="mt-1 h-8 w-full rounded-md border border-neutral-200 bg-white px-2 text-[13px] outline-none focus:border-[#2c60b8]"
                >
                  <option value="">すべての担当者</option>
                  <option value="none">未割り当て</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
                {statusFieldEnabled && (
                  <>
                    <div className="mt-3 text-[11px] font-medium text-neutral-500">{statusFieldName}</div>
                    <select
                      data-board-filter-status
                      value={statusFilter}
                      onChange={(e) => {
                        setStatusFilter(e.target.value);
                        pushBoardState({ status: e.target.value });
                      }}
                      className="mt-1 h-8 w-full rounded-md border border-neutral-200 bg-white px-2 text-[13px] outline-none focus:border-[#2c60b8]"
                    >
                      <option value="">すべての{statusFieldName}</option>
                      {boardStatusOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                {activeFilters > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setHideCompleted(false);
                      setAssigneeFilter("");
                      setStatusFilter("");
                      pushBoardState({ hide_completed: false, assignee: "", status: "" });
                    }}
                    className="mt-3 text-[12px] text-[#2c60b8] hover:underline"
                  >
                    フィルターを解除
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            data-board-sort
            onClick={() => setMenu((m) => (m === "sort" ? null : "sort"))}
            className={`flex h-7 items-center gap-1 rounded-md border px-2 text-[13px] ${
              sortKey !== "position" || menu === "sort" ? "border-[#2c60b8] bg-[#eff4fd] text-[#2c60b8]" : "border-[#e1e1e1] bg-white text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M4 2.5v11M4 13.5 1.8 11.2M4 13.5l2.2-2.3M9 3h5M9 6.5h4M9 10h3" />
            </svg>
            ソート
          </button>
          {menu === "sort" && (
            <>
              <button type="button" aria-label="メニューを閉じる" onClick={() => setMenu(null)} className="fixed inset-0 z-20 cursor-default bg-transparent" />
              <div data-board-sort-menu className="absolute right-0 top-8 z-30 w-56 rounded-lg border border-neutral-200 bg-white p-1.5 text-[13px] shadow-lg">
                {[
                  ["position", "ボードの順序"],
                  ["due", "期日"],
                  ["name", "名前"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    data-board-sort-option={key}
                    onClick={() => {
                      setSortKey(key as "position" | "due" | "name");
                      pushBoardState({ sort: key });
                      setMenu(null);
                    }}
                    className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-neutral-100 ${
                      sortKey === key ? "text-[#2c60b8]" : "text-neutral-700"
                    }`}
                  >
                    {label}
                    {sortKey === key && <span>✓</span>}
                  </button>
                ))}
                {sortKey !== "position" && (
                  <button
                    type="button"
                    data-board-sort-dir
                    onClick={() => {
                      const next = sortDir === "asc" ? "desc" : "asc";
                      setSortDir(next);
                      pushBoardState({ sortdir: next });
                    }}
                    className="mt-1 flex w-full items-center justify-between rounded border-t border-neutral-100 px-2 py-1.5 text-left text-neutral-600 hover:bg-neutral-100"
                  >
                    <span>並び方向</span>
                    <span>{sortDir === "asc" ? "昇順 ↑" : "降順 ↓"}</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <label className="flex h-7 items-center gap-1 text-[13px] text-neutral-500">
          グループ
          <select
            value={effectiveGroupBy}
            onChange={(e) => {
              const v = e.target.value as typeof groupBy;
              setGroupBy(v);
              setMenu(null);
              pushBoardState({ group: v });
            }}
            className="h-7 rounded-md border border-[#e1e1e1] bg-white px-1.5 text-[13px] text-neutral-700 outline-none hover:bg-neutral-50"
          >
            <option value="section">セクション</option>
            <option value="assignee">担当者</option>
            {statusFieldEnabled && <option value="status">{statusFieldName}</option>}
          </select>
        </label>

        <div className="relative">
          <button
            type="button"
            data-board-options
            onClick={() => setMenu((m) => (m === "options" ? null : "options"))}
            className={`flex h-7 items-center gap-1 rounded-md border px-2 text-[13px] ${
              !showEmptyGroups || !autoRefresh || menu === "options"
                ? "border-[#2c60b8] bg-[#eff4fd] text-[#2c60b8]"
                : "border-[#e1e1e1] bg-white text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M3 4h10M3 8h10M3 12h10" />
            </svg>
            オプション
          </button>
          {menu === "options" && (
            <>
              <button type="button" aria-label="メニューを閉じる" onClick={() => setMenu(null)} className="fixed inset-0 z-20 cursor-default bg-transparent" />
              <div data-board-options-menu className="absolute right-0 top-8 z-30 w-60 rounded-lg border border-neutral-200 bg-white p-3 text-[13px] shadow-lg">
                <label className="flex cursor-pointer items-center gap-2 text-neutral-700">
                  <input
                    type="checkbox"
                    data-board-show-empty
                    checked={showEmptyGroups}
                    onChange={(e) => setShowEmptyGroups(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#2c60b8]"
                  />
                  空のグループを表示
                </label>
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-neutral-700">
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#2c60b8]"
                  />
                  20秒ごとに自動更新
                </label>
              </div>
            </>
          )}
        </div>
      </div>
      {tasks.length === 0 && (
        <EmptyState
          scope="board"
          title="カードがありません"
          description="列にカードを追加してボードを始めましょう。"
          action={
            <button
              type="button"
              onClick={() => setAddingTo(groups[0]?.key ?? null)}
              className="h-8 rounded-md bg-[#2c60b8] px-4 text-[13px] font-medium text-white hover:bg-[#24529c]"
            >
              ＋ タスクを追加
            </button>
          }
        />
      )}
      <div className="flex gap-3 overflow-x-auto p-4 pb-16">
        {groups.map((g) => (
          <div
            key={g.key}
            className="relative w-72 shrink-0 rounded-lg bg-neutral-100 p-2"
          >
            {isDragging && (
              <div
                data-board-drop-zone={g.key}
                className="absolute inset-0 z-10"
                onDrop={(e) => onDrop(e, g)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!canReorder) return;
                  const column = e.currentTarget.parentElement;
                  const items = g.items.filter((t) => t.id !== draggedId);
                  let index = 0;
                  for (const item of items) {
                    const el = column?.querySelector<HTMLElement>(`[data-board-card="${item.id}"]`);
                    if (!el) continue;
                    const rect = el.getBoundingClientRect();
                    if (e.clientY > rect.top + rect.height / 2) index += 1;
                    else break;
                  }
                  dropRef.current = { groupKey: g.key, index };
                  setDropHint({ groupKey: g.key, index });
                }}
              />
            )}
            <div className="flex items-baseline gap-2 px-1 py-1">
              <span className="font-semibold">{g.label}</span>
              <span className="text-sm text-neutral-600">{g.items.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {(() => {
                const shownItems = g.items.slice(0, cardLimits[g.key] ?? 100);
                const draggedAt = g.items.findIndex((t) => t.id === draggedId);
                const hintAt =
                  dropHint?.groupKey === g.key
                    ? dropHint.index + (draggedAt !== -1 && draggedAt <= dropHint.index ? 1 : 0)
                    : -1;
                return (
                  <>
                    {shownItems.map((t, index) => (
                      <Fragment key={t.id}>
                        {hintAt === index && (
                          <div data-board-drop-line className="h-0.5 -my-0.5 rounded-full bg-[#2c60b8]" />
                        )}
                        <div
                          data-board-card={t.id}
                          data-board-assignee={t.assignee_name ?? ""}
                          data-board-due={t.due_on ?? ""}
                          data-board-status={t.status}
                          data-board-subtask-count={t.subtask_count ?? 0}
                          data-board-comment-count={t.comment_count ?? 0}
                          draggable
                          onDragStart={(e) => {
                            dragging.current = true;
                            suppressClick.current = true;
                            setDraggedId(t.id);
                            setIsDragging(true);
                            e.dataTransfer.setData("text/atlas-task", String(t.id));
                          }}
                          onDragEnd={() => {
                            setTimeout(() => {
                              dragging.current = false;
                              suppressClick.current = false;
                              setDraggedId(null);
                              setIsDragging(false);
                              dropRef.current = null;
                              setDropHint(null);
                            }, 0);
                          }}
                          onClick={(e) => cardClick(e, t.id)}
                          className="cursor-pointer rounded-lg border border-[#eaeaea] bg-white p-2 text-sm shadow-[0_1px_4px_rgba(0,0,0,0.06)] hover:shadow-md active:cursor-grabbing"
                        >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                        t.completed ? "border-green-700 bg-green-700 text-white" : "border-neutral-400"
                      }`}
                    >
                      {t.completed && "✓"}
                    </span>
                    <Link
                      href={`/projects/${projectId}?view=board&task=${t.id}`}
                      title={t.name}
                      dir="auto"
                      className={`line-clamp-2 break-words ${t.completed ? "text-neutral-500 line-through" : ""}`}
                    >
                      {t.name}
                    </Link>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                    {effectiveGroupBy !== "section" && (t.eff_section_id ?? t.section_id) !== null && (
                      <span className="rounded bg-neutral-200 px-1.5 py-0.5">
                        {sectionName.get((t.eff_section_id ?? t.section_id) as number) ?? ""}
                      </span>
                    )}
                    {t.assignee_name && (
                      <span className="flex items-center gap-1">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-400 text-[10px] font-bold text-neutral-900">
                          {t.assignee_name.slice(0, 1)}
                        </span>
                        {t.assignee_name}
                      </span>
                    )}
                    {(t.start_on || t.due_on) && (
                      (() => {
                        const [s1, s2] = dueSegs(t.start_on, t.due_on);
                        return (
                          <span
                            className={`rounded-full px-1.5 py-0.5 ${
                              !t.completed && t.due_on !== null && t.due_on < today
                                ? "bg-red-100 font-semibold text-red-700"
                                : "bg-neutral-100 text-neutral-700"
                            }`}
                          >
                            <span className="whitespace-nowrap">{s1}</span>
                            {s2 && <span className="whitespace-nowrap"> – {s2}</span>}
                          </span>
                        );
                      })()
                    )}
                    {statusFieldEnabled && t.status !== "inbox" && (
                      <span
                        className={`rounded-full px-1.5 py-0.5 ${
                          t.status === "Done" || t.status === "完了"
                            ? "bg-green-100 text-green-800"
                            : t.status === "進行中" || t.status === "In Progress"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-neutral-100 text-neutral-700"
                        }`}
                      >
                        {t.status}
                      </span>
                    )}
                    {t.subtask_count > 0 && (
                      <span data-board-subtask-badge className="flex items-center gap-0.5" title="サブタスク">
                        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.2">
                          <path d="M4 3v4.5a2 2 0 0 0 2 2h6" />
                          <path d="M9.5 7.5 12 9.5 9.5 11.5" />
                        </svg>
                        {t.subtask_count}
                      </span>
                    )}
                    {t.comment_count > 0 && (
                      <span data-board-comment-badge className="flex items-center gap-0.5" title="コメント">
                        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.2">
                          <path d="M3 3.5h10v7H7.5L4.5 13v-2.5H3z" />
                        </svg>
                        {t.comment_count}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex gap-1 md:hidden">
                    <button
                      onClick={() => moveCard(t, -1)}
                      className="rounded border px-2 py-0.5 text-xs"
                    >
                      ←
                    </button>
                    <button
                      onClick={() => moveCard(t, 1)}
                      className="rounded border px-2 py-0.5 text-xs"
                    >
                      →
                    </button>
                  </div>
                        </div>
                      </Fragment>
                    ))}
                    {hintAt === g.items.length && (
                      <div data-board-drop-line className="h-0.5 -my-0.5 rounded-full bg-[#2c60b8]" />
                    )}
                  </>
                );
              })()}
              {g.items.length > (cardLimits[g.key] ?? 100) && (
                <button
                  type="button"
                  data-board-show-more={g.key}
                  onClick={() =>
                    setCardLimits((current) => ({ ...current, [g.key]: (current[g.key] ?? 100) + 200 }))
                  }
                  className="rounded-md border border-[#e1e1e1] bg-white px-2 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"
                >
                  さらに表示（{cardLimits[g.key] ?? 100} / {g.items.length} 件）
                </button>
              )}
            </div>
            {addingTo === g.key ? (
              <div className="mt-2 flex gap-1">
                <input
                  value={drafts[g.key] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [g.key]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      addTask(g);
                      setAddingTo(null);
                    }
                    if (e.key === "Escape") setAddingTo(null);
                  }}
                  onBlur={() => {
                    if ((drafts[g.key] ?? "").trim() === "") setAddingTo(null);
                  }}
                  placeholder="タスク名を入力"
                  data-add-task
                  autoFocus
                  className="w-full rounded border px-2 py-1 text-sm outline-none focus:border-blue-500"
                />
                <button
                  onClick={() => {
                    addTask(g);
                    setAddingTo(null);
                  }}
                  className="shrink-0 rounded bg-blue-600 px-2 py-1 text-sm text-white"
                >
                  追加
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAddingTo(g.key)}
                data-add-task-open
                className="mt-2 w-full rounded px-2 py-1 text-left text-sm text-neutral-600 hover:bg-neutral-200/60 hover:text-neutral-700"
              >
                ＋ タスクを追加
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
