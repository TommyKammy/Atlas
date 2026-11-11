"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LIST_STATE_PARAM, listFilterSearch, normalizeListFilterInitial } from "./list-filter-state";
import {
  parseListDateFilter,
  parseListGroupBy,
  parseListSortKey,
  type ListDateFilter,
  type ListFilters,
  type ListGroupBy,
  type ListSortKey,
} from "./list-view";
import { usePersistedViewState } from "./view-state-client";

export type { ListFilterInitial } from "./list-filter-state";
import type { ListFilterInitial } from "./list-filter-state";

type PushPatch = {
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
};

/**
 * Owns the list view's filter/sort/group state and mirrors it into the URL
 * and the per-user persisted view state. Keeping it out of ListView makes
 * the toolbar and row rendering independent from filter bookkeeping.
 */
export function useListFilters({
  projectId,
  initial,
  statusFieldEnabled,
  persistViewState = true,
  activeSavedId = null,
}: {
  projectId: number;
  initial: ListFilterInitial;
  statusFieldEnabled: boolean;
  persistViewState?: boolean;
  activeSavedId?: number | null;
}) {
  const router = useRouter();
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

  const source = normalizeListFilterInitial(initial, statusFieldEnabled);
  const sourceKey = JSON.stringify([activeSavedId, source]);
  const [previousSourceKey, setPreviousSourceKey] = useState(sourceKey);
  if (previousSourceKey !== sourceKey) {
    // Reset only the conditions; task drafts, selection and row editors stay mounted.
    setPreviousSourceKey(sourceKey);
    setHideCompleted(source.hide_completed);
    setCompletedOnly(source.completed_only);
    setMineOnly(source.mine_only);
    setAssigneeFilter(source.assignee);
    setStatusFilter(source.status);
    setDueFilter(source.due);
    setStartFilter(source.start);
    setCreatorFilter(source.creator);
    setCreatedFilter(source.created);
    setUpdatedFilter(source.updated);
    setCompletedDateFilter(source.completed_on);
    setSortKey(source.sort);
    setSortDir(source.sortdir);
    setGroupBy(source.group);
    setGroup2(source.group2);
    setGroupDir(source.groupdir);
    setSubtasksCollapsed(source.subtasks_collapsed);
  }

  const pendingSnapshotHref = useRef<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (!persistViewState || q.has("dashboard") || q.has("saved") || q.get(LIST_STATE_PARAM) === "1") {
      pendingSnapshotHref.current = null;
      return;
    }
    // Freeze this entry through the router so the server search/tree snapshot
    // agrees with later refreshes. The list and its input drafts stay mounted.
    const search = listFilterSearch(q.toString(), normalizeListFilterInitial(initial, statusFieldEnabled));
    const href = `${window.location.pathname}?${search}${window.location.hash}`;
    if (pendingSnapshotHref.current === href) return;
    pendingSnapshotHref.current = href;
    router.replace(href, { scroll: false });
  }, [router, projectId, persistViewState, initial, statusFieldEnabled]);

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
  }, { enabled: persistViewState });

  const pushState = (patch: PushPatch) => {
    const state = normalizeListFilterInitial({
      hide_completed: patch.hide ?? hideCompleted,
      completed_only: patch.completed ?? completedOnly,
      mine_only: patch.mine ?? mineOnly,
      assignee: patch.assignee ?? assigneeFilter,
      status: patch.status ?? statusFilter,
      sort: patch.sort ?? sortKey,
      sortdir: patch.sortdir ?? sortDir,
      due: patch.due ?? dueFilter,
      start: patch.start ?? startFilter,
      creator: patch.creator ?? creatorFilter,
      created: patch.created ?? createdFilter,
      updated: patch.updated ?? updatedFilter,
      completed_on: patch.completed_on ?? completedDateFilter,
      group: patch.group ?? groupBy,
      group2: (patch.group2 !== undefined ? patch.group2 : group2) ?? "",
      groupdir: patch.groupdir ?? groupDir,
      subtasks_collapsed: patch.subtasks ? patch.subtasks === "collapsed" : subtasksCollapsed,
    }, statusFieldEnabled);
    const search = listFilterSearch(window.location.search, state);
    router.push(`/projects/${projectId}?${search}`);
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

  return {
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
  };
}
