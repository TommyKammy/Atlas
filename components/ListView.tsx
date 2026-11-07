"use client";

import { confirmAction, toast as toastMessage } from "@/lib/ui-feedback";

import { ApiError, api } from "@/lib/api-client";
import { patchTask, TaskConflictError } from "@/lib/task-client";
import { useRouter } from "next/navigation";
import { useLive } from "@/lib/use-live";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { SavedView, Section, TaskRow, TaskTemplate, User } from "@/lib/data";
import { todayISO } from "@/lib/dates";
import { customValueToInput, type CustomField, type CustomValue } from "@/lib/custom-fields";
import { positionBetween } from "@/lib/order";
import EmptyState from "./EmptyState";
import { usePersistedViewState } from "@/lib/view-state-client";
import { useApiRefresh } from "@/lib/use-api-refresh";
import ListToolbar from "./list/ListToolbar";
import type { ListColumnOption } from "./list/ListOptionsDrawer";
import ListColumnHeader from "./list/ListColumnHeader";
import TaskListRow from "./list/TaskListRow";
import { useListSelection } from "@/lib/use-list-selection";
import { useColumnLayout } from "@/lib/use-column-layout";
import {
  listDateInRange,
  parseListDateFilter,
  parseListGroupBy,
  parseListSortKey,
  type ListDateFilter,
  type ListFilters,
  type ListGroupBy,
  type ListSortKey,
} from "@/lib/list-view";




export default function ListView({
  projectId,
  sections,
  tasks,
  users,
  customFields,
  customValues,
  savedViews,
  subtaskMap,
  activeSavedId,
  initial,
  projectStatusOptions,
  statusFieldName,
  statusFieldEnabled,
  activeTaskId,
  viewerId,
  viewName,
  viewIcon,
  viewTabId,
  canEdit,
}: {
  projectId: number;
  sections: Section[];
  tasks: TaskRow[];
  users: User[];
  customFields: CustomField[];
  customValues: Record<number, Record<number, CustomValue>>;
  savedViews: SavedView[];
  subtaskMap: Record<number, TaskRow[]>;
  activeSavedId: number | null;
  projectStatusOptions: string[];
  statusFieldName: string;
  statusFieldEnabled: boolean;
  activeTaskId: number | null;
  viewerId: number;
  viewName: string;
  viewIcon: string | null;
  viewTabId: number | null;
  canEdit: boolean;
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
    group?: string;
    group2?: string;
    groupdir?: "asc" | "desc";
    subtasks_collapsed?: boolean;
  };
}) {
  const refresh = useApiRefresh();
  const router = useRouter();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const onLive = useCallback(() => {
    router.refresh();
    setLastRefresh(new Date().toLocaleTimeString("ja-JP"));
  }, [router]);
  useLive(projectId, autoRefresh, onLive);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [addingSection, setAddingSection] = useState(false);
  const [sectionName, setSectionName] = useState("");
  const [addingField, setAddingField] = useState(false);
  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState<"number" | "text" | "select">("text");
  const [fieldOptions, setFieldOptions] = useState("");

  const { selected, setSelected, toggleSelect, selectRange, toggleAll, clear: clearSelection } =
    useListSelection();
  const [bulkSection, setBulkSection] = useState("");
  const [bulkAssignee, setBulkAssignee] = useState("");

  const bulk = async (op: string, extra?: Record<string, unknown>) => {
    if (selected.size === 0) return;
    const res = await fetch("/api/tasks/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected], op, ...extra }),
    });
    if (!res.ok) throw new Error(`bulk ${op}: ${res.status}`);
    clearSelection();
    refresh();
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!await confirmAction(`${selected.size}件のタスクを削除しますか？`)) return;
    await bulk("delete");
  };

  const addField = async () => {
    if (!fieldName.trim()) return;
    await api("/api/custom-fields", "POST", {
      project_id: projectId,
      name: fieldName,
      field_type: fieldType,
      options: fieldOptions,
    });
    setFieldName("");
    setFieldOptions("");
    setAddingField(false);
    refresh();
  };

  const removeField = async (f: CustomField) => {
    if (!await confirmAction(`項目「${f.name}」を削除しますか？（全タスクの値も消えます）`)) return;
    await api(`/api/custom-fields/${f.id}`, "DELETE");
    refresh();
  };
  const [hideCompleted, setHideCompleted] = useState(initial.hide_completed === true);
  const [completedOnly, setCompletedOnly] = useState(initial.completed_only === true);
  const [mineOnly, setMineOnly] = useState(initial.mine_only === true);
  const [groupBy, setGroupBy] = useState<ListGroupBy>(() =>
    parseListGroupBy(initial.group, statusFieldEnabled),
  );
  const [group2, setGroup2] = useState<ListGroupBy | null>(() => {
    if (!initial.group2) return null;
    return parseListGroupBy(initial.group2, statusFieldEnabled);
  });
  const [groupDir, setGroupDir] = useState<"asc" | "desc">(initial.groupdir === "desc" ? "desc" : "asc");
  const [groupSections, setGroupSections] = useState<Record<string, number | null>>({});
  const [assigneeFilter, setAssigneeFilter] = useState(initial.assignee ?? "");
  const [sortKey, setSortKey] = useState<ListSortKey>(() => parseListSortKey(initial.sort));
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initial.sortdir === "desc" ? "desc" : "asc");
  const [dueFilter, setDueFilter] = useState(initial.due ?? "");
  const [statusFilter, setStatusFilter] = useState(initial.status ?? "");
  const [startFilter, setStartFilter] = useState<ListDateFilter>(() => parseListDateFilter(initial.start));
  const [creatorFilter, setCreatorFilter] = useState(initial.creator ?? "");
  const [createdFilter, setCreatedFilter] = useState<ListDateFilter>(() => parseListDateFilter(initial.created));
  const [updatedFilter, setUpdatedFilter] = useState<ListDateFilter>(() => parseListDateFilter(initial.updated));
  const [completedDateFilter, setCompletedDateFilter] = useState<ListDateFilter>(() =>
    parseListDateFilter(initial.completed_on),
  );
  const [subtasksCollapsed, setSubtasksCollapsed] = useState(initial.subtasks_collapsed === true);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [menuCol, setMenuCol] = useState<string | null>(null);
  const [hiddenCols, setHiddenCols] = useState<Set<number>>(new Set());
  const [hiddenCore, setHiddenCore] = useState<Set<string>>(new Set());
  const [statusHidden, setStatusHidden] = useState(false);
  const [rowLimits, setRowLimits] = useState<Record<string, number>>({});
  const hiddenCoreKey = `atlas-listcols-${projectId}:h`;
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(hiddenCoreKey) ?? "[]");
        if (Array.isArray(saved)) {
          setHiddenCore(new Set(saved.filter((key): key is string => typeof key === "string")));
        }
      } catch {
        /* ignore malformed saved layout */
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hiddenCoreKey]);
  useEffect(() => {
    try {
      localStorage.setItem(hiddenCoreKey, JSON.stringify([...hiddenCore]));
    } catch {
      /* ignore */
    }
  }, [hiddenCore, hiddenCoreKey]);
  usePersistedViewState(projectId, "list", {
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
    group: groupBy,
    group2: group2 ?? "",
    groupdir: groupDir,
    subtasks_collapsed: subtasksCollapsed,
  });
  const [editingField, setEditingField] = useState<number | null>(null);
  const [editFieldName, setEditFieldName] = useState("");
  const [editFieldOptions, setEditFieldOptions] = useState("");
  const [customFilter, setCustomFilter] = useState<Record<number, string>>({});

  const pushState = (patch: {
    hide?: boolean;
    completed?: boolean;
    mine?: boolean;
    assignee?: string;
    status?: string;
    sort?: string;
    sortdir?: "asc" | "desc";
    due?: string;
    start?: string;
    creator?: string;
    created?: string;
    updated?: string;
    completed_on?: string;
    group?: string;
    group2?: string | null;
    groupdir?: "asc" | "desc";
    subtasks?: "collapsed" | "expanded";
  }) => {
    const q = new URLSearchParams(window.location.search);
    q.set("view", "list");
    q.delete("saved");
    const hide = patch.hide ?? hideCompleted;
    const completed = patch.completed ?? completedOnly;
    const mine = patch.mine ?? mineOnly;
    const asn = patch.assignee ?? assigneeFilter;
    const st = patch.status ?? statusFilter;
    const so = patch.sort ?? sortKey;
    const sd = patch.sortdir ?? sortDir;
    const du = patch.due ?? dueFilter;
    const start = patch.start ?? startFilter;
    const creator = patch.creator ?? creatorFilter;
    const created = patch.created ?? createdFilter;
    const updated = patch.updated ?? updatedFilter;
    const completedOn = patch.completed_on ?? completedDateFilter;
    const gr = patch.group ?? groupBy;
    const gr2 = patch.group2 !== undefined ? patch.group2 : group2;
    const grd = patch.groupdir ?? groupDir;
    const subtasks = patch.subtasks ?? (subtasksCollapsed ? "collapsed" : "expanded");
    if (hide) q.set("hide", "1");
    else q.delete("hide");
    if (completed) q.set("completed", "done");
    else q.delete("completed");
    if (mine) q.set("mine", "1");
    else q.delete("mine");
    if (asn !== "") q.set("assignee", asn);
    else q.delete("assignee");
    if (st !== "") q.set("status", st);
    else q.delete("status");
    if (so !== "position") {
      q.set("sort", so);
      if (sd === "desc") q.set("sortdir", "desc");
      else q.delete("sortdir");
    } else {
      q.delete("sort");
      q.delete("sortdir");
    }
    if (du !== "") q.set("due", du);
    else q.delete("due");
    if (start !== "") q.set("start", start);
    else q.delete("start");
    if (creator !== "") q.set("creator", creator);
    else q.delete("creator");
    if (created !== "") q.set("created", created);
    else q.delete("created");
    if (updated !== "") q.set("updated", updated);
    else q.delete("updated");
    if (completedOn !== "") q.set("completed_on", completedOn);
    else q.delete("completed_on");
    if (gr !== "section") q.set("group", gr);
    else q.delete("group");
    if (gr2 && gr2 !== gr && gr2 !== "section") q.set("group2", gr2);
    else if (gr2 === "section" && gr !== "section") q.set("group2", "section");
    else q.delete("group2");
    if (grd === "desc") q.set("groupdir", "desc");
    else q.delete("groupdir");
    if (subtasks === "collapsed") q.set("subtasks", "collapsed");
    else q.delete("subtasks");
    router.push(`/projects/${projectId}?${q.toString()}`);
  };
  const setFilter = (key: keyof ListFilters, value: string | boolean) => {
    if (key === "hide_completed") {
      const next = value === true;
      setHideCompleted(next);
      pushState({ hide: next });
    } else if (key === "completed_only") {
      const next = value === true;
      setCompletedOnly(next);
      pushState({ completed: next });
    } else if (key === "mine_only") {
      const next = value === true;
      setMineOnly(next);
      pushState({ mine: next });
    } else if (key === "assignee") {
      const next = String(value);
      setAssigneeFilter(next);
      pushState({ assignee: next });
    } else if (key === "status") {
      const next = String(value);
      setStatusFilter(next);
      pushState({ status: next });
    } else if (key === "due") {
      const next = String(value);
      setDueFilter(next);
      pushState({ due: next });
    } else if (key === "start") {
      const next = parseListDateFilter(value);
      setStartFilter(next);
      pushState({ start: next });
    } else if (key === "creator") {
      const next = String(value);
      setCreatorFilter(next);
      pushState({ creator: next });
    } else if (key === "created") {
      const next = parseListDateFilter(value);
      setCreatedFilter(next);
      pushState({ created: next });
    } else if (key === "updated") {
      const next = parseListDateFilter(value);
      setUpdatedFilter(next);
      pushState({ updated: next });
    } else if (key === "completed_on") {
      const next = parseListDateFilter(value);
      setCompletedDateFilter(next);
      pushState({ completed_on: next });
    }
  };
  const [addMenu, setAddMenu] = useState(false);
  const [addTemplates, setAddTemplates] = useState<TaskTemplate[]>([]);
  const toggleAddMenu = async () => {
    if (!addMenu) {
      const res = await fetch(`/api/task-templates?project_id=${projectId}`);
      if (res.ok) setAddTemplates(await res.json());
    }
    setAddMenu(!addMenu);
  };
  const instantiateTemplate = async (id: number) => {
    await api(`/api/task-templates/${id}`, "POST", {});
    setAddMenu(false);
    refresh();
  };
  const [saveName, setSaveName] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const dragging = useRef(false);
  const [dropHint, setDropHint] = useState<{ id: number; before: boolean } | null>(null);
  const hintRef = useRef<{ id: number; before: boolean } | null>(null);
  const setHint = (h: { id: number; before: boolean } | null) => {
    const p = hintRef.current;
    if ((p === null) !== (h === null) || (p && h && (p.id !== h.id || p.before !== h.before))) {
      hintRef.current = h;
      setDropHint(h);
    }
  };
  const openTask = (id: number) => {
    const q = new URLSearchParams(window.location.search);
    q.set("task", String(id));
    router.push(`/projects/${projectId}?${q.toString()}`);
  };
  const rowClick = (e: React.MouseEvent, id: number) => {
    if (dragging.current) return;
    if ((e.target as HTMLElement).closest("a,button,input,select,textarea,summary,[contenteditable]")) return;
    if (e.shiftKey && selectRange(visible.map((t) => t.id), id)) return;
    if (e.ctrlKey || e.metaKey) {
      toggleSelect(id);
      return;
    }
    openTask(id);
  };
  const focusAdd = () => {
    if (groupBy === "section" && sections[0]) setAddingTo(sections[0].id);
    else if (groupBy !== "section" && groupOrder[0]) setAddingTo(`g:${groupOrder[0][0]}`);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>("input[data-add-task]")?.focus());
  };
  const toggleExpand = (id: number) => {
    if (subtasksCollapsed) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("focus") === "add") {
      document.querySelector<HTMLInputElement>("input[data-add-task]")?.focus();
    }
  }, []);
  const [saving, setSaving] = useState(false);

  const today = todayISO();
  const todayMs = Date.parse(today);
  const dayOffset = (n: number) => new Date(todayMs + n * 86400000).toISOString().slice(0, 10);

  const distinctStatus = [...new Set(tasks.map((t) => t.status))].sort((a, b) => a.localeCompare(b, "ja"));
  const statusOptions = statusFieldEnabled
    ? projectStatusOptions.length > 0
      ? projectStatusOptions
      : distinctStatus
    : [];
  const shownFields = customFields.filter((f) => !hiddenCols.has(f.id));
  const baseKeys = [
    "assignee",
    "due",
    "progress",
    ...(statusFieldEnabled ? ["status"] : []),
    ...customFields.map((f) => `cf-${f.id}`),
  ];
  const {
    colDragging,
    colDropOver,
    setColDropOver,
    visibleCols,
    gridCols,
    compactCells,
    gripMouseDown,
    headerMouseDown,
    headerMouseUp,
    moveCol,
  } = useColumnLayout({
    projectId,
    baseKeys,
    hiddenCols,
    hiddenKeys: hiddenCore,
    statusHidden,
    onMenuClose: () => setMenuCol(null),
  });

  const collapseKey = `atlas-listcollapsed-${projectId}`;
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(collapseKey) ?? "[]");
        if (Array.isArray(saved)) setCollapsedGroups(new Set(saved.filter((k) => typeof k === "string")));
      } catch {
        /* ignore */
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [collapseKey]);
  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(collapseKey, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  const visible = tasks.filter(
    (t) =>
      (completedOnly ? t.completed : !hideCompleted || !t.completed) &&
      (!mineOnly || t.assignee_id === viewerId) &&
      (assigneeFilter === "" ||
        (assigneeFilter === "none" ? t.assignee_id === null : t.assignee_id === Number(assigneeFilter))) &&
      (!statusFieldEnabled || statusFilter === "" || t.status === statusFilter) &&
      (creatorFilter === "" ||
        (creatorFilter === "none" ? t.created_by === null : t.created_by === Number(creatorFilter))) &&
      listDateInRange(t.start_on, startFilter, today) &&
      listDateInRange(t.created_at, createdFilter, today) &&
      listDateInRange(t.updated_at, updatedFilter, today) &&
      listDateInRange(t.completed_at, completedDateFilter, today) &&
      (dueFilter === "" ||
        (t.due_on !== null &&
          (dueFilter === "overdue"
            ? t.due_on < today
            : dueFilter === "today"
              ? t.due_on === today
              : dueFilter === "week"
                ? t.due_on >= today && t.due_on <= dayOffset(6)
                : dueFilter === "nextweek"
                  ? t.due_on >= dayOffset(7) && t.due_on <= dayOffset(13)
                  : t.due_on >= today && t.due_on <= dayOffset(29)))) &&
      shownFields.every((f) => {
        const v = customFilter[f.id];
        if (!v) return true;
        return customValueToInput(f, customValues[t.id]?.[f.id]) === v;
      }),
  );

  const sorter = (a: TaskRow, b: TaskRow) => {
    const dir = sortDir === "asc" ? 1 : -1;
    const text = (av: string | null | undefined, bv: string | null | undefined) => {
      const left = av ?? "";
      const right = bv ?? "";
      return left.localeCompare(right, "ja") * dir;
    };
    const nullableText = (av: string | null | undefined, bv: string | null | undefined) => {
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return av.localeCompare(bv, "ja") * dir;
    };
    const date = (av: string | null | undefined, bv: string | null | undefined) => {
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return av.localeCompare(bv) * dir;
    };
    if (sortKey === "start") return date(a.start_on, b.start_on);
    if (sortKey === "due") return date(a.due_on, b.due_on);
    if (sortKey === "assignee") return nullableText(a.assignee_name, b.assignee_name);
    if (sortKey === "creator") return nullableText(a.creator_name, b.creator_name);
    if (sortKey === "created") return date(a.created_at, b.created_at);
    if (sortKey === "updated") return date(a.updated_at, b.updated_at);
    if (sortKey === "completed") return date(a.completed_at, b.completed_at);
    if (sortKey === "likes") return ((a.like_count ?? 0) - (b.like_count ?? 0)) * dir;
    if (sortKey === "name") return text(a.name, b.name);
    if (sortKey === "progress") return (a.progress - b.progress) * dir;
    if (sortKey === "status") return text(a.status, b.status);
    if (sortKey === "project") return nullableText(a.project_name, b.project_name);
    return a.position - b.position || a.id - b.id;
  };

  const bySection = new Map<number | null, TaskRow[]>();
  for (const t of visible) {
    const k = t.eff_section_id ?? t.section_id;
    if (!bySection.has(k)) bySection.set(k, []);
    bySection.get(k)!.push(t);
  }
  for (const list of bySection.values()) list.sort(sorter);

  const [subAdding, setSubAdding] = useState<number | null>(null);
  const [subDraft, setSubDraft] = useState("");

  const addSubtask = async (parent: TaskRow) => {
    const name = subDraft.trim();
    if (!name) return;
    await api("/api/tasks", "POST", {
      project_id: projectId,
      section_id: parent.eff_section_id ?? parent.section_id,
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
    setDrafts((d) => ({ ...d, [sectionId ?? -1]: "" }));
    refresh();
  };

  const toggle = async (t: TaskRow) => {
    try {
      await patchTask(t.id, { completed: !t.completed }, t.updated_at);
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

  const remove = async (t: TaskRow) => {
    if (!await confirmAction(`「${t.name}」を削除しますか？`)) return;
    await api(`/api/tasks/${t.id}`, "DELETE");
    refresh();
  };

  const [editing, setEditing] = useState<{ id: number; field: string } | null>(null);
  const [editVal, setEditVal] = useState("");
  const [editStart, setEditStart] = useState("");

  const openEdit = (e: React.MouseEvent, t: TaskRow, field: string, initial: string) => {
    e.stopPropagation();
    setEditing({ id: t.id, field });
    setEditVal(initial);
  };

  const patchFields = async (t: TaskRow, fields: Record<string, unknown>) => {
    try {
      await patchTask(t.id, fields, t.updated_at);
    } catch (error) {
      if (error instanceof TaskConflictError) {
        toastMessage("他のユーザーが先に更新しました。最新を表示します。");
      } else {
        toastMessage(`更新に失敗しました: ${error instanceof ApiError ? error.status : ""}`);
      }
    }
    setEditing(null);
    refresh();
  };

  const commitEdit = async (t: TaskRow, field: string, value: string) => {
    if (!editing || editing.id !== t.id || editing.field !== field) return;
    if (field === "assignee") {
      const v = value === "" ? null : Number(value);
      if (v !== t.assignee_id) await patchFields(t, { assignee_id: v });
      else {
        setEditing(null);
      }
    } else if (field === "due") {
      const v = value === "" ? null : value;
      if (v !== t.due_on) await patchFields(t, { due_on: v });
      else {
        setEditing(null);
      }
    } else if (field === "progress") {
      const v = Math.max(0, Math.min(100, Number(value)));
      if (!Number.isNaN(v) && v !== t.progress) await patchFields(t, { progress: v });
      else {
        setEditing(null);
      }
    } else if (field === "name") {
      const v = value.trim();
      if (v && v !== t.name) await patchFields(t, { name: v });
      else {
        setEditing(null);
      }
    } else if (field === "status") {
      const v = value.trim();
      if (v && v !== t.status) await patchFields(t, { status: v });
      else {
        setEditing(null);
      }
    } else if (field.startsWith("cf-")) {
      const fid = Number(field.slice(3));
      await api("/api/task-values", "POST", { task_id: t.id, field_id: fid, value });
      setEditing(null);
      refresh();
    }
  };

  const cancelEdit = () => setEditing(null);

  const openDueEdit = (e: React.MouseEvent, t: TaskRow) => {
    e.stopPropagation();
    setEditing({ id: t.id, field: "due" });
    setEditStart(t.start_on ?? "");
    setEditVal(t.due_on ?? "");
  };

  const commitDueEdit = async (t: TaskRow, cleared = false) => {
    if (!editing || editing.id !== t.id || editing.field !== "due") return;
    const s = cleared ? "" : editStart;
    let d = cleared ? "" : editVal;
    if (s && d && s > d) {
      d = s;
      setEditVal(s);
    }
    const ns = s === "" ? null : s;
    const nd = d === "" ? null : d;
    if (ns !== t.start_on || nd !== t.due_on) await patchFields(t, { start_on: ns, due_on: nd });
    else setEditing(null);
  };

  const customRaw = (taskId: number, f: CustomField) =>
    customValueToInput(f, customValues[taskId]?.[f.id]);

  const editInputCls =
    "w-full min-w-0 rounded border border-blue-500 bg-white px-1 py-0.5 text-[13px] text-neutral-800 outline-none";

  const saveView = async () => {
    if (!saveName.trim()) return;
    const res = await api<{ id: number }>("/api/saved-views", "POST", {
      project_id: projectId,
      name: saveName,
      filters: {
        ...filters,
        group2: group2 ?? "",
        groupdir: groupDir,
        subtasks_collapsed: subtasksCollapsed,
      },
      sort_key: sortKey,
      group_by: groupBy,
    });
    router.push(`/projects/${projectId}?view=list&saved=${res.id}`);
  };

  const deleteSavedView = async (id: number) => {
    if (!await confirmAction("保存ビューを削除しますか？")) return;
    await api(`/api/saved-views/${id}`, "DELETE");
    router.push(`/projects/${projectId}?view=list`);
  };

  const cycleSort = (key: "name" | "due" | "progress") => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
      pushState({ sort: key, sortdir: "asc" });
    } else if (sortDir === "asc") {
      setSortDir("desc");
      pushState({ sort: key, sortdir: "desc" });
    } else {
      setSortKey("position");
      setSortDir("asc");
      pushState({ sort: "position" });
    }
  };
  const applySort = (key: "name" | "due" | "progress", dir: "asc" | "desc") => {
    setSortKey(key);
    setSortDir(dir);
    pushState({ sort: key, sortdir: dir });
  };
  const clearSort = () => {
    setSortKey("position");
    setSortDir("asc");
    pushState({ sort: "position" });
  };
  const sortMark = (key: "name" | "due" | "progress") =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const applySortKey = (key: Exclude<ListSortKey, "position">) => {
    if (sortKey === key) {
      const next = sortDir === "asc" ? "desc" : "asc";
      setSortDir(next);
      pushState({ sort: key, sortdir: next });
    } else {
      setSortKey(key);
      setSortDir("asc");
      pushState({ sort: key, sortdir: "asc" });
    }
  };
  const toggleSortDir = () => {
    const next = sortDir === "asc" ? "desc" : "asc";
    setSortDir(next);
    pushState({ sort: sortKey, sortdir: next });
  };
  const applyGroupBy = (key: ListGroupBy) => {
    const nextSecondary = group2 === key ? null : group2;
    setGroupBy(key);
    setGroup2(nextSecondary);
    pushState({ group: key, group2: nextSecondary });
  };
  const applyGroup2 = (key: ListGroupBy | null) => {
    if (key !== null && key === groupBy) return;
    setGroup2(key);
    pushState({ group2: key });
  };
  const clearGroup2 = () => {
    setGroup2(null);
    pushState({ group2: null });
  };
  const applyGroupDir = (dir: "asc" | "desc") => {
    setGroupDir(dir);
    pushState({ groupdir: dir });
  };
  const clearGroup = () => {
    setGroupBy("section");
    setGroup2(null);
    setGroupDir("asc");
    pushState({ group: "section", group2: null, groupdir: "asc" });
  };
  const changeSubtasksCollapsed = (collapsed: boolean) => {
    setSubtasksCollapsed(collapsed);
    if (collapsed) setExpanded(new Set());
    pushState({ subtasks: collapsed ? "collapsed" : "expanded" });
  };

  const applyDueFilter = (v: string) => {
    setDueFilter(v);
    pushState({ due: v });
  };
  const applyAssigneeFilter = (v: string) => {
    setAssigneeFilter(v);
    pushState({ assignee: v });
  };
  const applyStatusFilter = (v: string) => {
    setStatusFilter(v);
    pushState({ status: v });
  };

  const activeFilterCount =
    (hideCompleted ? 1 : 0) +
    (completedOnly ? 1 : 0) +
    (mineOnly ? 1 : 0) +
    (assigneeFilter !== "" ? 1 : 0) +
    (dueFilter !== "" ? 1 : 0) +
    (startFilter !== "" ? 1 : 0) +
    (creatorFilter !== "" ? 1 : 0) +
    (createdFilter !== "" ? 1 : 0) +
    (updatedFilter !== "" ? 1 : 0) +
    (completedDateFilter !== "" ? 1 : 0) +
    (statusFieldEnabled && statusFilter !== "" ? 1 : 0);
  const sortActive = sortKey !== "position";

  const clearFilters = () => {
    setHideCompleted(false);
    setCompletedOnly(false);
    setMineOnly(false);
    setAssigneeFilter("");
    setDueFilter("");
    setStatusFilter("");
    setStartFilter("");
    setCreatorFilter("");
    setCreatedFilter("");
    setUpdatedFilter("");
    setCompletedDateFilter("");
    const current = new URLSearchParams(window.location.search);
    const q = new URLSearchParams({ view: "list" });
    const tab = current.get("tab");
    if (tab) q.set("tab", tab);
    if (sortActive) {
      q.set("sort", sortKey);
      if (sortDir === "desc") q.set("sortdir", "desc");
    }
    if (groupBy !== "section") q.set("group", groupBy);
    router.push(`/projects/${projectId}?${q.toString()}`);
    setFilterOpen(false);
  };
  const clearAllSort = () => {
    clearSort();
    setSortOpen(false);
  };
  const openFilterMenu = () => {
    setSortOpen(false);
    setGroupOpen(false);
    setOptionsOpen(false);
    setFilterOpen((v) => !v);
  };
  const openSortMenu = () => {
    setFilterOpen(false);
    setGroupOpen(false);
    setOptionsOpen(false);
    setSortOpen((v) => !v);
  };
  const openGroupMenu = () => {
    setFilterOpen(false);
    setSortOpen(false);
    setOptionsOpen(false);
    setGroupOpen((v) => !v);
  };

  const renameView = async (name: string) => {
    if (!canEdit || viewTabId === null) return;
    try {
      await api(`/api/project-tabs/${viewTabId}`, "PATCH", { name });
      toastMessage("ビュー名を変更しました");
      router.refresh();
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : "ビュー名を変更できませんでした");
    }
  };
  const updateViewIcon = async (icon: string | null) => {
    if (!canEdit || viewTabId === null) return;
    try {
      await api(`/api/project-tabs/${viewTabId}`, "PATCH", { icon });
      toastMessage("ビューのアイコンを変更しました");
      router.refresh();
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : "アイコンを変更できませんでした");
    }
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

  const columnOptions: ListColumnOption[] = [
    { key: "assignee", label: "担当者", visible: !hiddenCore.has("assignee") },
    { key: "due", label: "期日", visible: !hiddenCore.has("due") },
    { key: "progress", label: "進捗", visible: !hiddenCore.has("progress") },
    ...(statusFieldEnabled
      ? [{ key: "status", label: statusFieldName, visible: !statusHidden }]
      : []),
    ...customFields.map((field) => ({
      key: `cf-${field.id}`,
      label: field.name,
      visible: !hiddenCols.has(field.id),
    })),
  ];

  const toggleColumn = (key: string) => {
    if (key === "status") {
      setStatusHidden((value) => !value);
    } else if (key.startsWith("cf-")) {
      const id = Number(key.slice(3));
      setHiddenCols((previous) => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setHiddenCore((previous) => {
        const next = new Set(previous);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    }
  };

  const startEditField = (f: CustomField) => {
    setEditingField(f.id);
    setEditFieldName(f.name);
    setEditFieldOptions(Array.isArray(f.options) ? f.options.join(",") : "");
  };
  const saveFieldEdit = async () => {
    if (editingField === null) return;
    const body: Record<string, unknown> = { name: editFieldName.trim() };
    if (editFieldOptions.trim() !== "") {
      body.options = editFieldOptions.split(",").map((s) => s.trim()).filter((s) => s !== "");
    }
    await api(`/api/custom-fields/${editingField}`, "PATCH", body);
    setEditingField(null);
    setMenuCol(null);
    refresh();
  };

  const headerCellFor = (key: string) => {
    if (key === "assignee") return headerCell(key, "担当者");
    if (key === "due") return headerCell(key, "期日");
    if (key === "progress") return headerCell(key, "進捗");
    if (key === "status") return headerCell(key, statusFieldName);
    const f = customFields.find((x) => `cf-${x.id}` === key);
    return f ? headerCell(key, f.name, f) : null;
  };

  const openFieldAdd = () => {
    setAddingField(true);
    requestAnimationFrame(() =>
      document.getElementById("custom-field-add")?.scrollIntoView({ block: "nearest" }),
    );
  };

  const headerCell = (key: string, label: string, field?: CustomField) => (
    <ListColumnHeader
      key={key}
      columnKey={key}
      label={label}
      field={field}
      menuCol={menuCol}
      setMenuCol={setMenuCol}
      colDropOver={colDropOver}
      colDragging={colDragging}
      setColDropOver={setColDropOver}
      headerMouseDown={headerMouseDown}
      headerMouseUp={headerMouseUp}
      gripMouseDown={gripMouseDown}
      visibleCols={visibleCols}
      moveCol={moveCol}
      cycleSort={cycleSort}
      sortMark={sortMark}
      applySort={applySort}
      clearSort={clearSort}
      applyAssigneeFilter={applyAssigneeFilter}
      assigneeFilter={assigneeFilter}
      users={users}
      applyDueFilter={applyDueFilter}
      dueFilter={dueFilter}
      statusFieldEnabled={statusFieldEnabled}
      statusOptions={statusOptions}
      statusFilter={statusFilter}
      applyStatusFilter={applyStatusFilter}
      statusFieldName={statusFieldName}
      setStatusHidden={setStatusHidden}
      customFilter={customFilter}
      setCustomFilter={setCustomFilter}
      editingField={editingField}
      setEditingField={setEditingField}
      editFieldName={editFieldName}
      setEditFieldName={setEditFieldName}
      editFieldOptions={editFieldOptions}
      setEditFieldOptions={setEditFieldOptions}
      saveFieldEdit={saveFieldEdit}
      startEditField={startEditField}
      setHiddenCols={setHiddenCols}
      removeField={removeField}
    />
  );

  const groupKeyFor = (t: TaskRow, key: ListGroupBy) => {
    if (key === "assignee") return t.assignee_name ?? "（未割当）";
    if (key === "creator") return t.creator_name ?? "（作成者なし）";
    if (key === "status") return t.status || "（未設定）";
    if (key === "due") return t.due_on ?? "（期日なし）";
    if (key === "start") return t.start_on ?? "（開始日なし）";
    if (key === "created") return t.created_at.slice(0, 10);
    if (key === "updated") return t.updated_at.slice(0, 10);
    if (key === "completed") {
      if (!t.completed) return "（未完了）";
      return t.completed_at?.slice(0, 10) ?? "（完了日なし）";
    }
    if (key === "project") return t.project_name ?? "（プロジェクトなし）";
    if (key.startsWith("cf-")) {
      const field = customFields.find((item) => `cf-${item.id}` === key);
      if (!field) return "（未設定）";
      const value = customValueToInput(field, customValues[t.id]?.[field.id]);
      return value === "" ? "（未設定）" : value;
    }
    return "";
  };
  const groupKeyOf = (t: TaskRow) => groupKeyFor(t, groupBy);

  const sortGroupEntries = (entries: [string, TaskRow[]][]) =>
    entries.sort(([a], [b]) => {
      if (a.startsWith("（") && !b.startsWith("（")) return 1;
      if (!a.startsWith("（") && b.startsWith("（")) return -1;
      return a.localeCompare(b, "ja") * (groupDir === "asc" ? 1 : -1);
    });

  const splitGroups = (items: TaskRow[], key: ListGroupBy) => {
    const map = new Map<string, TaskRow[]>();
    for (const t of items) {
      const groupKey = groupKeyFor(t, key);
      if (!map.has(groupKey)) map.set(groupKey, []);
      map.get(groupKey)!.push(t);
    }
    for (const list of map.values()) list.sort(sorter);
    return sortGroupEntries([...map.entries()]);
  };

  const grouped = new Map<string, TaskRow[]>();
  if (groupBy !== "section") {
    for (const t of visible) {
      const k = groupKeyOf(t);
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k)!.push(t);
    }
    for (const list of grouped.values()) list.sort(sorter);
  }
  const groupOrder = sortGroupEntries([...grouped.entries()]);

  const addTaskGrouped = async (gkey: string) => {
    const name = (drafts[gkey] ?? "").trim();
    if (!name) return;
    const sectionId = groupSections[gkey] ?? sections[0]?.id ?? null;
    await api("/api/tasks", "POST", { project_id: projectId, section_id: sectionId, name });
    setDrafts((d) => ({ ...d, [gkey]: "" }));
    refresh();
  };


  const [addingTo, setAddingTo] = useState<number | string | null>(null);

  const appendToSection = async (dragId: number, sectionId: number | null) => {
    const dragged = tasks.find((x) => x.id === dragId);
    if (!dragged) return;
    const col = visible
      .filter((x) => (x.eff_section_id ?? x.section_id) === sectionId && x.id !== dragId)
      .sort((a, b) => a.position - b.position || a.id - b.id);
    const maxPos = col.reduce((mm, x) => Math.max(mm, x.position), 0);
    const fields: Record<string, unknown> = { position: maxPos + 1000 };
    if ((dragged.eff_section_id ?? dragged.section_id) !== sectionId) {
      fields.section_id = sectionId;
    }
    try {
      await patchTask(dragId, fields, dragged.updated_at);
    } catch (error) {
      if (error instanceof TaskConflictError) {
        toastMessage("他のユーザーが先に更新しました。最新を表示します。");
      } else {
        toastMessage(`移動に失敗しました: ${error instanceof ApiError ? error.status : ""}`);
      }
    }
    refresh();
  };

  const moveTask = async (dragId: number, target: TaskRow, before: boolean) => {
    if (dragId === target.id) return;
    const dragged = tasks.find((x) => x.id === dragId);
    if (!dragged) return;
    const sectionKey = target.eff_section_id ?? target.section_id;
    const column = visible
      .filter((x) => (x.eff_section_id ?? x.section_id) === sectionKey && x.id !== dragId)
      .sort((a, b) => a.position - b.position || a.id - b.id);
    const idx = column.findIndex((x) => x.id === target.id);
    const at = before ? idx : idx + 1;
    const prev = at - 1 >= 0 ? column[at - 1].position : null;
    const next = at < column.length ? column[at].position : null;
    const fields: Record<string, unknown> = { position: positionBetween(prev, next) };
    if ((dragged.eff_section_id ?? dragged.section_id) !== sectionKey) {
      fields.section_id = sectionKey;
    }
    try {
      await patchTask(dragId, fields, dragged.updated_at);
    } catch (error) {
      if (error instanceof TaskConflictError) {
        toastMessage("他のユーザーが先に更新しました。最新を表示します。");
      } else {
        toastMessage(`移動に失敗しました: ${error instanceof ApiError ? error.status : ""}`);
      }
    }
    refresh();
  };

  const rowLimitFor = (key: string) => rowLimits[key] ?? 100;
  const showMoreRows = (key: string, total: number, shown: number) =>
    total > shown ? (
      <button
        type="button"
        data-list-show-more={key}
        onClick={() => setRowLimits((current) => ({ ...current, [key]: (current[key] ?? 100) + 200 }))}
        className="mx-2 my-1 rounded-md border border-[#e1e1e1] bg-white px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"
      >
        さらに表示（{shown} / {total} 件）
      </button>
    ) : null;

  const beginRowDrag = () => {
    dragging.current = true;
  };
  const endRowDrag = () => {
    setTimeout(() => {
      dragging.current = false;
    }, 0);
  };
  const rowCtx = {
    today,
    compactCells,
    activeTaskId,
    dropHint,
    setHint,
    beginRowDrag,
    endRowDrag,
    rowClick,
    moveTask,
    subtaskMap,
    expanded,
    toggleExpand,
    toggle,
    editing,
    setEditing,
    editVal,
    setEditVal,
    editStart,
    setEditStart,
    openEdit,
    commitEdit,
    cancelEdit,
    openDueEdit,
    commitDueEdit,
    editInputCls,
    users,
    visibleCols,
    statusFieldEnabled,
    statusHidden,
    statusOptions,
    shownFields,
    customRaw,
    customValues,
    subAdding,
    setSubAdding,
    subDraft,
    setSubDraft,
    addSubtask,
    remove,
    gridCols,
    openTask,
  };

  const groupHeader = (key: string, name: string, count: number, depth = 0) => {
    const collapsed = collapsedGroups.has(key);
    return (
      <div
        data-list-section-header={key}
        data-list-section-depth={depth}
        className={`flex h-[37px] items-center gap-2 ${depth > 0 ? "pl-10" : "pl-6"}`}
      >
        <button
          onClick={() => toggleGroup(key)}
          title={collapsed ? "展開する" : "折りたたむ"}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
        >
          <svg
            viewBox="0 0 12 12"
            className={`h-3 w-3 transition-transform ${collapsed ? "-rotate-90" : ""}`}
            fill="currentColor"
          >
            <path d="M2.2 4.2h7.6L6 9.2z" />
          </svg>
        </button>
        <span className="text-[14px] leading-6 font-semibold text-neutral-900">{name}</span>
        {groupBy !== "section" || group2 !== null ? (
          <span data-list-section-count={count} className="text-[13px] font-normal text-neutral-500">{count}</span>
        ) : null}
      </div>
    );
  };

  const renderGroupedItems = (items: TaskRow[], baseKey: string) => {
    if (group2 !== null) {
      return splitGroups(items, group2).map(([subKey, subItems]) => {
        const key = `${baseKey}|g:${subKey}`;
        const collapsed = collapsedGroups.has(key);
        return (
          <div key={subKey} data-list-subgroup={subKey}>
            {groupHeader(key, subKey, subItems.length, 1)}
            {!collapsed && subItems.map((t) => <TaskListRow key={t.id} task={t} ctx={rowCtx} />)}
          </div>
        );
      });
    }
    return items.map((t) => <TaskListRow key={t.id} task={t} ctx={rowCtx} />);
  };

  const ghostRow = (onClick: () => void) => (
    <div
      className="grid items-center divide-x divide-[#eaeaea] border-b border-[#eaeaea] px-2 text-sm"
      style={{ gridTemplateColumns: gridCols }}
    >
      <span />
      <div className="min-w-0">
        <button
          onClick={onClick}
          data-add-task-open
          className="flex h-9 w-full items-center rounded pr-2 pl-12 text-left text-[13px] whitespace-nowrap text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700"
        >
          タスクを追加
        </button>
      </div>
      {visibleCols.map((k) => (
        <span key={k} />
      ))}
      <span />
    </div>
  );

  const addRow = (input: ReactNode) => (
    <div
      className="grid items-center divide-x divide-[#eaeaea] border-b border-[#eaeaea] px-2 py-1.5 text-sm"
      style={{ gridTemplateColumns: gridCols }}
    >
      <span />
      <div className="flex min-w-0 items-center gap-1 pl-12">{input}</div>
      {visibleCols.map((k) => (
        <span key={k} />
      ))}
      <span />
    </div>
  );

  return (
    <div
      className="px-4 pb-16"
      data-list-view
      data-list-hide-completed={hideCompleted}
      data-list-completed-only={completedOnly}
      data-list-mine-only={mineOnly}
      data-list-sort={sortKey}
      data-list-sortdir={sortDir}
      data-list-group={groupBy}
      data-list-group2={group2 ?? ""}
      data-list-groupdir={groupDir}
      data-list-subtasks-collapsed={subtasksCollapsed}
      data-list-assignee={assigneeFilter}
      data-list-status={statusFilter}
      data-list-due={dueFilter}
      data-list-start={startFilter}
      data-list-creator={creatorFilter}
      data-list-created={createdFilter}
      data-list-updated={updatedFilter}
      data-list-completed-on={completedDateFilter}
    >
      <div className="overflow-x-auto">
      <div className="min-w-[860px]">
      <ListToolbar
        projectId={projectId}
        sections={sections}
        users={users}
        statusFieldEnabled={statusFieldEnabled}
        statusFieldName={statusFieldName}
        statusOptions={statusOptions}
        customFields={customFields}
        focusAdd={focusAdd}
        toggleAddMenu={toggleAddMenu}
        addMenu={addMenu}
        addTemplates={addTemplates}
        instantiateTemplate={instantiateTemplate}
        activeFilterCount={activeFilterCount}
        openFilterMenu={openFilterMenu}
        clearFilters={clearFilters}
        filterOpen={filterOpen}
        setFilterOpen={setFilterOpen}
        filters={filters}
        onFilterChange={setFilter}
        sortOpen={sortOpen}
        setSortOpen={setSortOpen}
        openSortMenu={openSortMenu}
        clearAllSort={clearAllSort}
        sortKey={sortKey}
        sortDir={sortDir}
        applySortKey={applySortKey}
        toggleSortDir={toggleSortDir}
        groupOpen={groupOpen}
        setGroupOpen={setGroupOpen}
        openGroupMenu={openGroupMenu}
        groupBy={groupBy}
        group2={group2}
        groupDir={groupDir}
        applyGroupBy={applyGroupBy}
        applyGroup2={applyGroup2}
        clearGroup2={clearGroup2}
        applyGroupDir={applyGroupDir}
        clearGroup={clearGroup}
        saving={saving}
        setSaving={setSaving}
        saveName={saveName}
        setSaveName={setSaveName}
        saveView={saveView}
        autoRefresh={autoRefresh}
        setAutoRefresh={setAutoRefresh}
        lastRefresh={lastRefresh}
        optionsOpen={optionsOpen}
        setOptionsOpen={setOptionsOpen}
        viewName={viewName}
        viewIcon={viewIcon}
        viewTabId={viewTabId}
        canEdit={canEdit}
        renameView={renameView}
        updateViewIcon={updateViewIcon}
        subtasksCollapsed={subtasksCollapsed}
        toggleSubtasksCollapsed={changeSubtasksCollapsed}
        columns={columnOptions}
        onToggleColumn={toggleColumn}
        openFieldAdd={openFieldAdd}
      />
      {savedViews.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b py-1.5 text-sm">
          {savedViews.map((v) => (
            <span
              key={v.id}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 ${
                v.id === activeSavedId ? "border-blue-600 bg-blue-50 text-blue-700" : "text-neutral-600"
              }`}
            >
              <a href={`/projects/${projectId}?view=list&saved=${v.id}`}>{v.name}</a>
              <button
                onClick={() => deleteSavedView(v.id)}
                title="保存ビューを削除"
                className="text-neutral-300 hover:text-red-600"
              >
                ×
              </button>
            </span>
          ))}
          {activeSavedId !== null && (
            <a href={`/projects/${projectId}?view=list`} className="text-neutral-500 hover:text-black">
              クリア ×
            </a>
          )}
        </div>
      )}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-blue-50 px-2 py-1.5 text-sm">
          <span className="font-semibold">{selected.size}件選択中</span>
          <button onClick={() => bulk("complete")} className="rounded border bg-white px-2 py-0.5 hover:bg-neutral-100">
            完了にする
          </button>
          <button onClick={() => bulk("reopen")} className="rounded border bg-white px-2 py-0.5 hover:bg-neutral-100">
            未完了に戻す
          </button>
          <select
            value={bulkSection}
            onChange={(e) => setBulkSection(e.target.value)}
            className="rounded border px-1 py-0.5"
            title="移動先セクション"
          >
            <option value="">セクション移動…</option>
            {sections.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => bulkSection && bulk("move", { section_id: Number(bulkSection) })}
            className="rounded border bg-white px-2 py-0.5 hover:bg-neutral-100"
          >
            移動
          </button>
          <select
            value={bulkAssignee}
            onChange={(e) => setBulkAssignee(e.target.value)}
            className="rounded border px-1 py-0.5"
            title="担当者変更"
          >
            <option value="">担当者…</option>
            <option value="none">未割当</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <button
            onClick={() =>
              bulkAssignee && bulk("assign", { assignee_id: bulkAssignee === "none" ? null : Number(bulkAssignee) })
            }
            className="rounded border bg-white px-2 py-0.5 hover:bg-neutral-100"
          >
            割当
          </button>
          <button onClick={bulkDelete} className="rounded border border-red-300 bg-white px-2 py-0.5 text-red-600 hover:bg-red-50">
            削除
          </button>
          <button onClick={() => setSelected(new Set())} className="text-neutral-500 hover:text-black">
            解除
          </button>
        </div>
      )}
      {menuCol !== null && (
        <div className="fixed inset-0 z-30" onClick={() => setMenuCol(null)} />
      )}
      {editing?.field === "due" && (
        <div className="fixed inset-0 z-30" onClick={cancelEdit} />
      )}
      {tasks.length === 0 && (
        <EmptyState
          scope="list"
          title="タスクがありません"
          description="最初のタスクを追加して、このプロジェクトを進めましょう。"
          action={
            <button
              type="button"
              onClick={focusAdd}
              className="h-8 rounded-md bg-[#2c60b8] px-4 text-[13px] font-medium text-white hover:bg-[#24529c]"
            >
              ＋ タスクを追加
            </button>
          }
        />
      )}
      <div
        className={`grid h-[37px] items-center divide-x divide-[#eaeaea] border-b border-[#eaeaea] px-2 text-xs font-normal text-neutral-500 ${compactCells}`}
        style={{ gridTemplateColumns: gridCols }}
      >
        <input
          type="checkbox"
          title="すべて選択/解除"
          checked={visible.length > 0 && visible.every((t) => selected.has(t.id))}
          onChange={() => {
            toggleAll(visible.map((t) => t.id));
          }}
        />
        {headerCell("name", "名前")}
        {visibleCols.map((k) => (
          <Fragment key={k}>{headerCellFor(k)}</Fragment>
        ))}
        <button
          style={{ order: 999 }}
          onClick={openFieldAdd}
          title="フィールド（カスタム項目）を追加"
          className="justify-self-end rounded px-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
        >
          ＋
        </button>
      </div>
      {((statusFieldEnabled && statusHidden) ||
        hiddenCore.has("assignee") ||
        hiddenCore.has("due") ||
        hiddenCore.has("progress") ||
        customFields.some((f) => hiddenCols.has(f.id))) && (
        <div className="flex items-center gap-1 py-1 text-[11px] font-normal text-neutral-500">
          非表示:
          {(["assignee", "due", "progress"] as const)
            .filter((key) => hiddenCore.has(key))
            .map((key) => (
              <button
                key={key}
                onClick={() =>
                  setHiddenCore((prev) => {
                    const next = new Set(prev);
                    next.delete(key);
                    return next;
                  })
                }
                title={`${key === "assignee" ? "担当者" : key === "due" ? "期日" : "進捗"}列を再表示`}
                className="rounded-full border px-2 py-0.5 hover:bg-neutral-100 hover:text-neutral-600"
              >
                {key === "assignee" ? "担当者" : key === "due" ? "期日" : "進捗"}を再表示
              </button>
            ))}
          {statusFieldEnabled && statusHidden && (
            <button
              onClick={() => setStatusHidden(false)}
              title={`${statusFieldName}列を再表示`}
              className="rounded-full border px-2 py-0.5 hover:bg-neutral-100 hover:text-neutral-600"
            >
              {statusFieldName}を再表示
            </button>
          )}
          {customFields
            .filter((f) => hiddenCols.has(f.id))
            .map((f) => (
              <button
                key={f.id}
                onClick={() =>
                  setHiddenCols((prev) => {
                    const next = new Set(prev);
                    next.delete(f.id);
                    return next;
                  })
                }
                title={`${f.name}列を再表示`}
                className="rounded-full border px-2 py-0.5 hover:bg-neutral-100 hover:text-neutral-600"
              >
                {f.name}を再表示
              </button>
            ))}
        </div>
      )}
      {groupBy !== "section"
        ? groupOrder.map(([gkey, items]) => {
            const gk = `g:${gkey}`;
            const collapsed = collapsedGroups.has(gk);
            const shownItems = items.slice(0, rowLimitFor(gk));
            return (
              <div key={gkey}>
                {groupHeader(gk, gkey, items.length)}
                {!collapsed && (
                  <>
                    {renderGroupedItems(shownItems, gk)}
                    {showMoreRows(gk, items.length, shownItems.length)}
                    {addingTo === gk
                      ? addRow(
                          <>
                            <input
                              value={drafts[gkey] ?? ""}
                              onChange={(e) => setDrafts((d) => ({ ...d, [gkey]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  addTaskGrouped(gkey);
                                  setAddingTo(null);
                                }
                                if (e.key === "Escape") setAddingTo(null);
                              }}
                              onBlur={() => {
                                if ((drafts[gkey] ?? "").trim() === "") setAddingTo(null);
                              }}
                              placeholder="タスク名を入力"
                              data-add-task
                              autoFocus
                              className="w-full max-w-md rounded border px-2 py-1 text-sm outline-none focus:border-blue-500"
                            />
                            <select
                              value={groupSections[gkey] ?? sections[0]?.id ?? ""}
                              onChange={(e) =>
                                setGroupSections((g) => ({ ...g, [gkey]: e.target.value === "" ? null : Number(e.target.value) }))
                              }
                              className="rounded border px-1 py-1 text-sm"
                              title="追加先セクション"
                            >
                              {sections.map((sc) => (
                                <option key={sc.id} value={sc.id}>
                                  {sc.name}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => {
                                addTaskGrouped(gkey);
                                setAddingTo(null);
                              }}
                              className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
                            >
                              追加
                            </button>
                          </>,
                        )
                      : ghostRow(() => setAddingTo(gk))}
                  </>
                )}
              </div>
            );
          })
        : sections.map((s) => {
            const key = `s:${s.id}`;
            const collapsed = collapsedGroups.has(key);
            const items = bySection.get(s.id) ?? [];
            const shownItems = items.slice(0, rowLimitFor(key));
            return (
              <div
                key={s.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const dragId = Number(e.dataTransfer.getData("text/atlas-task"));
                  if (dragId) appendToSection(dragId, s.id);
                }}
              >
                {groupHeader(key, s.name, items.length)}
                {!collapsed && (
                  <>
                    {renderGroupedItems(shownItems, key)}
                    {showMoreRows(key, items.length, shownItems.length)}
                    {addingTo === s.id
                      ? addRow(
                          <>
                            <input
                              value={drafts[s.id] ?? ""}
                              onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  addTask(s.id);
                                  setAddingTo(null);
                                }
                                if (e.key === "Escape") setAddingTo(null);
                              }}
                              onBlur={() => {
                                if ((drafts[s.id] ?? "").trim() === "") setAddingTo(null);
                              }}
                              placeholder="タスク名を入力"
                              data-add-task
                              autoFocus
                              className="w-full max-w-md rounded border px-2 py-1 text-sm outline-none focus:border-blue-500"
                            />
                            <button
                              onClick={() => {
                                addTask(s.id);
                                setAddingTo(null);
                              }}
                              className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
                            >
                              追加
                            </button>
                          </>,
                        )
                      : ghostRow(() => setAddingTo(s.id))}
                  </>
                )}
              </div>
            );
          })}
      {(bySection.get(null) ?? []).length > 0 && (
        <div>
          <div className="flex h-[37px] items-center pl-[56px] text-[14px] font-semibold text-neutral-500">（セクションなし）</div>
          {(() => {
            const loose = bySection.get(null) ?? [];
            const shown = loose.slice(0, rowLimitFor("none"));
            return (
              <>
                {shown.map((t) => (
                  <TaskListRow key={t.id} task={t} ctx={rowCtx} />
                ))}
                {showMoreRows("none", loose.length, shown.length)}
              </>
            );
          })()}
        </div>
      )}
      <div className="pt-4" id="custom-field-add">
        {addingSection ? (
          <div className="flex gap-2">
            <input
              value={sectionName}
              onChange={(e) => setSectionName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && api("/api/sections", "POST", { project_id: projectId, name: sectionName }).then(() => { setSectionName(""); setAddingSection(false); refresh(); })}
              placeholder="セクション名"
              autoFocus
              className="rounded border px-2 py-1 text-sm outline-none focus:border-blue-500"
            />
            <button
              onClick={() => api("/api/sections", "POST", { project_id: projectId, name: sectionName }).then(() => { setSectionName(""); setAddingSection(false); refresh(); })}
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
            >
              追加
            </button>
            <button onClick={() => setAddingSection(false)} className="px-2 text-sm text-neutral-500">
              キャンセル
            </button>
          </div>
        ) : (
          <button onClick={() => setAddingSection(true)} className="text-sm text-neutral-500 hover:text-neutral-800">
            ＋ セクションを追加
          </button>
        )}
        <span className="mx-2 text-neutral-500">|</span>
        {addingField ? (
          <span className="inline-flex items-center gap-1">
            <input
              value={fieldName}
              onChange={(e) => setFieldName(e.target.value)}
              placeholder="項目名"
              autoFocus
              className="w-28 rounded border px-2 py-1 text-sm outline-none focus:border-blue-500"
            />
            <select
              value={fieldType}
              onChange={(e) => setFieldType(e.target.value as typeof fieldType)}
              className="rounded border px-1 py-1 text-sm"
            >
              <option value="text">テキスト</option>
              <option value="number">数値</option>
              <option value="select">選択肢</option>
            </select>
            {fieldType === "select" && (
              <input
                value={fieldOptions}
                onChange={(e) => setFieldOptions(e.target.value)}
                placeholder="選択肢（カンマ区切り）"
                className="w-40 rounded border px-2 py-1 text-sm outline-none focus:border-blue-500"
              />
            )}
            <button
              onClick={addField}
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
            >
              追加
            </button>
            <button onClick={() => setAddingField(false)} className="px-1 text-sm text-neutral-500">
              キャンセル
            </button>
          </span>
        ) : (
          <button onClick={() => setAddingField(true)} className="text-sm text-neutral-500 hover:text-neutral-800">
            ＋ カスタム項目
          </button>
        )}
      </div>
      </div>
      </div>
    </div>
  );
}