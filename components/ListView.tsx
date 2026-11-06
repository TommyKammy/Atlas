"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLive } from "@/lib/use-live";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { SavedView, Section, TaskRow, TaskTemplate, User } from "@/lib/data";
import { todayISO } from "@/lib/dates";
import { formatCustomValue, type CustomField, type CustomValue } from "@/lib/custom-fields";
import { positionBetween } from "@/lib/order";
import TemplateBar from "./TemplateBar";

async function api(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
  return res.json();
}

export function useApiRefresh() {
  const router = useRouter();
  return () => router.refresh();
}

// Asana-style compact date range (measured 2026-11-06, read-only):
// same month: "11月3日 – 13日"; each side is a no-wrap segment and the
// line may only break at the dash (DueDate noWrapSegment pattern).
export function dueSegs(start: string | null, due: string | null): [string, string | null] {
  const curY = new Date().getFullYear();
  const p = (d: string) => {
    const [y, m, dd] = d.split("-").map(Number);
    return { y, m, d: dd };
  };
  const one = (d: string) => {
    const { y, m, d: dd } = p(d);
    return `${y === curY ? "" : `${y}年`}${m}月${dd}日`;
  };
  if (start && due && start !== due) {
    const a = p(start);
    const b = p(due);
    if (a.y === b.y && a.m === b.m) return [`${a.m}月${a.d}日`, `${b.d}日`];
    if (a.y === b.y) return [`${a.m}月${a.d}日`, `${b.m}月${b.d}日`];
    return [`${a.y}年${a.m}月${a.d}日`, `${b.y}年${b.m}月${b.d}日`];
  }
  const d = due ?? start;
  return d ? [one(d), null] : ["", null];
}

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

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkSection, setBulkSection] = useState("");
  const [bulkAssignee, setBulkAssignee] = useState("");

  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulk = async (op: string, extra?: Record<string, unknown>) => {
    if (selected.size === 0) return;
    const res = await fetch("/api/tasks/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected], op, ...extra }),
    });
    if (!res.ok) throw new Error(`bulk ${op}: ${res.status}`);
    setSelected(new Set());
    refresh();
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`${selected.size}件のタスクを削除しますか？`)) return;
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
    if (!confirm(`項目「${f.name}」を削除しますか？（全タスクの値も消えます）`)) return;
    await api(`/api/custom-fields/${f.id}`, "DELETE");
    refresh();
  };
  const [hideCompleted, setHideCompleted] = useState(initial.hide_completed === true);
  const [groupBy, setGroupBy] = useState<"section" | "assignee" | "status">(
    initial.group === "assignee" || initial.group === "status" ? initial.group : "section",
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
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [colOrder, setColOrder] = useState<string[]>([]);
  const colW = (key: string) =>
    colWidths[key] ??
    (key.startsWith("cf-") ? 130 : ({ assignee: 160, due: 120, progress: 100, status: 120 } as Record<string, number>)[key] ?? 120);

  const gripMouseDown = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    startResize(e, key);
  };

  const headerMouseDown = (e: React.MouseEvent, key: string) => {
    if (key === "name") return;
    if ((e.target as HTMLElement).closest('[title="ドラッグで列幅を変更"],div.z-40,input,select,textarea')) return;
    colDragCand.current = { key, x: e.clientX };
  };

  const headerMouseUp = (key: string) => {
    if (colDragging && key !== "name" && key !== colDragging) {
      const vis = [...visibleCols];
      const fi = vis.indexOf(colDragging);
      const ti = vis.indexOf(key);
      if (fi >= 0 && ti >= 0) {
        vis.splice(ti, 0, ...vis.splice(fi, 1));
        setColOrder([...vis, ...colOrder.filter((k) => !vis.includes(k))]);
        setMenuCol(null);
      }
    }
    colDragCand.current = null;
    setColDragging(null);
    setColDropOver(null);
  };

  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      const c = colDragCand.current;
      if (c && Math.abs(ev.clientX - c.x) > 6) {
        setColDragging(c.key);
        colDragCand.current = null;
      }
    };
    const onUp = () => {
      colDragCand.current = null;
      setColDragging(null);
      setColDropOver(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const storeKey = `atlas-listcols-${projectId}`;
  useEffect(() => {
    try {
      const w = JSON.parse(localStorage.getItem(`${storeKey}:w`) ?? "{}");
      const o = JSON.parse(localStorage.getItem(`${storeKey}:o`) ?? "[]");
      if (w && typeof w === "object") setColWidths(w);
      if (Array.isArray(o)) setColOrder(o.filter((k) => typeof k === "string"));
    } catch {
      /* ignore */
    }
  }, [storeKey]);
  useEffect(() => {
    try {
      localStorage.setItem(`${storeKey}:w`, JSON.stringify(colWidths));
    } catch {
      /* ignore */
    }
  }, [colWidths, storeKey]);
  useEffect(() => {
    try {
      localStorage.setItem(`${storeKey}:o`, JSON.stringify(colOrder));
    } catch {
      /* ignore */
    }
  }, [colOrder, storeKey]);

  const collapseKey = `atlas-listcollapsed-${projectId}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(collapseKey) ?? "[]");
      if (Array.isArray(saved)) setCollapsedGroups(new Set(saved.filter((k) => typeof k === "string")));
    } catch {
      /* ignore */
    }
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

  const startResize = (e: React.MouseEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW =
      key === "name" && colWidths[key] == null
        ? ((e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect().width ?? 240)
        : colW(key);
    const onMove = (ev: MouseEvent) => {
      const w = Math.min(400, Math.max(60, startW + ev.clientX - startX));
      setColWidths((m) => ({ ...m, [key]: w }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
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
    const q = new URLSearchParams({ view: "list" });
    const hide = patch.hide ?? hideCompleted;
    const asn = patch.assignee ?? assigneeFilter;
    const st = patch.status ?? statusFilter;
    const so = patch.sort ?? sortKey;
    const sd = patch.sortdir ?? sortDir;
    const du = patch.due ?? dueFilter;
    const gr = patch.group ?? groupBy;
    if (hide) q.set("hide", "1");
    if (asn !== "") q.set("assignee", asn);
    if (st !== "") q.set("status", st);
    if (so !== "position") {
      q.set("sort", so);
      if (sd === "desc") q.set("sortdir", "desc");
    }
    if (du !== "") q.set("due", du);
    if (gr !== "section") q.set("group", gr);
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
  const clearPill =
    "flex h-7 w-5 items-center justify-center rounded-r-md text-[#2C60B8] hover:bg-[#dfe8fa]";
  const toolbarBtn =
    "flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-neutral-500 hover:bg-neutral-100";
  const popoverCls =
    "absolute top-full right-0 z-40 mt-1 w-72 rounded-lg border bg-white p-3 text-sm shadow-lg";
  const menuSelect =
    "mt-1 h-8 w-full rounded-md border bg-white px-2 text-[13px] text-neutral-700 outline-none focus:border-[#2C60B8]";
  const checkItem =
    "flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-[13px] text-neutral-700 hover:bg-neutral-100";
  const [saveName, setSaveName] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const dragging = useRef(false);
  const anchorRef = useRef<number | null>(null);
  const [dropHint, setDropHint] = useState<{ id: number; before: boolean } | null>(null);
  const hintRef = useRef<{ id: number; before: boolean } | null>(null);
  const setHint = (h: { id: number; before: boolean } | null) => {
    const p = hintRef.current;
    if ((p === null) !== (h === null) || (p && h && (p.id !== h.id || p.before !== h.before))) {
      hintRef.current = h;
      setDropHint(h);
    }
  };
  const colDragCand = useRef<{ key: string; x: number } | null>(null);
  const [colDragging, setColDragging] = useState<string | null>(null);
  const [colDropOver, setColDropOver] = useState<string | null>(null);
  const openTask = (id: number) => {
    const q = new URLSearchParams(window.location.search);
    q.set("task", String(id));
    router.push(`/projects/${projectId}?${q.toString()}`);
  };
  const rowClick = (e: React.MouseEvent, id: number) => {
    if (dragging.current) return;
    if ((e.target as HTMLElement).closest("a,button,input,select,textarea,summary,[contenteditable]")) return;
    if (e.shiftKey && anchorRef.current !== null) {
      const ids = visible.map((t) => t.id);
      const a = ids.indexOf(anchorRef.current);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected(new Set(ids.slice(lo, hi + 1)));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      toggleSelect(id);
      anchorRef.current = id;
      return;
    }
    anchorRef.current = id;
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
  const statusOptions = projectStatusOptions.length > 0 ? projectStatusOptions : distinctStatus;
  const [editingStatusOpts, setEditingStatusOpts] = useState(false);
  const [statusOptsDraft, setStatusOptsDraft] = useState("");

  const saveStatusOpts = async () => {
    const opts = statusOptsDraft
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    if (opts.length === 0) return;
    await api(`/api/projects/${projectId}`, "PATCH", { status_options: opts });
    setEditingStatusOpts(false);
    setMenuCol(null);
    refresh();
  };
  const shownFields = customFields.filter((f) => !hiddenCols.has(f.id));
  const baseKeys = ["assignee", "due", "progress", "status", ...customFields.map((f) => `cf-${f.id}`)];
  const orderedKeys = [...colOrder.filter((k) => baseKeys.includes(k)), ...baseKeys.filter((k) => !colOrder.includes(k))];
  const visibleCols = orderedKeys.filter((k) =>
    k === "status" ? !statusHidden : k.startsWith("cf-") ? !hiddenCols.has(Number(k.slice(3))) : true,
  );
  const moveCol = (key: string, dir: -1 | 1) => {
    const vis = [...visibleCols];
    const i = vis.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= vis.length) return;
    [vis[i], vis[j]] = [vis[j], vis[i]];
    setColOrder([...vis, ...colOrder.filter((k) => !vis.includes(k))]);
    setMenuCol(null);
  };
  const nameW = colWidths["name"];
  const gridCols = `28px ${nameW ? `${nameW}px` : "minmax(220px,1fr)"}${visibleCols.map((k) => ` ${colW(k)}px`).join("")} 40px`;

  const visible = tasks.filter(
    (t) =>
      (!hideCompleted || !t.completed) &&
      (assigneeFilter === "" ||
        (assigneeFilter === "none" ? t.assignee_id === null : t.assignee_id === Number(assigneeFilter))) &&
      (statusFilter === "" || t.status === statusFilter) &&
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
        const val = customValues[t.id]?.[f.id];
        const raw = val === undefined || val === null ? "" : String(typeof val === "object" ? (val as { value?: unknown }).value ?? "" : val);
        return raw === v;
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
    const res = await fetch(`/api/tasks/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: !t.completed, expected_updated_at: t.updated_at }),
    });
    if (res.status === 409) {
      alert("他のユーザーが先に更新しました。最新を表示します。");
      refresh();
      return;
    }
    if (!res.ok) throw new Error(`PATCH /api/tasks/${t.id}: ${res.status}`);
    refresh();
  };

  const remove = async (t: TaskRow) => {
    if (!confirm(`「${t.name}」を削除しますか？`)) return;
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
    const res = await fetch(`/api/tasks/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fields, expected_updated_at: t.updated_at }),
    });
    if (res.status === 409) {
      alert("他のユーザーが先に更新しました。最新を表示します。");
    } else if (!res.ok) {
      alert(`更新に失敗しました: ${res.status}`);
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
    let s = cleared ? "" : editStart;
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

  const customRaw = (taskId: number, f: CustomField) => {
    const val = customValues[taskId]?.[f.id];
    if (val === undefined || val === null) return "";
    return String(typeof val === "object" ? (val as { value?: unknown }).value ?? "" : val);
  };

  const editInputCls =
    "w-full min-w-0 rounded border border-blue-500 bg-white px-1 py-0.5 text-[13px] text-neutral-800 outline-none";

  const saveView = async () => {
    if (!saveName.trim()) return;
    const res = await api("/api/saved-views", "POST", {
      project_id: projectId,
      name: saveName,
      filters: { hide_completed: hideCompleted, assignee: assigneeFilter, status: statusFilter, due: dueFilter },
      sort_key: sortKey,
      group_by: groupBy,
    });
    window.location.href = `/projects/${projectId}?view=list&saved=${res.id}`;
  };

  const deleteSavedView = async (id: number) => {
    if (!confirm("保存ビューを削除しますか？")) return;
    await api(`/api/saved-views/${id}`, "DELETE");
    window.location.href = `/projects/${projectId}?view=list`;
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
    (statusFilter !== "" ? 1 : 0);
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
    if (key === "status") return headerCell(key, "Status");
    const f = customFields.find((x) => `cf-${x.id}` === key);
    return f ? headerCell(key, f.name, f) : null;
  };

  const openFieldAdd = () => {
    setAddingField(true);
    requestAnimationFrame(() =>
      document.getElementById("custom-field-add")?.scrollIntoView({ block: "nearest" }),
    );
  };

  const menuItem =
    "block w-full px-3 py-1.5 text-left text-[13px] font-normal text-neutral-700 hover:bg-neutral-100";
  const menuLabel = "px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400";

  const headerCell = (key: string, label: string, field?: CustomField) => {
    const sortable = key === "name" || key === "due" || key === "progress";
    const open = menuCol === key;
    return (
      <span
        className={`group/hd relative inline-flex min-w-0 cursor-grab items-center gap-0.5 select-none active:cursor-grabbing ${
          colDropOver === key ? "rounded bg-blue-100 ring-2 ring-blue-400" : ""
        } ${colDragging === key ? "opacity-50" : ""}`}
        onMouseDown={(e) => headerMouseDown(e, key)}
        onMouseUp={() => headerMouseUp(key)}
        onMouseEnter={() => {
          if (colDragging && key !== colDragging && key !== "name") setColDropOver(key);
        }}
        onMouseLeave={() => setColDropOver((v) => (v === key ? null : v))}
      >
        {sortable ? (
          <button
            onClick={() => cycleSort(key as "name" | "due" | "progress")}
            title="クリックで並び替え（昇順→降順→解除）"
            className="truncate hover:text-black"
          >
            {label}
            {sortMark(key as "name" | "due" | "progress")}
          </button>
        ) : (
          <span className="truncate">{label}</span>
        )}
        <button
          onClick={() => setMenuCol(open ? null : key)}
          title="列メニュー"
          className={`rounded px-0.5 text-[10px] leading-none text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 ${
            open ? "opacity-100" : "opacity-0 group-hover/hd:opacity-100"
          }`}
        >
          ▾
        </button>
        {key !== "name" && (
          <span
            onMouseDown={(e) => gripMouseDown(e, key)}
            title="ドラッグで列幅を変更"
            className="absolute top-0 -right-1.5 bottom-0 z-10 w-3 cursor-col-resize hover:bg-blue-300"
          />
        )}
        {key === "name" && (
          <span
            onMouseDown={(e) => gripMouseDown(e, key)}
            title="ドラッグで列幅を変更"
            className="absolute top-0 -right-1.5 bottom-0 z-10 w-3 cursor-col-resize hover:bg-blue-300"
          />
        )}
        {open && (
          <div className="absolute top-full left-0 z-40 mt-1 w-60 rounded-lg border bg-white py-1 text-sm shadow-lg">
            {key !== "name" && (
              <>
                <div className={menuLabel}>列を移動</div>
                <div className="flex gap-1 px-3 pb-1">
                  <button
                    disabled={visibleCols[0] === key}
                    onClick={() => moveCol(key, -1)}
                    className="rounded border px-2 py-0.5 text-xs hover:bg-neutral-100 disabled:opacity-40"
                  >
                    ← 左へ
                  </button>
                  <button
                    disabled={visibleCols[visibleCols.length - 1] === key}
                    onClick={() => moveCol(key, 1)}
                    className="rounded border px-2 py-0.5 text-xs hover:bg-neutral-100 disabled:opacity-40"
                  >
                    右へ →
                  </button>
                </div>
              </>
            )}
            {sortable && (
              <>
                <div className={menuLabel}>ソート</div>
                <button className={menuItem} onClick={() => { applySort(key as "name" | "due" | "progress", "asc"); setMenuCol(null); }}>
                  {key === "due" ? "期日の近い順（昇順）" : "昇順"}
                </button>
                <button className={menuItem} onClick={() => { applySort(key as "name" | "due" | "progress", "desc"); setMenuCol(null); }}>
                  {key === "due" ? "期日の遠い順（降順）" : "降順"}
                </button>
                <button className={menuItem} onClick={() => { clearSort(); setMenuCol(null); }}>
                  ソートをクリア
                </button>
              </>
            )}
            {key === "assignee" && (
              <>
                <div className={menuLabel}>フィルター</div>
                <button className={menuItem} onClick={() => { applyAssigneeFilter(""); setMenuCol(null); }}>
                  すべて（解除）
                </button>
                <button className={menuItem} onClick={() => { applyAssigneeFilter("none"); setMenuCol(null); }}>
                  未割当
                </button>
                {users.map((u) => (
                  <button key={u.id} className={menuItem} onClick={() => { applyAssigneeFilter(String(u.id)); setMenuCol(null); }}>
                    {u.name}
                    {assigneeFilter === String(u.id) ? " ✓" : ""}
                  </button>
                ))}
              </>
            )}
            {key === "due" && (
              <>
                <div className={menuLabel}>フィルター</div>
                {[
                  ["", "すべて（解除）"],
                  ["overdue", "期限切れ"],
                  ["today", "今日"],
                  ["week", "今週"],
                  ["nextweek", "来週"],
                  ["month", "今月"],
                ].map(([v, l]) => (
                  <button key={v} className={menuItem} onClick={() => { applyDueFilter(v); setMenuCol(null); }}>
                    {l}
                    {dueFilter === v && v !== "" ? " ✓" : ""}
                  </button>
                ))}
              </>
            )}
            {key === "status" && (
              <>
                <div className={menuLabel}>フィルター</div>
                <button className={menuItem} onClick={() => { applyStatusFilter(""); setMenuCol(null); }}>
                  すべて（解除）
                </button>
                {statusOptions.map((st) => (
                  <button key={st} className={menuItem} onClick={() => { applyStatusFilter(st); setMenuCol(null); }}>
                    {st}
                    {statusFilter === st ? " ✓" : ""}
                  </button>
                ))}
                {editingStatusOpts ? (
                  <div className="px-3 py-2">
                    <div className={menuLabel + " pt-0"}>Statusの選択肢を編集</div>
                    <input
                      value={statusOptsDraft}
                      onChange={(e) => setStatusOptsDraft(e.target.value)}
                      placeholder="未着手,進行中,Done"
                      className="mb-1 w-full rounded border px-2 py-1 text-[13px] outline-none focus:border-blue-500"
                    />
                    <div className="flex gap-1">
                      <button onClick={saveStatusOpts} className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700">
                        保存
                      </button>
                      <button onClick={() => setEditingStatusOpts(false)} className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100">
                        キャンセル
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className={menuItem}
                    onClick={() => {
                      setEditingStatusOpts(true);
                      setStatusOptsDraft(statusOptions.join(","));
                    }}
                  >
                    Statusの選択肢を編集
                  </button>
                )}
                <button
                  className={menuItem}
                  onClick={() => {
                    setStatusHidden(true);
                    setMenuCol(null);
                  }}
                >
                  列を非表示
                </button>
              </>
            )}
            {field && (
              <>
                {field.field_type === "select" && (
                  <>
                    <div className={menuLabel}>フィルター</div>
                    <button
                      className={menuItem}
                      onClick={() => {
                        setCustomFilter((m) => ({ ...m, [field.id]: "" }));
                        setMenuCol(null);
                      }}
                    >
                      すべて（解除）
                    </button>
                    {field.options.map((o) => (
                      <button
                        key={o}
                        className={menuItem}
                        onClick={() => {
                          setCustomFilter((m) => ({ ...m, [field.id]: o }));
                          setMenuCol(null);
                        }}
                      >
                        {o}
                        {customFilter[field.id] === o ? " ✓" : ""}
                      </button>
                    ))}
                  </>
                )}
                {editingField === field.id ? (
                  <div className="px-3 py-2">
                    <div className={menuLabel + " pt-0"}>フィールドを編集</div>
                    <input
                      value={editFieldName}
                      onChange={(e) => setEditFieldName(e.target.value)}
                      placeholder="フィールド名"
                      className="mb-1 w-full rounded border px-2 py-1 text-[13px] outline-none focus:border-blue-500"
                    />
                    {field.field_type === "select" && (
                      <input
                        value={editFieldOptions}
                        onChange={(e) => setEditFieldOptions(e.target.value)}
                        placeholder="選択肢（カンマ区切り）"
                        className="mb-1 w-full rounded border px-2 py-1 text-[13px] outline-none focus:border-blue-500"
                      />
                    )}
                    <div className="flex gap-1">
                      <button onClick={saveFieldEdit} className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700">
                        保存
                      </button>
                      <button onClick={() => setEditingField(null)} className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100">
                        キャンセル
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className={menuItem} onClick={() => startEditField(field)}>
                    フィールドを編集
                  </button>
                )}
                <button
                  className={menuItem}
                  onClick={() => {
                    setHiddenCols((prev) => new Set(prev).add(field.id));
                    setMenuCol(null);
                  }}
                >
                  列を非表示
                </button>
                <button className={menuItem + " text-red-600 hover:bg-red-50"} onClick={() => { removeField(field); setMenuCol(null); }}>
                  列を削除
                </button>
              </>
            )}
          </div>
        )}
      </span>
    );
  };
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

  const statusChip = (st: string) => {
    const base = "inline-block rounded-full px-2 py-0.5 text-xs";
    if (st === "Done") return `${base} bg-green-100 text-green-800`;
    if (st === "進行中") return `${base} bg-blue-100 text-blue-800`;
    if (st === "未着手") return `${base} bg-neutral-100 text-neutral-500`;
    return `${base} bg-neutral-100 text-neutral-600`;
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
    const res = await fetch(`/api/tasks/${dragId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fields, expected_updated_at: dragged.updated_at }),
    });
    if (res.status === 409) {
      alert("他のユーザーが先に更新しました。最新を表示します。");
    } else if (!res.ok) {
      alert(`移動に失敗しました: ${res.status}`);
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
    const res = await fetch(`/api/tasks/${dragId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fields, expected_updated_at: dragged.updated_at }),
    });
    if (res.status === 409) {
      alert("他のユーザーが先に更新しました。最新を表示します。");
    } else if (!res.ok) {
      alert(`移動に失敗しました: ${res.status}`);
    }
    refresh();
  };

  const renderRow = (t: TaskRow, depth = 0) => {
    const overdue = !t.completed && t.due_on !== null && t.due_on < today;
    const isToday = !t.completed && t.due_on !== null && t.due_on === today;
    return (
    <Fragment key={t.id}>
    <div
      draggable
      onDragStart={(e) => {
        dragging.current = true;
        e.dataTransfer.setData("text/atlas-task", String(t.id));
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => {
        setTimeout(() => {
          dragging.current = false;
        }, 0);
      }}
      onClick={(e) => rowClick(e, t.id)}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setHint({ id: t.id, before: e.clientY < rect.top + rect.height / 2 });
      }}
      onDragLeave={() => setHint(null)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setHint(null);
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        const dragId = Number(e.dataTransfer.getData("text/atlas-task"));
        if (dragId) moveTask(dragId, t, before);
      }}
      className={`group grid min-h-[37px] cursor-pointer items-center divide-x divide-[#eaeaea] border-b border-[#eaeaea] px-2 py-1.5 text-sm ${
        t.id === activeTaskId ? "bg-[#eff4fd]" : "hover:bg-neutral-50"
      } ${
        dropHint?.id === t.id
          ? dropHint.before
            ? "shadow-[inset_0_2px_0_0_#3b82f6]"
            : "shadow-[inset_0_-2px_0_0_#3b82f6]"
          : ""
      }`}
      style={{ gridTemplateColumns: gridCols }}
    >
      <span className="flex items-center justify-self-center">
        <span
          title="ドラッグで並替え（ホバーで表示）"
          className="cursor-grab text-neutral-300 opacity-0 group-hover:opacity-100 hover:text-neutral-500 active:cursor-grabbing"
        >
          ⋮⋮
        </span>
      </span>
      <div className={`flex min-w-0 items-center gap-1.5 ${depth > 0 ? "pl-7" : ""}`}>
        {(subtaskMap[t.id] ?? []).length > 0 ? (
          <button
            onClick={() => toggleExpand(t.id)}
            title={expanded.has(t.id) ? "サブタスクを閉じる" : "サブタスクを開く"}
            className="w-4 shrink-0 text-center text-xs text-neutral-400 hover:text-black"
          >
            {expanded.has(t.id) ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          onClick={() => toggle(t)}
          title={t.completed ? "未完了に戻す" : "完了にする"}
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] ${
            t.completed ? "border-green-600 bg-green-600 text-white" : "border-neutral-300 text-neutral-300 hover:border-green-600"
          }`}
        >
          ✓
        </button>
        {editing?.id === t.id && editing.field === "name" ? (
          <input
            autoFocus
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onBlur={(e) => commitEdit(t, "name", (e.target as HTMLInputElement).value)}
            onFocus={(e) => (e.target as HTMLInputElement).select()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                const el = e.target as HTMLInputElement;
                el.blur();
                setEditing(null);
              }
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full min-w-0 rounded border border-blue-500 bg-white px-1 py-0.5 text-sm outline-none"
          />
        ) : (
          <span
            onClick={(e) => openEdit(e, t, "name", t.name)}
            title="クリックで名前を編集（行の他部分は詳細を開く）"
            className="w-fit max-w-full min-w-0 flex-none cursor-text truncate rounded hover:bg-neutral-100"
          >
            {t.name}
          </span>
        )}
        {t.recurrence && t.recurrence !== "none" && (
          <span title="繰り返しタスク" className="shrink-0 text-xs text-neutral-400">
            ↻
          </span>
        )}
        <span className="ml-1 flex items-center gap-2 text-[11px] text-neutral-400">
          {t.subtask_count > 0 && (
            <span className="flex items-center gap-0.5" title="サブタスク">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.2">
                <path d="M4 3v4.5a2 2 0 0 0 2 2h6" />
                <path d="M9.5 7.5 12 9.5 9.5 11.5" />
              </svg>
              {t.subtask_count}
            </span>
          )}
          {t.comment_count > 0 && (
            <span className="flex items-center gap-0.5" title="コメント">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.2">
                <path d="M3 3.5h10v7H7.5L4.5 13v-2.5H3z" />
              </svg>
              {t.comment_count}
            </span>
          )}
        </span>
      </div>
      {editing?.id === t.id && editing.field === "assignee" ? (
        <select
          style={{ order: visibleCols.indexOf("assignee") }}
          autoFocus
          value={editVal}
          onChange={(e) => commitEdit(t, "assignee", e.target.value)}
          onBlur={cancelEdit}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancelEdit();
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-full min-w-0 cursor-pointer rounded border border-blue-500 bg-white px-1 py-0.5 text-[13px] outline-none"
        >
          <option value="">–</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      ) : (
        <span
          onClick={(e) => openEdit(e, t, "assignee", t.assignee_id === null ? "" : String(t.assignee_id))}
          title="クリックで編集"
          style={{ order: visibleCols.indexOf("assignee") }}
          className="flex min-w-0 cursor-pointer items-center gap-1.5 truncate rounded text-neutral-600 hover:bg-neutral-100"
        >
          {t.assignee_name && (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-400 text-[10px] font-bold text-white">
              {t.assignee_name.slice(0, 1)}
            </span>
          )}
          <span className="truncate">{t.assignee_name ?? ""}</span>
        </span>
      )}
      {editing?.id === t.id && editing.field === "due" ? (
        <span style={{ order: visibleCols.indexOf("due") }} className="relative">
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">編集中…</span>
          <div
            className="absolute top-full left-0 z-40 mt-1 w-60 rounded-lg border bg-white p-3 text-sm shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <label className="block text-xs text-neutral-500">
              開始日
              <input
                type="date"
                value={editStart}
                onChange={(e) => setEditStart(e.target.value)}
                className="mt-0.5 w-full rounded border px-2 py-1 text-sm outline-none focus:border-blue-500"
              />
            </label>
            <label className="mt-2 block text-xs text-neutral-500">
              期日
              <input
                type="date"
                value={editVal}
                onChange={(e) => setEditVal(e.target.value)}
                className="mt-0.5 w-full rounded border px-2 py-1 text-sm outline-none focus:border-blue-500"
              />
            </label>
            <div className="mt-2 flex gap-1">
              <button
                onClick={() => commitDueEdit(t)}
                className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
              >
                保存
              </button>
              <button
                onClick={() => {
                  setEditStart("");
                  setEditVal("");
                  commitDueEdit(t, true);
                }}
                title="開始日と期日をクリア"
                className="rounded border px-2 py-1 text-xs hover:bg-neutral-100"
              >
                クリア
              </button>
              <button onClick={cancelEdit} className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100">
                キャンセル
              </button>
            </div>
          </div>
        </span>
      ) : (
        <span onClick={(e) => openDueEdit(e, t)} style={{ order: visibleCols.indexOf("due") }}
          title="クリックで編集" className="cursor-pointer rounded px-1 py-0.5 hover:bg-neutral-100">
          {t.start_on || t.due_on ? (
            (() => {
              const [s1, s2] = dueSegs(t.start_on, t.due_on);
              return (
                <span
                  className={`whitespace-nowrap text-[12px] ${
                    overdue ? "font-medium text-red-600" : isToday ? "text-green-700" : "text-neutral-600"
                  }`}
                >
                  {s1}
                  {s2 && ` – ${s2}`}
                </span>
              );
            })()
          ) : (
            <button
              onClick={(e) => openDueEdit(e, t)}
              title="期日を設定"
              className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-neutral-300 text-[11px] leading-none text-neutral-300 hover:border-neutral-500 hover:text-neutral-500"
            >
              ＋
            </button>
          )}
        </span>
      )}
      {editing?.id === t.id && editing.field === "progress" ? (
        <input
          autoFocus
          style={{ order: visibleCols.indexOf("progress") }}
          type="number"
          min={0}
          max={100}
          value={editVal}
          onChange={(e) => setEditVal(e.target.value)}
          onBlur={(e) => commitEdit(t, "progress", (e.target as HTMLInputElement).value)}
          onFocus={(e) => (e.target as HTMLInputElement).select()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              const el = e.target as HTMLInputElement;
              el.blur();
              setEditing(null);
            }
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          onClick={(e) => e.stopPropagation()}
          className={editInputCls}
        />
      ) : (
        <span
          onClick={(e) => openEdit(e, t, "progress", String(t.progress))}
          title="クリックで編集"
          style={{ order: visibleCols.indexOf("progress") }}
          className="flex min-h-5 cursor-pointer items-center gap-1.5 rounded hover:bg-neutral-100"
        >
          {t.progress > 0 ? (
            <>
              <span className="h-1.5 w-16 overflow-hidden rounded bg-neutral-200">
                <span className="block h-full rounded bg-green-500" style={{ width: `${t.progress}%` }} />
              </span>
              <span className="text-xs text-neutral-500">{t.progress}%</span>
            </>
          ) : null}
        </span>
      )}
      {!statusHidden && (
        editing?.id === t.id && editing.field === "status" ? (
          <select
          style={{ order: visibleCols.indexOf("status") }}
            autoFocus
            value={editVal}
            onChange={(e) => commitEdit(t, "status", e.target.value)}
            onBlur={cancelEdit}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancelEdit();
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full min-w-0 cursor-pointer rounded border border-blue-500 bg-white px-1 py-0.5 text-[13px] outline-none"
          >
            {!statusOptions.includes(editVal) && <option value={editVal}>{editVal}</option>}
            {statusOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <span
            onClick={(e) => openEdit(e, t, "status", t.status)}
            title="クリックで編集"
            style={{ order: visibleCols.indexOf("status") }}
            className="min-h-5 cursor-pointer truncate rounded hover:bg-neutral-100"
          >
            {t.status && t.status !== "inbox" ? (
              <span className={statusChip(t.status)}>{t.status}</span>
            ) : null}
          </span>
        )
      )}
      {shownFields.map((f) =>
        editing?.id === t.id && editing.field === `cf-${f.id}` ? (
          f.field_type === "select" ? (
            <select
            style={{ order: visibleCols.indexOf(`cf-${f.id}`) }}
              key={f.id}
              autoFocus
              value={editVal}
              onChange={(e) => commitEdit(t, `cf-${f.id}`, e.target.value)}
              onBlur={cancelEdit}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelEdit();
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full min-w-0 cursor-pointer rounded border border-blue-500 bg-white px-1 py-0.5 text-[13px] outline-none"
            >
              <option value="">–</option>
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
            style={{ order: visibleCols.indexOf(`cf-${f.id}`) }}
              key={f.id}
              autoFocus
              type={f.field_type === "number" ? "number" : "text"}
              value={editVal}
              onChange={(e) => setEditVal(e.target.value)}
              onBlur={(e) => commitEdit(t, `cf-${f.id}`, (e.target as HTMLInputElement).value)}
              onFocus={(e) => (e.target as HTMLInputElement).select()}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelEdit();
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              onClick={(e) => e.stopPropagation()}
              className={editInputCls}
            />
          )
        ) : (
          <span
            key={f.id}
            onClick={(e) => openEdit(e, t, `cf-${f.id}`, customRaw(t.id, f))}
            title="クリックで編集"
            style={{ order: visibleCols.indexOf(`cf-${f.id}`) }}
            className="cursor-pointer truncate rounded text-neutral-600 hover:bg-neutral-100"
          >
            {formatCustomValue(f, customValues[t.id]?.[f.id])}
          </span>
        ),
      )}
      <button
        style={{ order: 999 }}
        onClick={() => remove(t)}
        className="invisible text-neutral-300 hover:text-red-600 group-hover:visible"
        title="削除"
      >
        ×
      </button>
    </div>
    {expanded.has(t.id) &&
      (subtaskMap[t.id] ?? []).map((st) => (
        <Fragment key={`sub-${st.id}`}>{renderRow(st, 1)}</Fragment>
      ))}
    {expanded.has(t.id) &&
      (subAdding === t.id ? (
        <div className="flex gap-2 py-1 pl-14">
          <input
            value={subDraft}
            onChange={(e) => setSubDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addSubtask(t);
              if (e.key === "Escape") setSubAdding(null);
            }}
            onBlur={() => {
              if (subDraft.trim() === "") setSubAdding(null);
            }}
            placeholder="サブタスク名を入力"
            autoFocus
            className="w-full max-w-md rounded border px-2 py-1 text-sm outline-none focus:border-blue-500"
          />
          <button
            onClick={() => addSubtask(t)}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
          >
            追加
          </button>
        </div>
      ) : (
        <button
          onClick={() => setSubAdding(t.id)}
          className="flex h-9 w-full items-center rounded pr-2 pl-[108px] text-left text-[13px] whitespace-nowrap text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700"
        >
          サブタスクを追加
        </button>
      ))}
    </Fragment>
    );
  };

  const groupHeader = (key: string, name: string, count: number) => {
    const collapsed = collapsedGroups.has(key);
    return (
      <div className="flex h-[50px] items-center gap-3 pl-6">
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
        <span className="text-[16px] leading-6 font-medium text-neutral-900">{name}</span>
        <span className="text-[13px] font-normal text-neutral-400">{count}</span>
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
    <div className="px-4 pb-16">
      <div className="overflow-x-auto">
      <div className="min-w-[860px]">
      <div className="flex flex-wrap items-center gap-1 border-b py-2 text-sm">
        <span className="relative flex">
          <button
            onClick={focusAdd}
            className="flex h-7 items-center gap-1 rounded-l-md border bg-white px-2.5 text-[12px] text-neutral-800 hover:bg-neutral-50"
          >
            <span className="text-[14px] leading-none text-neutral-500">＋</span> タスクを追加
          </button>
          <button
            onClick={toggleAddMenu}
            title="その他の追加方法"
            className="flex h-7 items-center rounded-r-md border border-l-0 bg-white px-1.5 text-neutral-600 hover:bg-neutral-50"
          >
            ▾
          </button>
          {addMenu && (
            <div className="absolute top-full left-0 z-40 mt-1 w-64 rounded-lg border bg-white py-1 text-sm shadow-lg">
              <div className={menuLabel}>テンプレートから作成</div>
              {addTemplates.length === 0 && (
                <div className="px-3 py-1 text-xs text-neutral-400">テンプレートなし</div>
              )}
              {addTemplates.map((t) => (
                <button key={t.id} className={menuItem} onClick={() => instantiateTemplate(t.id)}>
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </span>
        <span className="ml-auto" />
        <span className="relative">
          {activeFilterCount > 0 ? (
            <span className="flex h-7 overflow-hidden rounded-md bg-[#eff4fd] text-[#2C60B8]">
              <button
                onClick={openFilterMenu}
                className="flex items-center pr-1 pl-2 text-[12px] font-medium hover:bg-[#e3edfc]"
              >
                絞り込み: {activeFilterCount}
              </button>
              <button title="絞り込みをクリア" onClick={clearFilters} className={clearPill}>
                ×
              </button>
            </span>
          ) : (
            <button onClick={openFilterMenu} className={toolbarBtn}>
              絞り込み
            </button>
          )}
          {filterOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setFilterOpen(false)} />
              <div className={popoverCls}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-neutral-800">絞り込み</span>
                  {activeFilterCount > 0 && (
                    <button onClick={clearFilters} className="text-[12px] text-[#2C60B8] hover:underline">
                      クリア
                    </button>
                  )}
                </div>
                <label className={checkItem}>
                  <input
                    type="checkbox"
                    checked={hideCompleted}
                    onChange={(e) => {
                      setHideCompleted(e.target.checked);
                      pushState({ hide: e.target.checked });
                    }}
                  />
                  未完了のタスクのみ
                </label>
                <div className="mt-2 px-1.5 text-[11px] font-semibold tracking-wide text-neutral-400">担当者</div>
                <select
                  value={assigneeFilter}
                  onChange={(e) => {
                    setAssigneeFilter(e.target.value);
                    pushState({ assignee: e.target.value });
                  }}
                  className={menuSelect}
                >
                  <option value="">すべて</option>
                  <option value="none">未割当</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                <div className="mt-2 px-1.5 text-[11px] font-semibold tracking-wide text-neutral-400">期日</div>
                <select
                  value={dueFilter}
                  onChange={(e) => {
                    setDueFilter(e.target.value);
                    pushState({ due: e.target.value });
                  }}
                  className={menuSelect}
                >
                  <option value="">すべて</option>
                  <option value="overdue">期限切れ</option>
                  <option value="today">今日</option>
                  <option value="week">今週</option>
                  <option value="nextweek">来週</option>
                  <option value="month">今月</option>
                </select>
                <div className="mt-2 px-1.5 text-[11px] font-semibold tracking-wide text-neutral-400">Status</div>
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    pushState({ status: e.target.value });
                  }}
                  className={menuSelect}
                >
                  <option value="">すべて</option>
                  {statusOptions.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </span>
        <span className="relative">
          {sortActive ? (
            <span className="flex h-7 overflow-hidden rounded-md bg-[#eff4fd] text-[#2C60B8]">
              <button
                onClick={openSortMenu}
                className="flex items-center pr-1 pl-2 text-[12px] font-medium hover:bg-[#e3edfc]"
              >
                ソート: 1
              </button>
              <button title="ソートをクリア" onClick={clearAllSort} className={clearPill}>
                ×
              </button>
            </span>
          ) : (
            <button onClick={openSortMenu} className={toolbarBtn}>
              ソート
            </button>
          )}
          {sortOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setSortOpen(false)} />
              <div className={popoverCls}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-neutral-800">並び替え</span>
                  {sortActive && (
                    <button onClick={clearAllSort} className="text-[12px] text-[#2C60B8] hover:underline">
                      クリア
                    </button>
                  )}
                </div>
                {[
                  ["position", "手動"],
                  ["due", "期日"],
                  ["name", "名前"],
                  ["progress", "進捗"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => {
                      if (key === "position") {
                        setSortKey("position");
                        setSortDir("asc");
                        pushState({ sort: "position" });
                      } else {
                        setSortKey(key as "name" | "due" | "progress");
                        setSortDir("asc");
                        pushState({ sort: key, sortdir: "asc" });
                      }
                      setSortOpen(false);
                    }}
                    className={checkItem}
                  >
                    <span className="w-4 text-[#2C60B8]">{sortKey === key ? "✓" : ""}</span>
                    {label}
                  </button>
                ))}
                {sortActive && (
                  <button
                    onClick={() => {
                      const next = sortDir === "asc" ? "desc" : "asc";
                      setSortDir(next);
                      pushState({ sortdir: next });
                    }}
                    className="mt-1 flex w-full items-center justify-between rounded-md border bg-white px-2 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"
                  >
                    <span>{sortDir === "asc" ? "昇順" : "降順"}</span>
                    <span>{sortDir === "asc" ? "↑" : "↓"}</span>
                  </button>
                )}
              </div>
            </>
          )}
        </span>
        <span className="relative">
          <button onClick={openGroupMenu} className={toolbarBtn}>
            グループ
          </button>
          {groupOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setGroupOpen(false)} />
              <div className={popoverCls}>
                <div className="mb-1 text-[13px] font-semibold text-neutral-800">グループ</div>
                {[
                  ["section", "セクション"],
                  ["assignee", "担当者"],
                  ["status", "Status"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => {
                      setGroupBy(key as typeof groupBy);
                      pushState({ group: key });
                      setGroupOpen(false);
                    }}
                    className={checkItem}
                  >
                    <span className="w-4 text-[#2C60B8]">{groupBy === key ? "✓" : ""}</span>
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </span>
        <details className="relative">
          <summary className="flex h-7 cursor-pointer list-none items-center gap-1 rounded-md px-2 text-[12px] font-medium text-neutral-500 hover:bg-neutral-100 [&::-webkit-details-marker]:hidden">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M2 4h12M2 8h12M2 12h12" />
              <circle cx="6" cy="4" r="1.6" fill="white" />
              <circle cx="10" cy="8" r="1.6" fill="white" />
              <circle cx="5" cy="12" r="1.6" fill="white" />
            </svg>
            オプション
          </summary>
          <div className="absolute right-0 z-30 mt-1 w-80 rounded-lg border bg-white p-3 text-sm shadow-lg">
            {saving ? (
              <span className="flex items-center gap-1">
                <input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveView();
                  }}
                  placeholder="ビュー名"
                  autoFocus
                  className="w-32 rounded border px-2 py-0.5 text-sm outline-none focus:border-blue-500"
                />
                <button onClick={saveView} className="rounded bg-blue-600 px-2 py-0.5 text-sm text-white">
                  保存
                </button>
                <button onClick={() => setSaving(false)} className="text-sm text-neutral-500">
                  ×
                </button>
              </span>
            ) : (
              <button onClick={() => setSaving(true)} className="text-sm text-neutral-600 hover:text-black">
                ビューを保存
              </button>
            )}
            <label className="mt-2 flex items-center gap-1 text-neutral-600" title="20秒ごとに自動更新（表示中のみ）">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              自動更新{lastRefresh ? `（${lastRefresh}）` : ""}
            </label>
            <TemplateBar projectId={projectId} sections={sections} users={users} />
          </div>
        </details>
      </div>
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
            <a href={`/projects/${projectId}?view=list`} className="text-neutral-400 hover:text-black">
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
      <div
        className="grid h-[37px] items-center divide-x divide-[#eaeaea] border-b border-[#eaeaea] px-2 text-xs font-normal text-neutral-500"
        style={{ gridTemplateColumns: gridCols }}
      >
        <input
          type="checkbox"
          title="すべて選択/解除"
          checked={visible.length > 0 && visible.every((t) => selected.has(t.id))}
          onChange={() => {
            if (visible.every((t) => selected.has(t.id))) setSelected(new Set());
            else setSelected(new Set(visible.map((t) => t.id)));
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
          className="rounded px-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        >
          ＋
        </button>
      </div>
      {(statusHidden || customFields.some((f) => hiddenCols.has(f.id))) && (
        <div className="flex items-center gap-1 py-1 text-[11px] font-normal text-neutral-400">
          非表示:
          {statusHidden && (
            <button
              onClick={() => setStatusHidden(false)}
              title="Status列を再表示"
              className="rounded-full border px-2 py-0.5 hover:bg-neutral-100 hover:text-neutral-600"
            >
              Statusを再表示
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
            return (
              <div key={gkey}>
                {groupHeader(gk, gkey, items.length)}
                {!collapsed && (
                  <>
                    {items.map((t) => renderRow(t))}
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
                    {items.map((t) => renderRow(t))}
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
          <div className="flex h-[50px] items-center pl-[56px] text-[16px] font-medium text-neutral-500">（セクションなし）</div>
          {(bySection.get(null) ?? []).map((t) => renderRow(t))}
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
        <span className="mx-2 text-neutral-300">|</span>
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
