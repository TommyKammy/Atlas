"use client";

import { useQuickTasks, useQuickTask } from "@/components/task/QuickTaskContext";

import ProjectTaskCreateButton from "@/components/task/ProjectTaskCreateButton";
import { isImeComposing } from "@/lib/ime-keyboard";

import { toast as toastMessage } from "@/lib/ui-feedback";

import { api } from "@/lib/api-client";
import { boardColumnState } from "@/lib/board-column-state";
import { groupBoardTasks, type BoardGroup } from "@/lib/board-group";
import type { Section, TaskRow, User } from "@/lib/data";
import { todayISO } from "@/lib/dates";
import { isQuickTask } from "@/lib/quick-task";
import { countOverdueTasks } from "@/lib/list-row-state";
import { parseListDateFilter, parseListGroupBy, parseListSortKey, taskMatchesListFilters, type ListDateFilter, type ListFilters, type ListGroupBy, type ListSortKey } from "@/lib/list-view";
import { patchTask, TaskConflictError } from "@/lib/task-client";
import { useApiRefresh } from "@/lib/use-api-refresh";
import { useLive } from "@/lib/use-live";
import { usePersistedViewState } from "@/lib/view-state-client";
import { SectionDraftProvider } from "@/lib/section-draft-context";
import { useSectionDraft } from "@/lib/use-section-draft";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useRef, useState } from "react";
import BoardCard from "./board/BoardCard";
import BoardColumnStateIcon from "./board/BoardColumnStateIcon";
import BoardSectionAdd from "./board/BoardSectionAdd";
import BoardToolbar, { type BoardCardFields } from "./board/BoardToolbar";
import EmptyState from "./EmptyState";




function BoardViewContent({
  projectId,
  sections,
  tasks: serverTasks,
  users,
  viewerId,
  initialGroup,
  statusFieldName,
  statusFieldEnabled,
  statusOptions,
  initial,
  viewName,
  viewIcon,
  viewTabId,
  canEdit,
  canConfigure,
}: {
  projectId: number;
  sections: Section[];
  tasks: TaskRow[];
  users: User[];
  viewerId: number;
  initialGroup: ListGroupBy;
  statusFieldName: string;
  statusFieldEnabled: boolean;
  statusOptions: string[];
  viewName: string;
  viewIcon: string | null;
  viewTabId: number | null;
  canEdit: boolean;
  canConfigure: boolean;
  initial: {
    hide_completed?: boolean;
    completed_only?: boolean;
    mine_only?: boolean;
    assignee?: string;
    status?: string;
    due?: string;
    start?: string;
    creator?: string;
    created?: string;
    updated?: string;
    completed_on?: string;
    sort?: string;
    sortdir?: "asc" | "desc";
    show_empty_groups?: boolean;
    auto_refresh?: boolean;
    show_assignee?: boolean;
    show_due?: boolean;
    show_status?: boolean;
    show_meta?: boolean;
  };
}) {
  const tasks = useQuickTasks(serverTasks);
  const quick = useQuickTask();
  const refresh = useApiRefresh();
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [addingTask, setAddingTask] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);
  const [groupBy, setGroupBy] = useState<ListGroupBy>(() =>
    parseListGroupBy(initialGroup, statusFieldEnabled),
  );
  const [groupDir, setGroupDir] = useState<"asc" | "desc">("asc");
  const effectiveGroupBy = groupBy;
  const [hideCompleted, setHideCompleted] = useState(initial.hide_completed ?? false);
  const [completedOnly, setCompletedOnly] = useState(initial.completed_only === true);
  const [mineOnly, setMineOnly] = useState(initial.mine_only === true);
  const [assigneeFilter, setAssigneeFilter] = useState(initial.assignee ?? "");
  const [statusFilter, setStatusFilter] = useState(initial.status ?? "");
  const [dueFilter, setDueFilter] = useState(initial.due ?? "");
  const [startFilter, setStartFilter] = useState<ListDateFilter>(() => parseListDateFilter(initial.start));
  const [creatorFilter, setCreatorFilter] = useState(initial.creator ?? "");
  const [createdFilter, setCreatedFilter] = useState<ListDateFilter>(() => parseListDateFilter(initial.created));
  const [updatedFilter, setUpdatedFilter] = useState<ListDateFilter>(() => parseListDateFilter(initial.updated));
  const [completedDateFilter, setCompletedDateFilter] = useState<ListDateFilter>(() =>
    parseListDateFilter(initial.completed_on),
  );
  const [sortKey, setSortKey] = useState<ListSortKey>(() => parseListSortKey(initial.sort));
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initial.sortdir === "desc" ? "desc" : "asc");
  const [showEmptyGroups, setShowEmptyGroups] = useState(initial.show_empty_groups !== false);
  const [createdSectionIds, setCreatedSectionIds] = useState<Set<number>>(() => new Set());
  const [autoRefresh, setAutoRefresh] = useState(initial.auto_refresh !== false);
  const [cardFields, setCardFields] = useState<BoardCardFields>({
    assignee: initial.show_assignee !== false,
    due: initial.show_due !== false,
    status: initial.show_status !== false,
    meta: initial.show_meta !== false,
  });
  const sectionDraft = useSectionDraft({
    projectId,
    onCreated: (created, origin) => {
      setCreatedSectionIds((current) => new Set(current).add(created.id));
      refresh();
      if (origin !== "enter") return;
      // The new column arrives with the server refresh; keep checking for it
      // so the column's task composer can receive focus.
      const focusColumn = (attempt = 0) => {
        const column = document.querySelector<HTMLElement>(`[data-board-column="s${created.id}"]`);
        if (!column) {
          if (attempt < 120) requestAnimationFrame(() => focusColumn(attempt + 1));
          return;
        }
        column.scrollIntoView({ block: "nearest", inline: "nearest" });
        quick?.create("task", created.id);
      };
      requestAnimationFrame(() => focusColumn());
    },
  });
  const onLive = useCallback(() => router.refresh(), [router]);
  useLive(projectId, autoRefresh, onLive);
  const dragging = useRef(false);
  const suppressClick = useRef(false);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [cardLimits, setCardLimits] = useState<Record<string, number>>({});
  usePersistedViewState(projectId, "board", {
    group: effectiveGroupBy,
    groupdir: groupDir,
    hide_completed: hideCompleted,
    completed_only: completedOnly,
    mine_only: mineOnly,
    assignee: assigneeFilter,
    status: statusFilter,
    due: dueFilter,
    start: startFilter,
    creator: creatorFilter,
    created: createdFilter,
    updated: updatedFilter,
    completed_on: completedDateFilter,
    sort: sortKey,
    sortdir: sortDir,
    show_empty_groups: showEmptyGroups,
    auto_refresh: autoRefresh,
    show_assignee: cardFields.assignee,
    show_due: cardFields.due,
    show_status: cardFields.status,
    show_meta: cardFields.meta,
  });
  const dropRef = useRef<{ groupKey: string; index: number } | null>(null);
  const [dropHint, setDropHint] = useState<{ groupKey: string; index: number } | null>(null);
  const canReorder = sortKey === "position";
  const canDragCards =
    canReorder && (groupBy === "section" || groupBy === "assignee" || groupBy === "status");
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
  const shiftDay = (days: number) => {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const filters: ListFilters = {
    hide_completed: hideCompleted,
    completed_only: completedOnly,
    mine_only: mineOnly,
    assignee: assigneeFilter,
    status: statusFilter,
    due: dueFilter,
    start: startFilter,
    creator: creatorFilter,
    created: createdFilter,
    updated: updatedFilter,
    completed_on: completedDateFilter,
  };
  const visibleTasks = tasks.filter((task) =>
    taskMatchesListFilters(task, filters, {
      today,
      viewerId,
      statusFieldEnabled,
      dayOffset: shiftDay,
    }),
  );
  // Counted over the project's board tasks, not the filtered set: the button
  // reports the backlog the project has, and pressing it reveals that filter.
  const overdueCount = countOverdueTasks(tasks, today);
  const sortItems = (items: TaskRow[]) => {
    const dir = sortDir === "asc" ? 1 : -1;
    const text = (a: string | null | undefined, b: string | null | undefined) => {
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b, "ja") * dir;
    };
    const date = (a: string | null | undefined, b: string | null | undefined) => {
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b) * dir;
    };
    return [...items].sort((a, b) => {
      const aQuick = isQuickTask(a);
      const bQuick = isQuickTask(b);
      if (aQuick !== bQuick) return aQuick ? 1 : -1;
      if (aQuick && bQuick) return a.position - b.position || a.id - b.id;
      if (sortKey === "position") return a.position - b.position || a.id - b.id;
      if (sortKey === "start") return date(a.start_on, b.start_on);
      if (sortKey === "due") return date(a.due_on, b.due_on);
      if (sortKey === "assignee") return text(a.assignee_name, b.assignee_name);
      if (sortKey === "creator") return text(a.creator_name, b.creator_name);
      if (sortKey === "created") return date(a.created_at, b.created_at);
      if (sortKey === "updated") return date(a.updated_at, b.updated_at);
      if (sortKey === "completed") return date(a.completed_at, b.completed_at);
      if (sortKey === "likes") return ((a.like_count ?? 0) - (b.like_count ?? 0)) * dir;
      if (sortKey === "name") return text(a.name, b.name);
      if (sortKey === "progress") return (a.progress - b.progress) * dir;
      if (sortKey === "status") return text(a.status, b.status);
      if (sortKey === "project") return text(a.project_name, b.project_name);
      return a.position - b.position || a.id - b.id;
    });
  };
  const groupKeyFor = (task: TaskRow, key: ListGroupBy): { key: string; label: string; assigneeId?: number | null; status?: string } => {
    if (key === "assignee") {
      return {
        key: task.assignee_id === null ? "none" : `u${task.assignee_id}`,
        label: task.assignee_name ?? "（未割当）",
        assigneeId: task.assignee_id,
      };
    }
    if (key === "status") {
      return { key: task.status || "（未設定）", label: task.status || "（未設定）", status: task.status };
    }
    if (key === "creator") return { key: task.creator_name ?? "（作成者なし）", label: task.creator_name ?? "（作成者なし）" };
    if (key === "due") return { key: task.due_on ?? "（期日なし）", label: task.due_on ?? "（期日なし）" };
    if (key === "start") return { key: task.start_on ?? "（開始日なし）", label: task.start_on ?? "（開始日なし）" };
    if (key === "created") return { key: task.created_at.slice(0, 10), label: task.created_at.slice(0, 10) };
    if (key === "updated") return { key: task.updated_at.slice(0, 10), label: task.updated_at.slice(0, 10) };
    if (key === "completed") {
      if (!task.completed) return { key: "（未完了）", label: "（未完了）" };
      const label = task.completed_at?.slice(0, 10) ?? "（完了日なし）";
      return { key: label, label };
    }
    if (key === "project") return { key: task.project_name ?? "（プロジェクトなし）", label: task.project_name ?? "（プロジェクトなし）" };
    return { key: "", label: "" };
  };
  const sortGroups = (groups: BoardGroup<TaskRow>[]) =>
    groups.sort((a, b) => {
      if (a.label.startsWith("（") && !b.label.startsWith("（")) return 1;
      if (!a.label.startsWith("（") && b.label.startsWith("（")) return -1;
      return a.label.localeCompare(b.label, "ja") * (groupDir === "asc" ? 1 : -1);
    });
  let groups: BoardGroup<TaskRow>[];
  if (effectiveGroupBy === "section") {
    groups = groupBoardTasks(visibleTasks, sections.map((sc) => sc.id), "section").map((g) => ({
      ...g,
      items: sortItems(g.items),
      label: sections.find((sc) => sc.id === g.sectionId)?.name ?? g.label,
    }));
  } else {
    const map = new Map<string, BoardGroup<TaskRow>>();
    for (const task of visibleTasks) {
      const info = groupKeyFor(task, effectiveGroupBy);
      if (!map.has(info.key)) {
        map.set(info.key, {
          key: info.key,
          label: info.label,
          assigneeId: info.assigneeId,
          status: info.status,
          items: [],
        });
      }
      map.get(info.key)!.items.push(task);
    }
    groups = sortGroups([...map.values()].map((group) => ({ ...group, items: sortItems(group.items) })));
  }
  // Reveal newly added columns without changing the user's empty-group setting.
  groups = groups.filter((g) => showEmptyGroups || g.items.length > 0 ||
    g.sectionId != null && createdSectionIds.has(g.sectionId));
  const activeFilters =
    (hideCompleted ? 1 : 0) +
    (completedOnly ? 1 : 0) +
    (mineOnly ? 1 : 0) +
    (assigneeFilter !== "" ? 1 : 0) +
    (statusFieldEnabled && statusFilter !== "" ? 1 : 0) +
    (dueFilter !== "" ? 1 : 0) +
    (startFilter !== "" ? 1 : 0) +
    (creatorFilter !== "" ? 1 : 0) +
    (createdFilter !== "" ? 1 : 0) +
    (updatedFilter !== "" ? 1 : 0) +
    (completedDateFilter !== "" ? 1 : 0);
  const pushBoardState = (patch: {
    group?: string;
    groupdir?: "asc" | "desc";
    hide_completed?: boolean;
    completed_only?: boolean;
    mine_only?: boolean;
    assignee?: string;
    status?: string;
    due?: string;
    start?: string;
    creator?: string;
    created?: string;
    updated?: string;
    completed_on?: string;
    sort?: string;
    sortdir?: "asc" | "desc";
  } = {}) => {
    const q = new URLSearchParams(window.location.search);
    q.set("view", "board");
    const nextGroup = patch.group ?? effectiveGroupBy;
    if (nextGroup !== "section") q.set("group", nextGroup);
    else q.delete("group");
    const nextGroupDir = patch.groupdir ?? groupDir;
    if (nextGroupDir === "desc") q.set("groupdir", "desc");
    else q.delete("groupdir");
    const nextHide = patch.hide_completed ?? hideCompleted;
    if (nextHide) q.set("hide", "1");
    else q.delete("hide");
    const nextCompleted = patch.completed_only ?? completedOnly;
    if (nextCompleted) q.set("completed", "done");
    else q.delete("completed");
    const nextMine = patch.mine_only ?? mineOnly;
    if (nextMine) q.set("mine", "1");
    else q.delete("mine");
    const nextAssignee = patch.assignee ?? assigneeFilter;
    if (nextAssignee !== "") q.set("assignee", nextAssignee);
    else q.delete("assignee");
    const nextStatus = patch.status ?? statusFilter;
    if (statusFieldEnabled && nextStatus !== "") q.set("status", nextStatus);
    else q.delete("status");
    const nextDue = patch.due ?? dueFilter;
    if (nextDue !== "") q.set("due", nextDue);
    else q.delete("due");
    const nextStart = patch.start ?? startFilter;
    if (nextStart !== "") q.set("start", nextStart);
    else q.delete("start");
    const nextCreator = patch.creator ?? creatorFilter;
    if (nextCreator !== "") q.set("creator", nextCreator);
    else q.delete("creator");
    const nextCreated = patch.created ?? createdFilter;
    if (nextCreated !== "") q.set("created", nextCreated);
    else q.delete("created");
    const nextUpdated = patch.updated ?? updatedFilter;
    if (nextUpdated !== "") q.set("updated", nextUpdated);
    else q.delete("updated");
    const nextCompletedOn = patch.completed_on ?? completedDateFilter;
    if (nextCompletedOn !== "") q.set("completed_on", nextCompletedOn);
    else q.delete("completed_on");
    const nextSort = patch.sort ?? sortKey;
    if (nextSort !== "position") {
      q.set("sort", nextSort);
      const nextDir = patch.sortdir ?? sortDir;
      if (nextDir === "desc") q.set("sortdir", "desc");
      else q.delete("sortdir");
    } else {
      q.delete("sort");
      q.delete("sortdir");
    }
    router.push(`/projects/${projectId}?${q.toString()}`);
  };
  const setFilter = (key: keyof ListFilters, value: string | boolean) => {
    if (key === "hide_completed") {
      const next = value === true;
      setHideCompleted(next);
      pushBoardState({ hide_completed: next });
    } else if (key === "completed_only") {
      const next = value === true;
      setCompletedOnly(next);
      pushBoardState({ completed_only: next });
    } else if (key === "mine_only") {
      const next = value === true;
      setMineOnly(next);
      pushBoardState({ mine_only: next });
    } else if (key === "assignee") {
      const next = String(value);
      setAssigneeFilter(next);
      pushBoardState({ assignee: next });
    } else if (key === "status") {
      const next = String(value);
      setStatusFilter(next);
      pushBoardState({ status: next });
    } else if (key === "due") {
      const next = String(value);
      setDueFilter(next);
      pushBoardState({ due: next });
    } else if (key === "start") {
      const next = parseListDateFilter(value);
      setStartFilter(next);
      pushBoardState({ start: next });
    } else if (key === "creator") {
      const next = String(value);
      setCreatorFilter(next);
      pushBoardState({ creator: next });
    } else if (key === "created") {
      const next = parseListDateFilter(value);
      setCreatedFilter(next);
      pushBoardState({ created: next });
    } else if (key === "updated") {
      const next = parseListDateFilter(value);
      setUpdatedFilter(next);
      pushBoardState({ updated: next });
    } else if (key === "completed_on") {
      const next = parseListDateFilter(value);
      setCompletedDateFilter(next);
      pushBoardState({ completed_on: next });
    }
  };
  const clearFilters = () => {
    setHideCompleted(false);
    setCompletedOnly(false);
    setMineOnly(false);
    setAssigneeFilter("");
    setStatusFilter("");
    setDueFilter("");
    setStartFilter("");
    setCreatorFilter("");
    setCreatedFilter("");
    setUpdatedFilter("");
    setCompletedDateFilter("");
    const q = new URLSearchParams({ view: "board" });
    if (effectiveGroupBy !== "section") q.set("group", effectiveGroupBy);
    if (groupDir === "desc") q.set("groupdir", "desc");
    if (sortKey !== "position") {
      q.set("sort", sortKey);
      if (sortDir === "desc") q.set("sortdir", "desc");
    }
    router.push(`/projects/${projectId}?${q.toString()}`);
  };
  const applySortKey = (key: Exclude<ListSortKey, "position">) => {
    if (sortKey === key) {
      const next = sortDir === "asc" ? "desc" : "asc";
      setSortDir(next);
      pushBoardState({ sort: key, sortdir: next });
    } else {
      setSortKey(key);
      setSortDir("asc");
      pushBoardState({ sort: key, sortdir: "asc" });
    }
  };
  const clearSort = () => {
    setSortKey("position");
    setSortDir("asc");
    pushBoardState({ sort: "position" });
  };
  const selectGroup = (key: ListGroupBy) => {
    setGroupBy(key);
    pushBoardState({ group: key });
  };
  const clearGroup = () => {
    setGroupBy("section");
    setGroupDir("asc");
    pushBoardState({ group: "section", groupdir: "asc" });
  };

  const patchTaskFields = async (taskId: number, fields: Record<string, unknown>) => {
    const target = tasks.find((t) => t.id === taskId);
    try {
      await patchTask(taskId, fields, target?.updated_at);
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

  const applyMove = async (moved: TaskRow, g: BoardGroup<TaskRow>, index: number | null = null) => {
    const fields: Record<string, unknown> = {};
    if (g.sectionId !== undefined) fields.section_id = g.sectionId;
    else if (g.assigneeId !== undefined && moved.assignee_id !== g.assigneeId) fields.assignee_id = g.assigneeId;
    else if (g.status !== undefined && moved.status !== g.status) fields.status = g.status;

    if (index !== null || g.sectionId !== undefined) {
      const siblings = g.items.filter(task => task.id !== moved.id);
      const next = index === null ? null : siblings[index];
      const previous = index === null && !canReorder ? null : siblings.at(-1);
      fields.placement = {
        project_id: projectId,
        anchor_id: next?.id ?? previous?.id ?? null,
        side: next ? "before" : "after",
      };
    }
    if (Object.keys(fields).length === 0) return;
    try {
      await patchTaskFields(moved.id, fields);
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : "移動に失敗しました");
      refresh();
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
    if (!canEdit || addingTask || !name) return;
    const sectionId = g.key === "s-none" ? null : g.sectionId ?? sections[0]?.id ?? null;
    const base: Record<string, unknown> = { project_id: projectId, section_id: sectionId, name };
    if (g.assigneeId !== undefined && g.assigneeId !== null) base.assignee_id = g.assigneeId;
    if (g.status !== undefined) base.status = g.status;
    setAddingTask(true);
    try {
      await api("/api/tasks", "POST", base);
      setDrafts((d) => ({ ...d, [g.key]: "" }));
      setAddingTo(null);
      refresh();
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : "タスクを追加できませんでした");
    } finally {
      setAddingTask(false);
    }
  };

  // The column heading and the footer link open the same composer: a quick
  // card in section grouping, an inline field in every other grouping.
  const startAdd = (g: BoardGroup<TaskRow>) => {
    if (effectiveGroupBy === "section")
      quick?.create("task", g.key === "s-none" ? null : g.sectionId);
    else setAddingTo(g.key);
  };

  return (
    <SectionDraftProvider
      start={canConfigure && effectiveGroupBy === "section" ? () => sectionDraft.start(null) : null}
    >
    <div
      className="flex h-full min-h-0 flex-col"
      data-board-view
      data-board-group={effectiveGroupBy}
      data-board-hide-completed={hideCompleted}
      data-board-assignee={assigneeFilter}
      data-board-status={statusFilter}
      data-board-sort={sortKey}
      data-board-sortdir={sortDir}
      data-board-groupdir={groupDir}
      data-board-completed-only={completedOnly}
      data-board-mine-only={mineOnly}
      data-board-due={dueFilter}
      data-board-start={startFilter}
      data-board-creator={creatorFilter}
      data-board-created={createdFilter}
      data-board-updated={updatedFilter}
      data-board-completed-on={completedDateFilter}
      data-board-show-empty={showEmptyGroups}
    >
      <BoardToolbar
        projectId={projectId}
        sections={sections}
        users={users}
        statusFieldEnabled={statusFieldEnabled}
        statusFieldName={statusFieldName}
        statusOptions={statusOptions}
        filters={filters}
        activeFilterCount={activeFilters}
        overdueCount={overdueCount}
        onFilterChange={setFilter}
        clearFilters={clearFilters}
        sortKey={sortKey}
        sortDir={sortDir}
        onSortSelect={applySortKey}
        onToggleSortDir={() => {
          const next = sortDir === "asc" ? "desc" : "asc";
          setSortDir(next);
          pushBoardState({ sort: sortKey, sortdir: next });
        }}
        clearSort={clearSort}
        groupBy={groupBy}
        groupDir={groupDir}
        onSelectGroup={selectGroup}
        onSetGroupDir={(dir) => {
          setGroupDir(dir);
          pushBoardState({ groupdir: dir });
        }}
        clearGroup={clearGroup}
        viewName={viewName}
        viewIcon={viewIcon}
        viewTabId={viewTabId}
        canEdit={canEdit}
        showEmptyGroups={showEmptyGroups}
        setShowEmptyGroups={(show) => {
          setCreatedSectionIds(new Set());
          setShowEmptyGroups(show);
        }}
        autoRefresh={autoRefresh}
        setAutoRefresh={setAutoRefresh}
        cardFields={cardFields}
        onToggleCardField={(key) => setCardFields((current) => ({ ...current, [key]: !current[key] }))}
      />
      <div data-page-scroll className="min-h-0 flex-1 overflow-auto">
      {tasks.length === 0 && (
        <EmptyState
          scope="board"
          title="カードがありません"
          description="列にカードを追加してボードを始めましょう。"
          action={
            <ProjectTaskCreateButton projectId={projectId} sections={sections} users={users} disabled={!canEdit} />
          }
        />
      )}
      <div data-board-columns className="flex gap-4 overflow-x-auto p-4 pb-16">
        {groups.map((g) => (
          <div
            key={g.key}
            data-board-column={g.key}
            className="relative w-[17.5rem] shrink-0"
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
            <div className="flex items-center gap-2 px-1 pt-1 pb-2">
              <h2 data-board-column-header className="flex min-w-0 items-center gap-2 text-[13px] font-bold text-text">
                {effectiveGroupBy === "status" && (() => {
                  const state = boardColumnState(g.status);
                  return state ? <BoardColumnStateIcon state={state} /> : null;
                })()}
                <span className="truncate" title={g.label}>{g.label}</span>
                <span data-board-column-count className="shrink-0 font-normal text-muted">{g.items.length}</span>
              </h2>
              <button
                type="button"
                data-board-column-add
                aria-label={`${g.label}にタスクを追加`}
                disabled={!canEdit}
                onClick={() => startAdd(g)}
                className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-base leading-none text-muted hover:bg-hover hover:text-secondary disabled:opacity-40"
              >
                ＋
              </button>
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
                          <div data-board-drop-line className="h-0.5 -my-0.5 rounded-full bg-accent" />
                        )}
                        <BoardCard
                          task={t}
                          projectId={projectId}
                          canDragCards={canDragCards}
                          effectiveGroupBy={effectiveGroupBy}
                          sectionName={sectionName}
                          cardFields={cardFields}
                          statusFieldEnabled={statusFieldEnabled}
                          today={today}
                          onDragStart={(event, taskId) => {
                            dragging.current = true;
                            suppressClick.current = true;
                            setDraggedId(taskId);
                            setIsDragging(true);
                            event.dataTransfer.setData("text/atlas-task", String(taskId));
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
                          onClick={(event, taskId) => cardClick(event, taskId)}
                          onToggleComplete={() =>
                            void patchTaskFields(t.id, { completed: !t.completed })
                          }
                          onMove={(delta) => moveCard(t, delta)}
                        />
                      </Fragment>
                    ))}
                    {hintAt === g.items.length && (
                      <div data-board-drop-line className="h-0.5 -my-0.5 rounded-full bg-accent" />
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
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-[12px] text-secondary hover:bg-hover"
                >
                  さらに表示（{cardLimits[g.key] ?? 100} / {g.items.length} 件）
                </button>
              )}
            </div>
            {addingTo === g.key ? (
              <div className="mt-2 flex gap-1">
                <input
                  ref={addInputRef}
                  disabled={addingTask}
                  value={drafts[g.key] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [g.key]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (isImeComposing(e)) return;
                    if (e.key === "Enter") {
                      void addTask(g);
                    }
                    if (e.key === "Escape") setAddingTo(null);
                  }}
                  onBlur={() => {
                    if ((drafts[g.key] ?? "").trim() === "") setAddingTo(null);
                  }}
                  placeholder="タスク名を入力"
                  data-add-task
                  autoFocus
                  className="w-full rounded-md border border-field-line bg-field px-2 py-1 text-sm outline-none focus:border-accent"
                />
                <button
                  disabled={addingTask || !(drafts[g.key] ?? "").trim()}
                  onClick={() => {
                    void addTask(g);
                  }}
                  className="shrink-0 rounded bg-accent px-2 py-1 text-sm text-on-accent"
                >
                  追加
                </button>
              </div>
            ) : (
              <button
                onClick={() => startAdd(g)}
                disabled={!canEdit}
                data-add-task-open
                className="mt-2 w-full rounded px-2 py-1 text-left text-[12px] text-muted hover:bg-hover hover:text-secondary"
              >
                ＋ タスクを追加
              </button>
            )}
          </div>
        ))}
        {canConfigure && effectiveGroupBy === "section" && (
          <BoardSectionAdd
            draft={sectionDraft}
            onStart={() => sectionDraft.start(null)}
          />
        )}
      </div>
      </div>
    </div>
    </SectionDraftProvider>
  );
}

export default function BoardView(props: Parameters<typeof BoardViewContent>[0]) {
  return <BoardViewContent {...props} />;
}
