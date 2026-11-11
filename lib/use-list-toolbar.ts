"use client";

import { useEffect, useState } from "react";
import { api } from "./api-client";
import type { CustomField } from "./custom-fields";
import type { Section, TaskTemplate, User } from "./data";
import type { ListFilters, ListGroupBy, ListSortKey } from "./list-view";
import { confirmAction, toast as toastMessage } from "./ui-feedback";
import { useListFilters } from "./use-list-filters";

type RouterLike = { push: (href: string) => void; refresh: () => void };

/**
 * Owns the list toolbar's menu/filter/sort/group state, saved-view actions,
 * view tab rename/icon updates, and column visibility toggles.
 */
export function useListToolbar({
  projectId,
  router,
  refresh,
  canEdit,
  canSaveView = true,
  viewTabId,
  viewName,
  viewIcon,
  sections,
  users,
  customFields,
  statusFieldName,
  statusFieldEnabled,
  statusOptions,
  focusAdd,
  openFieldAdd,
  onCollapseSubtasks,
  listFilters,
}: {
  projectId: number;
  router: RouterLike;
  refresh: () => void;
  canEdit: boolean;
  canSaveView?: boolean;
  viewTabId: number | null;
  viewName: string;
  viewIcon: string | null;
  sections: Section[];
  users: User[];
  customFields: CustomField[];
  statusFieldName: string;
  statusFieldEnabled: boolean;
  statusOptions: string[];
  focusAdd: () => void;
  openFieldAdd: () => void;
  onCollapseSubtasks: () => void;
  listFilters: ReturnType<typeof useListFilters>;
}) {
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [hiddenCols, setHiddenCols] = useState<Set<number>>(new Set());
  const [hiddenCore, setHiddenCore] = useState<Set<string>>(new Set());
  const [statusHidden, setStatusHidden] = useState(false);
  const [addMenu, setAddMenu] = useState(false);
  const [addTemplates, setAddTemplates] = useState<TaskTemplate[]>([]);

  const {
    hideCompleted,
    setHideCompleted,
    completedOnly,
    setCompletedOnly,
    mineOnly,
    setMineOnly,
    groupBy,
    setGroupBy,
    group2,
    setGroup2,
    groupDir,
    setGroupDir,
    assigneeFilter,
    setAssigneeFilter,
    sortKey,
    setSortKey,
    sortDir,
    setSortDir,
    dueFilter,
    setDueFilter,
    statusFilter,
    setStatusFilter,
    startFilter,
    setStartFilter,
    creatorFilter,
    setCreatorFilter,
    createdFilter,
    setCreatedFilter,
    updatedFilter,
    setUpdatedFilter,
    completedDateFilter,
    setCompletedDateFilter,
    subtasksCollapsed,
    setSubtasksCollapsed,
    pushState,
    setFilter,
  } = listFilters;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(`atlas-listcols-${projectId}:h`) ?? "[]");
        if (Array.isArray(saved)) {
          setHiddenCore(new Set(saved.filter((key): key is string => typeof key === "string")));
        }
      } catch {
        // Ignore malformed saved layout.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [projectId]);

  useEffect(() => {
    try {
      localStorage.setItem(`atlas-listcols-${projectId}:h`, JSON.stringify([...hiddenCore]));
    } catch {
      // Ignore storage failures.
    }
  }, [hiddenCore, projectId]);

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
    if (collapsed) onCollapseSubtasks();
    pushState({ subtasks: collapsed ? "collapsed" : "expanded" });
  };

  const applyDueFilter = (value: string) => {
    setDueFilter(value);
    pushState({ due: value });
  };

  const applyAssigneeFilter = (value: string) => {
    setAssigneeFilter(value);
    pushState({ assignee: value });
  };

  const applyStatusFilter = (value: string) => {
    setStatusFilter(value);
    pushState({ status: value });
  };

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
    pushState({ hide: false, completed: false, mine: false, assignee: "", due: "", status: "", start: "", creator: "", created: "", updated: "", completed_on: "" });
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
    setFilterOpen((value) => !value);
  };

  const openSortMenu = () => {
    setFilterOpen(false);
    setGroupOpen(false);
    setOptionsOpen(false);
    setSortOpen((value) => !value);
  };

  const openGroupMenu = () => {
    setFilterOpen(false);
    setSortOpen(false);
    setOptionsOpen(false);
    setGroupOpen((value) => !value);
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

  const columnOptions = [
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

  const saveView = async () => {
    if (!canSaveView || !saveName.trim()) return;
    const res = await api<{ id: number }>("/api/saved-views", "POST", {
      project_id: projectId,
      name: saveName,
      filters: {
        ...filters,
        sortdir: sortDir,
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
    if (!(await confirmAction("保存ビューを削除しますか？"))) return;
    await api(`/api/saved-views/${id}`, "DELETE");
    router.push(`/projects/${projectId}?view=list`);
  };

  const toggleAddMenu = async () => {
    if (!addMenu) {
      const res = await fetch(`/api/task-templates?project_id=${projectId}`);
      if (res.ok) setAddTemplates((await res.json()) as TaskTemplate[]);
    }
    setAddMenu(!addMenu);
  };

  const instantiateTemplate = async (id: number) => {
    await api(`/api/task-templates/${id}`, "POST", {});
    setAddMenu(false);
    refresh();
  };

  return {
    hiddenCols,
    setHiddenCols,
    hiddenCore,
    setHiddenCore,
    statusHidden,
    setStatusHidden,
    cycleSort,
    sortMark,
    applySort,
    clearSort,
    applyDueFilter,
    applyAssigneeFilter,
    applyStatusFilter,
    deleteSavedView,
    toolbarProps: {
      projectId,
      sections,
      users,
      statusFieldEnabled,
      statusFieldName,
      statusOptions,
      customFields,
      focusAdd,
      toggleAddMenu,
      addMenu,
      addTemplates,
      instantiateTemplate,
      activeFilterCount,
      openFilterMenu,
      clearFilters,
      filterOpen,
      setFilterOpen,
      filters,
      onFilterChange: setFilter,
      sortOpen,
      setSortOpen,
      openSortMenu,
      clearAllSort,
      sortKey,
      sortDir,
      applySortKey,
      toggleSortDir,
      groupOpen,
      setGroupOpen,
      openGroupMenu,
      groupBy,
      group2,
      groupDir,
      applyGroupBy,
      applyGroup2,
      clearGroup2,
      applyGroupDir,
      clearGroup,
      saving,
      setSaving,
      saveName,
      setSaveName,
      saveView,
      canSaveView,
      optionsOpen,
      setOptionsOpen,
      viewName,
      viewIcon,
      viewTabId,
      canEdit,
      renameView,
      updateViewIcon,
      subtasksCollapsed,
      toggleSubtasksCollapsed: changeSubtasksCollapsed,
      columns: columnOptions,
      onToggleColumn: toggleColumn,
      openFieldAdd,
    },
  };
}
