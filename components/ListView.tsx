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
import ListColumnHeader from "./list/ListColumnHeader";
import TaskListRow from "./list/TaskListRow";
import { useListSelection } from "@/lib/use-list-selection";
import { useColumnLayout } from "@/lib/use-column-layout";




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
  initial: {
    hide_completed?: boolean;
    assignee?: string;
    status?: string;
    sort?: string;
    sortdir?: "asc" | "desc";
    due?: string;
    group?: string;
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
  const [groupBy, setGroupBy] = useState<"section" | "assignee" | "status">(
    initial.group === "assignee" || (initial.group === "status" && statusFieldEnabled)
      ? initial.group
      : "section",
  );
  const [groupSections, setGroupSections] = useState<Record<string, number | null>>({});
  const [assigneeFilter, setAssigneeFilter] = useState(initial.assignee ?? "");
  const [sortKey, setSortKey] = useState<"position" | "due" | "name" | "progress">(
    initial.sort === "due" || initial.sort === "name" || initial.sort === "progress" ? initial.sort : "position",
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initial.sortdir === "desc" ? "desc" : "asc");
  const [dueFilter, setDueFilter] = useState(initial.due ?? "");
  const [statusFilter, setStatusFilter] = useState(initial.status ?? "");
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [menuCol, setMenuCol] = useState<string | null>(null);
  const [hiddenCols, setHiddenCols] = useState<Set<number>>(new Set());
  const [statusHidden, setStatusHidden] = useState(false);
  const [rowLimits, setRowLimits] = useState<Record<string, number>>({});
  usePersistedViewState(projectId, "list", {
    hide_completed: hideCompleted,
    assignee: assigneeFilter,
    status: statusFilter,
    due: dueFilter,
    sort: sortKey,
    sortdir: sortDir,
    group: groupBy,
  });
  const [editingField, setEditingField] = useState<number | null>(null);
  const [editFieldName, setEditFieldName] = useState("");
  const [editFieldOptions, setEditFieldOptions] = useState("");
  const [customFilter, setCustomFilter] = useState<Record<number, string>>({});

  const pushState = (patch: {
    hide?: boolean;
    assignee?: string;
    status?: string;
    sort?: string;
    sortdir?: "asc" | "desc";
    due?: string;
    group?: string;
  }) => {
    const q = new URLSearchParams(window.location.search);
    q.set("view", "list");
    const hide = patch.hide ?? hideCompleted;
    const asn = patch.assignee ?? assigneeFilter;
    const st = patch.status ?? statusFilter;
    const so = patch.sort ?? sortKey;
    const sd = patch.sortdir ?? sortDir;
    const du = patch.due ?? dueFilter;
    const gr = patch.group ?? groupBy;
    if (hide) q.set("hide", "1");
    else q.delete("hide");
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
    if (gr !== "section") q.set("group", gr);
    else q.delete("group");
    router.push(`/projects/${projectId}?${q.toString()}`);
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
  const toggleExpand = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
      (!hideCompleted || !t.completed) &&
      (assigneeFilter === "" ||
        (assigneeFilter === "none" ? t.assignee_id === null : t.assignee_id === Number(assigneeFilter))) &&
      (!statusFieldEnabled || statusFilter === "" || t.status === statusFilter) &&
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
    if (sortKey === "due") {
      const av = a.due_on ?? "9999";
      const bv = b.due_on ?? "9999";
      return sortDir === "asc" ? (av < bv ? -1 : 1) : av > bv ? -1 : 1;
    }
    if (sortKey === "name") {
      const c = a.name.localeCompare(b.name, "ja");
      return sortDir === "asc" ? c : -c;
    }
    if (sortKey === "progress") {
      const c = a.progress - b.progress;
      return sortDir === "asc" ? c : -c;
    }
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
      filters: { hide_completed: hideCompleted, assignee: assigneeFilter, status: statusFilter, due: dueFilter },
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
    (assigneeFilter !== "" ? 1 : 0) +
    (dueFilter !== "" ? 1 : 0) +
    (statusFieldEnabled && statusFilter !== "" ? 1 : 0);
  const sortActive = sortKey !== "position";

  const clearFilters = () => {
    setHideCompleted(false);
    setAssigneeFilter("");
    setDueFilter("");
    setStatusFilter("");
    const q = new URLSearchParams({ view: "list" });
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
    setFilterOpen((v) => !v);
  };
  const openSortMenu = () => {
    setFilterOpen(false);
    setGroupOpen(false);
    setSortOpen((v) => !v);
  };
  const openGroupMenu = () => {
    setFilterOpen(false);
    setSortOpen(false);
    setGroupOpen((v) => !v);
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

  const groupKeyOf = (t: TaskRow) =>
    groupBy === "assignee" ? (t.assignee_name ?? "（未割当）") : t.status || "（未設定）";

  const grouped = new Map<string, TaskRow[]>();
  if (groupBy !== "section") {
    for (const t of visible) {
      const k = groupKeyOf(t);
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k)!.push(t);
    }
    for (const list of grouped.values()) list.sort(sorter);
  }
  const groupOrder = [...grouped.entries()].sort(([a], [b]) =>
    a.startsWith("（") && !b.startsWith("（") ? 1 : !a.startsWith("（") && b.startsWith("（") ? -1 : a.localeCompare(b, "ja"),
  );

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

  const groupHeader = (key: string, name: string, count: number) => {
    const collapsed = collapsedGroups.has(key);
    return (
      <div data-list-section-header={key} className="flex h-[37px] items-center gap-2 pl-6">
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
        {groupBy !== "section" && (
          <span data-list-section-count={count} className="text-[13px] font-normal text-neutral-500">{count}</span>
        )}
      </div>
    );
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
      data-list-sort={sortKey}
      data-list-sortdir={sortDir}
      data-list-group={groupBy}
      data-list-assignee={assigneeFilter}
      data-list-status={statusFilter}
      data-list-due={dueFilter}
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
        hideCompleted={hideCompleted}
        setHideCompleted={setHideCompleted}
        pushState={pushState}
        assigneeFilter={assigneeFilter}
        setAssigneeFilter={setAssigneeFilter}
        dueFilter={dueFilter}
        setDueFilter={setDueFilter}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        sortActive={sortActive}
        openSortMenu={openSortMenu}
        clearAllSort={clearAllSort}
        sortOpen={sortOpen}
        setSortOpen={setSortOpen}
        sortKey={sortKey}
        setSortKey={setSortKey}
        sortDir={sortDir}
        setSortDir={setSortDir}
        groupOpen={groupOpen}
        setGroupOpen={setGroupOpen}
        openGroupMenu={openGroupMenu}
        groupBy={groupBy}
        setGroupBy={setGroupBy}
        saving={saving}
        setSaving={setSaving}
        saveName={saveName}
        setSaveName={setSaveName}
        saveView={saveView}
        autoRefresh={autoRefresh}
        setAutoRefresh={setAutoRefresh}
        lastRefresh={lastRefresh}
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
      {((statusFieldEnabled && statusHidden) || customFields.some((f) => hiddenCols.has(f.id))) && (
        <div className="flex items-center gap-1 py-1 text-[11px] font-normal text-neutral-500">
          非表示:
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
                    {shownItems.map((t) => (
                      <TaskListRow key={t.id} task={t} ctx={rowCtx} />
                    ))}
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
                    {shownItems.map((t) => (
                      <TaskListRow key={t.id} task={t} ctx={rowCtx} />
                    ))}
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