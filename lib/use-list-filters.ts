"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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

export type ListFilterInitial = {
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
}: {
  projectId: number;
  initial: ListFilterInitial;
  statusFieldEnabled: boolean;
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

  const pushState = (patch: PushPatch) => {
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
