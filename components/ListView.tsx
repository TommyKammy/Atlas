"use client";

import { confirmAction, toast as toastMessage } from "@/lib/ui-feedback";

import { ApiError, api } from "@/lib/api-client";
import { patchTask, TaskConflictError } from "@/lib/task-client";
import { useRouter } from "next/navigation";
import { useLive } from "@/lib/use-live";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { SavedView, Section, TaskRow, TaskTemplate, User } from "@/lib/data";
import { todayISO } from "@/lib/dates";
import {
  COLUMN_FUNCTION_LABELS,
  canEditCustomField,
  columnFunctionOf,
  customFieldDisplay,
  customValueToArray,
  customValueToIdArray,
  customValueToInput,
  evaluateFormulaField,
  formatNumberValue,
  isNumericFieldType,
  type ColumnFunction,
  type CustomField,
  type CustomFieldType,
  type CustomValue,
} from "@/lib/custom-fields";
import { positionBetween } from "@/lib/order";
import EmptyState from "./EmptyState";
import { usePersistedViewState } from "@/lib/view-state-client";
import { useApiRefresh } from "@/lib/use-api-refresh";
import ListToolbar from "./list/ListToolbar";
import type { ListColumnOption } from "./list/ListOptionsDrawer";
import ListColumnHeader from "./list/ListColumnHeader";
import FieldTypeMenu, { type FieldLibraryEntry } from "./list/FieldTypeMenu";
import FieldDialog from "./list/FieldDialog";
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
  canAdmin,
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
  canAdmin: boolean;
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
  const [fieldMenuAnchor, setFieldMenuAnchor] = useState<{
    left: number;
    right: number;
    top: number;
    bottom: number;
  } | null>(null);
  const [fieldDialog, setFieldDialog] = useState<
    { mode: "create"; type: CustomFieldType } | { mode: "edit"; field: CustomField } | null
  >(null);

  const { selected, toggleSelect, selectRange, toggleAll, clear: clearSelection } =
    useListSelection();
  const [bulkSection, setBulkSection] = useState("");
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [sectionOrder, setSectionOrder] = useState<number[]>(() => sections.map((section) => section.id));
  const [sectionDragging, setSectionDragging] = useState<number | null>(null);
  const [sectionDrop, setSectionDrop] = useState<{ id: number; side: "before" | "after" } | null>(null);
  const [editingSection, setEditingSection] = useState<number | null>(null);
  const [sectionEditName, setSectionEditName] = useState("");
  const [sectionMenu, setSectionMenu] = useState<{ id: number; left: number; top: number } | null>(null);
  const [addCommitting, setAddCommitting] = useState<Record<string, boolean>>({});

  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const orderedSections = [
    ...sectionOrder.map((id) => sectionById.get(id)).filter((section): section is Section => Boolean(section)),
    ...sections.filter((section) => !sectionOrder.includes(section.id)),
  ];

  const bulk = async (op: string, extra?: Record<string, unknown>) => {
    if (selected.size === 0) return;
    try {
      const res = await fetch("/api/tasks/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], op, ...extra }),
      });
      if (!res.ok) throw new Error(`bulk ${op}: ${res.status}`);
      setBulkSection("");
      setBulkAssignee("");
      clearSelection();
      refresh();
    } catch {
      toastMessage("一括操作に失敗しました");
    }
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!await confirmAction(`${selected.size}件のタスクを削除しますか？`)) return;
    await bulk("delete");
  };

  const startSectionDrag = (event: React.DragEvent, id: number, name: string) => {
    if ((event.target as HTMLElement).closest("button,input,select,textarea,a")) {
      event.preventDefault();
      return;
    }
    const source = event.currentTarget as HTMLElement;
    const rect = source.getBoundingClientRect();
    const computed = window.getComputedStyle(source);
    const dragImage = document.createElement("div");
    dragImage.textContent = name;
    Object.assign(dragImage.style, {
      position: "fixed",
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${Math.min(rect.width, 380)}px`,
      height: `${rect.height}px`,
      display: "flex",
      alignItems: "center",
      padding: "0 12px 0 40px",
      overflow: "hidden",
      whiteSpace: "nowrap",
      textOverflow: "ellipsis",
      boxSizing: "border-box",
      background: "rgba(255, 255, 255, 0.9)",
      border: "1px solid #e1e1e1",
      borderRadius: "4px",
      boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
      color: computed.color,
      fontFamily: computed.fontFamily,
      fontSize: "14px",
      fontWeight: "600",
      opacity: "0.8",
      pointerEvents: "none",
      zIndex: "2147483647",
    });
    document.body.appendChild(dragImage);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/atlas-section", String(id));
    event.dataTransfer.setDragImage(dragImage, 40, rect.height / 2);
    window.setTimeout(() => dragImage.remove(), 0);
    setHint(null);
    setSectionDragging(id);
    setSectionDrop(null);
  };

  const reorderSections = async (sourceId: number, targetId: number, side: "before" | "after") => {
    const ids = orderedSections.map((section) => section.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0 || sourceId === targetId) return;
    const [moved] = ids.splice(from, 1);
    let insert = to;
    if (from < to) insert -= 1;
    if (side === "after") insert += 1;
    ids.splice(insert, 0, moved);
    setSectionOrder(ids);
    setSectionDragging(null);
    setSectionDrop(null);
    try {
      await api("/api/sections/reorder", "POST", { project_id: projectId, ids });
      refresh();
    } catch {
      setSectionOrder(sections.map((section) => section.id));
      toastMessage("セクションの並び替えに失敗しました");
      refresh();
    }
  };

  const beginSectionEdit = (id: number, name: string) => {
    setSectionMenu(null);
    setSectionEditName(name);
    setEditingSection(id);
  };

  const saveSectionName = async (id: number) => {
    const name = sectionEditName.trim();
    const current = sections.find((section) => section.id === id)?.name ?? "";
    setEditingSection(null);
    setSectionEditName("");
    if (!name || name === current) return;
    try {
      await api(`/api/sections/${id}`, "PATCH", { name });
      refresh();
    } catch {
      toastMessage("セクション名の変更に失敗しました");
      refresh();
    }
  };

  const addTaskToSection = (id: number) => {
    setSectionMenu(null);
    setAddingTo(id);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const input = document.querySelector<HTMLInputElement>(`input[data-add-task-section="${id}"]`);
        input?.scrollIntoView({ block: "nearest" });
        input?.focus();
      });
    });
  };

  const openSectionMenu = (event: React.MouseEvent, id: number) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setSectionMenu({
      id,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 268)),
      top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 176)),
    });
  };

  const deleteSection = async (id: number, name: string) => {
    setSectionMenu(null);
    if (!await confirmAction(`セクション「${name}」を削除しますか？`)) return;
    try {
      await api(`/api/sections/${id}`, "DELETE");
      setSectionOrder((prev) => prev.filter((sectionId) => sectionId !== id));
      refresh();
    } catch {
      toastMessage("セクションの削除に失敗しました");
      refresh();
    }
  };

  const removeField = async (f: CustomField) => {
    if (!await confirmAction(`項目「${f.name}」を削除しますか？（削除済みフィールドから復元できます）`)) return;
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
    if (e.shiftKey) {
      const visibleSet = new Set(visible.map((t) => t.id));
      const ids = [...document.querySelectorAll<HTMLElement>("[data-list-row]")]
        .map((el) => Number(el.getAttribute("data-list-row")))
        .filter((rowId) => visibleSet.has(rowId));
      if (selectRange(ids, id)) return;
    }
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
    colDropSide,
    visibleCols,
    gridCols,
    compactCells,
    gripMouseDown,
    startColumnDrag,
    dragOverColumn,
    dragLeaveColumn,
    dropColumn,
    clearColumnDrop,
    endColumnDrag,
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
        const filter = customFilter[f.id];
        if (!filter) return true;
        const value = customValues[t.id]?.[f.id];
        if (f.field_type === "multi_select") return customValueToArray(value).includes(filter);
        if (f.field_type === "people") {
          return customValueToIdArray(value).map(String).includes(filter);
        }
        return customValueToInput(f, value) === filter;
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
    if (e.shiftKey || e.ctrlKey || e.metaKey) return;
    e.stopPropagation();
    setEditing({ id: t.id, field });
    setEditVal(initial);
  };

  const patchFields = async (
    t: TaskRow,
    fields: Record<string, unknown>,
    options?: { close?: boolean },
  ) => {
    try {
      await patchTask(t.id, fields, t.updated_at);
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
      const customField = customFields.find((item) => item.id === fid);
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
      await api("/api/task-values", "POST", { task_id: t.id, field_id: fid, value: nextValue });
      setEditing(null);
      refresh();
    }
  };

  const cancelEdit = () => setEditing(null);

  const openDueEdit = (e: React.MouseEvent, t: TaskRow) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) return;
    e.stopPropagation();
    setEditing({ id: t.id, field: "due" });
    setEditStart(t.start_on ?? "");
    setEditVal(t.due_on ?? "");
  };

  const applyDueRange = async (t: TaskRow, start: string, due: string) => {
    const ns = start === "" ? null : start;
    const nd = due === "" ? null : due;
    if (ns === t.start_on && nd === t.due_on) return;
    await patchFields(t, { start_on: ns, due_on: nd }, { close: false });
  };

  const customRaw = (taskId: number, f: CustomField) =>
    customValueToInput(f, customValues[taskId]?.[f.id]);

  const numericValueFor = (field: CustomField, taskId: number): number | null => {
    if (field.field_type === "formula") return evaluateFormulaField(field, customValues[taskId] ?? {});
    const value = customValues[taskId]?.[field.id]?.value_number;
    return value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
  };

  const aggregateFor = (field: CustomField, items: TaskRow[]) => {
    if (!isNumericFieldType(field.field_type)) return null;
    const fn = columnFunctionOf(field);
    if (fn === "none") return null;
    const values: number[] = [];
    const pushTask = (task: TaskRow) => {
      const value = numericValueFor(field, task.id);
      if (value !== null) values.push(value);
    };
    const pushWithSubtasks = (task: TaskRow, seen: Set<number>) => {
      pushTask(task);
      if (!field.config?.include_subtasks || seen.has(task.id)) return;
      seen.add(task.id);
      for (const subtask of subtaskMap[task.id] ?? []) pushWithSubtasks(subtask, seen);
    };
    for (const task of items) pushWithSubtasks(task, new Set());
    if (fn === "count") {
      return { label: COLUMN_FUNCTION_LABELS.count, value: formatNumberValue(values.length, { ...field.config, decimals: 0 }) };
    }
    if (values.length === 0) return null;
    let result: number;
    if (fn === "sum") result = values.reduce((sum, value) => sum + value, 0);
    else if (fn === "average") result = values.reduce((sum, value) => sum + value, 0) / values.length;
    else if (fn === "min") result = Math.min(...values);
    else result = Math.max(...values);
    return {
      label: COLUMN_FUNCTION_LABELS[fn],
      value: formatNumberValue(result, field.config ?? {}),
    };
  };

  const footerTotals = (items: TaskRow[]) => {
    const out: Record<number, { label: string; value: string }> = {};
    for (const field of customFields) {
      const total = aggregateFor(field, items);
      if (total) out[field.id] = total;
    }
    return out;
  };

  const footerCell = (key: string, totals: Record<number, { label: string; value: string }>) => {
    if (!key.startsWith("cf-")) return <span key={key} />;
    const field = customFields.find((item) => `cf-${item.id}` === key);
    const total = field ? totals[field.id] : undefined;
    if (!field || !total) return <span key={key} />;
    return (
      <span key={key} className="flex min-w-0 items-center gap-1 pl-2 text-[11px] text-neutral-500" title={total.label}>
        <span className="shrink-0">{total.label}</span>
        <span className="truncate font-medium text-neutral-700">{total.value}</span>
      </span>
    );
  };

  const editInputCls =
    "w-full min-w-0 rounded border border-blue-500 bg-white py-0.5 pr-1 pl-2 text-[13px] text-neutral-800 outline-none";

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

  const canEditField = (field: CustomField) =>
    canEditCustomField(field, { viewerId, canEdit, canAdmin });

  const openEditField = (field: CustomField) => {
    setFieldDialog({ mode: "edit", field });
    setMenuCol(null);
  };

  const setColumnFunction = async (field: CustomField, fn: ColumnFunction) => {
    await api(`/api/custom-fields/${field.id}`, "PATCH", {
      config: { ...(field.config ?? {}), column_function: fn },
    });
    setMenuCol(null);
    refresh();
  };

  const toggleSubtaskTotals = async (field: CustomField) => {
    await api(`/api/custom-fields/${field.id}`, "PATCH", {
      config: { ...(field.config ?? {}), include_subtasks: !field.config?.include_subtasks },
    });
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

  const addFieldFromLibrary = async (entry: FieldLibraryEntry) => {
    try {
      await api("/api/custom-fields", "POST", {
        project_id: projectId,
        name: entry.name,
        field_type: entry.field_type,
        options: entry.options,
        description: entry.description,
        config: entry.config ?? {},
      });
      setFieldMenuAnchor(null);
      refresh();
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : "ライブラリからフィールドを作成できませんでした");
    }
  };

  const openFieldAdd = (rect: DOMRect) => {
    setFieldMenuAnchor({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    });
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
      colDropSide={colDropSide}
      colDragging={colDragging}
      gripMouseDown={gripMouseDown}
      visibleCols={visibleCols}
      moveCol={moveCol}
      startColumnDrag={startColumnDrag}
      dragOverColumn={dragOverColumn}
      dragLeaveColumn={dragLeaveColumn}
      dropColumn={dropColumn}
      endColumnDrag={endColumnDrag}
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
      onEditField={openEditField}
      setColumnFunction={setColumnFunction}
      toggleSubtaskTotals={toggleSubtaskTotals}
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
      const value = customFieldDisplay(
        field,
        customValues[t.id]?.[field.id],
        t,
        users,
        customValues[t.id],
        customFields,
      );
      return value === "–" ? "（未設定）" : value;
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

  const cancelAddTask = (key: number | string) => {
    setDrafts((draftsByKey) => ({ ...draftsByKey, [key]: "" }));
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
    setAddCommitting((previous) => ({ ...previous, [commitKey]: true }));
    try {
      await addTask(id);
      setAddingTo(null);
    } catch {
      toastMessage("タスクの追加に失敗しました");
    } finally {
      setAddCommitting((previous) => {
        const next = { ...previous };
        delete next[commitKey];
        return next;
      });
    }
  };

  const commitGroupedTask = async (gkey: string) => {
    const commitKey = `g:${gkey}`;
    if (addCommitting[commitKey]) return;
    const name = (drafts[gkey] ?? "").trim();
    if (!name) {
      cancelAddTask(gkey);
      return;
    }
    setAddCommitting((previous) => ({ ...previous, [commitKey]: true }));
    try {
      await addTaskGrouped(gkey);
      setAddingTo(null);
    } catch {
      toastMessage("タスクの追加に失敗しました");
    } finally {
      setAddCommitting((previous) => {
        const next = { ...previous };
        delete next[commitKey];
        return next;
      });
    }
  };

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
    applyDueRange,
    editInputCls,
    users,
    visibleCols,
    statusFieldEnabled,
    statusHidden,
    statusOptions,
    shownFields,
    customFields,
    selected,
    sectionDragging: sectionDragging !== null,
    canEditField,
    onTimerChange: refresh,
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

  const sectionDropSide = (targetId: number): "before" | "after" | null => {
    if (sectionDragging === null || sectionDragging === targetId) return null;
    const ids = orderedSections.map((section) => section.id);
    const from = ids.indexOf(sectionDragging);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return null;
    return from < to ? "after" : "before";
  };

  const groupHeader = (key: string, name: string, count: number, depth = 0, sectionId?: number) => {
    const collapsed = collapsedGroups.has(key);
    const sectionDrag = sectionId !== undefined && groupBy === "section";
    const target = sectionId !== undefined && sectionDrop?.id === sectionId;
    const controlsVisible =
      editingSection === sectionId || sectionMenu?.id === sectionId;
    const controlVisibility = controlsVisible
      ? "opacity-100"
      : "opacity-0 group-hover/section-name:opacity-100 group-focus-within/section-name:opacity-100";
    return (
      <div
        data-list-section-header={key}
        data-list-section-depth={depth}
        data-section-id={sectionId}
        data-section-dragging={sectionDragging === sectionId ? "true" : undefined}
        className={`relative flex h-[37px] items-center gap-2 ${depth > 0 ? "pl-10" : "pl-6"} ${
          sectionDragging === sectionId
            ? "bg-[#f3f3f3]/70 [&>*]:invisible"
            : target
              ? "bg-[#f3f3f3]"
              : ""
        }`}
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
        {sectionDrag ? (
          <div className="group/section-name flex min-w-0 shrink-0 items-center">
            {editingSection === sectionId ? (
              <input
                data-section-name-input={sectionId}
                value={sectionEditName}
                onChange={(event) => setSectionEditName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void saveSectionName(sectionId);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setEditingSection(null);
                    setSectionEditName("");
                  }
                }}
                onBlur={() => void saveSectionName(sectionId)}
                aria-label="セクション名"
                autoFocus
                className="h-9 w-[200px] rounded border border-[#4573d2] bg-white px-2 text-[14px] font-semibold text-neutral-900 ring-2 ring-[#4573d2]/15 outline-none"
              />
            ) : (
              <button
                type="button"
                data-section-name={sectionId}
                onClick={() => beginSectionEdit(sectionId, name)}
                title="クリックしてセクション名を変更"
                className="max-w-[360px] cursor-pointer truncate text-left text-[14px] leading-6 font-semibold text-neutral-900"
              >
                {name}
              </button>
            )}
            {canEdit && (
              <>
                <button
                  type="button"
                  data-section-add-task={sectionId}
                  onClick={() => addTaskToSection(sectionId)}
                  title="このセクションにタスクを追加"
                  aria-label="このセクションにタスクを追加"
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-neutral-500 transition-opacity hover:bg-neutral-200/70 hover:text-neutral-800 ${controlVisibility}`}
                >
                  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M8 3v10M3 8h10" strokeLinecap="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  data-section-menu-button={sectionId}
                  onClick={(event) => openSectionMenu(event, sectionId)}
                  title="セクションのその他のアクション"
                  aria-label="セクションのその他のアクション"
                  aria-haspopup="menu"
                  aria-expanded={sectionMenu?.id === sectionId}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-neutral-500 transition-opacity hover:bg-neutral-200/70 hover:text-neutral-800 ${controlVisibility}`}
                >
                  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
                    <circle cx="3" cy="8" r="1.3" />
                    <circle cx="8" cy="8" r="1.3" />
                    <circle cx="13" cy="8" r="1.3" />
                  </svg>
                </button>
              </>
            )}
          </div>
        ) : (
          <span className="text-[14px] leading-6 font-semibold text-neutral-900">{name}</span>
        )}
        {groupBy !== "section" || group2 !== null ? (
          <span data-list-section-count={count} className="text-[13px] font-normal text-neutral-500">{count}</span>
        ) : null}
        {sectionDrag && (
          <div
            data-section-drag-handle={sectionId}
            draggable
            onDragStart={(event) => startSectionDrag(event, sectionId, name)}
            onDragEnd={() => {
              setSectionDragging(null);
              setSectionDrop(null);
              setHint(null);
            }}
            title="ドラッグしてセクションを移動"
            className="h-full min-w-6 flex-1 cursor-grab select-none"
          />
        )}
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

  const ghostRow = (onClick: () => void, items: TaskRow[]) => {
    const totals = footerTotals(items);
    return (
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
      {visibleCols.map((k) => footerCell(k, totals))}
      <span />
    </div>
    );
  };

  const addRow = (input: ReactNode, items: TaskRow[]) => {
    const totals = footerTotals(items);
    return (
    <div
      className="grid items-center divide-x divide-[#eaeaea] border-b border-[#eaeaea] px-2 py-1.5 text-sm"
      style={{ gridTemplateColumns: gridCols }}
    >
      <span />
      <div data-add-task-row className="flex min-w-0 items-center gap-1 pl-12">{input}</div>
      {visibleCols.map((k) => footerCell(k, totals))}
      <span />
    </div>
    );
  };

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
        openFieldAdd={() => {
          const button = document.querySelector<HTMLElement>("[data-field-add-button]");
          if (button) openFieldAdd(button.getBoundingClientRect());
          else setFieldDialog({ mode: "create", type: "text" });
        }}
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
        <div
          data-bulk-toolbar
          role="toolbar"
          aria-label="複数タスクの一括編集"
          className="fixed bottom-12 left-1/2 z-[75] flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-lg bg-[#1e1e1e] px-3 py-2 text-white shadow-[0_0_0_1px_#eaeaea,0_6px_12px_rgba(118,118,118,0.24)]"
        >
          <span aria-live="polite" className="mr-1 whitespace-nowrap px-1 text-[13px] font-semibold">
            {selected.size} 件のタスクを選択中
          </span>
          <button
            onClick={() => void bulk("complete")}
            className="rounded px-2 py-1 text-[12px] text-neutral-200 hover:bg-white/10"
          >
            完了
          </button>
          <button
            onClick={() => void bulk("reopen")}
            className="rounded px-2 py-1 text-[12px] text-neutral-200 hover:bg-white/10"
          >
            未完了
          </button>
          <select
            value={bulkSection}
            onChange={(e) => {
              const value = e.target.value;
              setBulkSection(value);
              if (value) void bulk("move", { section_id: Number(value) });
            }}
            aria-label="セクションを移動"
            className="h-8 rounded border border-white/15 bg-[#2c2c2c] px-2 text-[12px] text-white outline-none"
          >
            <option value="">セクション移動…</option>
            {orderedSections.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.name}
              </option>
            ))}
          </select>
          <select
            value={bulkAssignee}
            onChange={(e) => {
              const value = e.target.value;
              setBulkAssignee(value);
              if (value) void bulk("assign", { assignee_id: value === "none" ? null : Number(value) });
            }}
            aria-label="担当者を変更"
            className="h-8 rounded border border-white/15 bg-[#2c2c2c] px-2 text-[12px] text-white outline-none"
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
            onClick={() => void bulkDelete()}
            className="rounded px-2 py-1 text-[12px] text-red-300 hover:bg-red-500/15"
          >
            削除
          </button>
          <button
            onClick={clearSelection}
            aria-label="選択を解除"
            title="選択を解除"
            className="flex h-8 w-8 items-center justify-center rounded text-[18px] leading-none text-neutral-300 hover:bg-white/10 hover:text-white"
          >
            ×
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
        onDragOver={(event) => {
          if (!colDragging) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDragLeave={(event) => {
          const related = event.relatedTarget as Node | null;
          if (related && event.currentTarget.contains(related)) return;
          clearColumnDrop();
        }}
        onDrop={(event) => {
          if (!colDragging) return;
          event.preventDefault();
          endColumnDrag();
        }}
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
          type="button"
          style={{ order: 999 }}
          data-field-add-button
          aria-label="フィールドを追加"
          onClick={(event) => openFieldAdd(event.currentTarget.getBoundingClientRect())}
          title="フィールドを追加"
          className="flex h-6 w-6 items-center justify-center justify-self-end rounded text-[15px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
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
                                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                                  e.preventDefault();
                                  void commitGroupedTask(gkey);
                                }
                                if (e.key === "Escape") cancelAddTask(gkey);
                              }}
                              onBlur={(e) => {
                                const related = e.relatedTarget as HTMLElement | null;
                                if (related?.closest("[data-add-task-row]")) return;
                                void commitGroupedTask(gkey);
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
                              onBlur={(e) => {
                                const related = e.relatedTarget as HTMLElement | null;
                                if (related?.closest("[data-add-task-row]")) return;
                                void commitGroupedTask(gkey);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void commitGroupedTask(gkey);
                                }
                                if (e.key === "Escape") cancelAddTask(gkey);
                              }}
                              className="rounded border px-1 py-1 text-sm"
                              title="追加先セクション"
                            >
                              {sections.map((sc) => (
                                <option key={sc.id} value={sc.id}>
                                  {sc.name}
                                </option>
                              ))}
                            </select>
                          </>,
                          items,
                        )
                      : ghostRow(() => setAddingTo(gk), items)}
                  </>
                )}
              </div>
            );
          })
        : orderedSections.map((s) => {
            const key = `s:${s.id}`;
            const collapsed = collapsedGroups.has(key);
            const items = bySection.get(s.id) ?? [];
            const shownItems = items.slice(0, rowLimitFor(key));
            return (
              <div
                key={s.id}
                data-list-section-block={s.id}
                className="relative"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (sectionDragging !== null) {
                    const side = sectionDropSide(s.id);
                    setSectionDrop(side ? { id: s.id, side } : null);
                  }
                }}
                onDragLeave={(e) => {
                  if (sectionDragging === null) return;
                  const related = e.relatedTarget as Node | null;
                  if (related && (e.currentTarget as HTMLElement).contains(related)) return;
                  if (sectionDrop?.id === s.id) setSectionDrop(null);
                }}
                onDrop={(e) => {
                  if (sectionDragging !== null) {
                    e.preventDefault();
                    e.stopPropagation();
                    const source = Number(e.dataTransfer.getData("text/atlas-section"));
                    const side = sectionDropSide(s.id);
                    if (source && side) void reorderSections(source, s.id, side);
                    return;
                  }
                  e.preventDefault();
                  const dragId = Number(e.dataTransfer.getData("text/atlas-task"));
                  if (dragId) appendToSection(dragId, s.id);
                }}
              >
                {sectionDrop?.id === s.id && (
                  <span
                    data-section-drop-indicator={sectionDrop.side}
                    className={`pointer-events-none absolute inset-x-0 z-20 h-[2px] bg-[#2f6fd0] ${
                      sectionDrop.side === "before" ? "top-0" : "bottom-0"
                    }`}
                  />
                )}
                {groupHeader(key, s.name, items.length, 0, s.id)}
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
                                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                                  e.preventDefault();
                                  void commitSectionTask(s.id);
                                }
                                if (e.key === "Escape") cancelAddTask(s.id);
                              }}
                              onBlur={() => void commitSectionTask(s.id)}
                              placeholder="タスク名を入力"
                              data-add-task
                              data-add-task-section={s.id}
                              autoFocus
                              className="w-full max-w-md rounded border px-2 py-1 text-sm outline-none focus:border-blue-500"
                            />
                          </>,
                          items,
                        )
                      : ghostRow(() => setAddingTo(s.id), items)}
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
              data-add-section-input
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
      </div>
      </div>
      </div>
      {sectionMenu && (() => {
        const section = sections.find((item) => item.id === sectionMenu.id);
        if (!section) return null;
        const key = `s:${section.id}`;
        const itemClass =
          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-neutral-700 hover:bg-neutral-100";
        return (
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setSectionMenu(null)} />
            <div
              role="menu"
              data-section-menu={section.id}
              aria-label="セクションのその他のアクション"
              className="fixed z-[61] w-[268px] rounded-lg border border-[#e1e1e1] bg-white py-1 shadow-[0_8px_24px_rgba(0,0,0,0.16)]"
              style={{ left: sectionMenu.left, top: sectionMenu.top }}
            >
              <button
                type="button"
                role="menuitem"
                data-section-menu-action="rename"
                onClick={() => beginSectionEdit(section.id, section.name)}
                className={itemClass}
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <path d="M11.3 2.7a1.6 1.6 0 0 1 2.2 2.2L5.7 12.7 2.7 13.3l.6-3z" strokeLinejoin="round" />
                </svg>
                セクション名を変更
              </button>
              <button
                type="button"
                role="menuitem"
                data-section-menu-action="add"
                onClick={() => {
                  setSectionMenu(null);
                  setAddingSection(true);
                  requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                      const input = document.querySelector<HTMLInputElement>("input[data-add-section-input]");
                      input?.scrollIntoView({ block: "nearest" });
                      input?.focus();
                    });
                  });
                }}
                className={itemClass}
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <path d="M8 3v10M3 8h10" strokeLinecap="round" />
                </svg>
                セクションを追加
              </button>
              <button
                type="button"
                role="menuitem"
                data-section-menu-action="collapse"
                onClick={() => {
                  setSectionMenu(null);
                  toggleGroup(key);
                }}
                className={itemClass}
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <path d="M3 4h10M4.5 8h7M6 12h4" strokeLinecap="round" />
                </svg>
                グループを展開または折り畳む
              </button>
              <div className="my-1 border-t border-neutral-200" />
              <button
                type="button"
                role="menuitem"
                data-section-menu-action="delete"
                onClick={() => void deleteSection(section.id, section.name)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-red-600 hover:bg-red-50"
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <path d="M3 4.5h10M6.5 2.5h3M4.5 4.5l.7 9h5.6l.7-9M6.8 7v4M9.2 7v4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                セクションを削除
              </button>
            </div>
          </>
        );
      })()}
      {fieldMenuAnchor && (
        <FieldTypeMenu
          projectId={projectId}
          anchor={fieldMenuAnchor}
          onClose={() => setFieldMenuAnchor(null)}
          onRestored={refresh}
          onPickTemplate={(entry) => void addFieldFromLibrary(entry)}
          onPick={(type) => {
            setFieldMenuAnchor(null);
            setFieldDialog({ mode: "create", type });
          }}
        />
      )}
      {fieldDialog && (
        <FieldDialog
          projectId={projectId}
          mode={fieldDialog.mode}
          initialType={fieldDialog.mode === "create" ? fieldDialog.type : fieldDialog.field.field_type}
          field={fieldDialog.mode === "edit" ? fieldDialog.field : null}
          availableFields={customFields}
          users={users}
          onClose={() => setFieldDialog(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}