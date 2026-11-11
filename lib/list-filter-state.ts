import { parseListDateFilter, parseListGroupBy, parseListSortKey } from "./list-view";
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

/** A history entry is a complete snapshot; missing values mean defaults. */
export const LIST_STATE_PARAM = "list_state";

export function normalizeListFilterInitial(initial: ListFilterInitial, statusFieldEnabled: boolean) {
  return {
    hide_completed: initial.hide_completed === true,
    completed_only: initial.completed_only === true,
    mine_only: initial.mine_only === true,
    assignee: initial.assignee ?? "",
    status: initial.status ?? "",
    due: initial.due ?? "",
    start: parseListDateFilter(initial.start),
    creator: initial.creator ?? "",
    created: parseListDateFilter(initial.created),
    updated: parseListDateFilter(initial.updated),
    completed_on: parseListDateFilter(initial.completed_on),
    sort: parseListSortKey(initial.sort),
    sortdir: initial.sortdir === "desc" ? "desc" as const : "asc" as const,
    group: parseListGroupBy(initial.group, statusFieldEnabled),
    group2: initial.group2 ? parseListGroupBy(initial.group2, statusFieldEnabled) : null,
    groupdir: initial.groupdir === "desc" ? "desc" as const : "asc" as const,
    subtasks_collapsed: initial.subtasks_collapsed === true,
  };
}

export type ListFilterState = ReturnType<typeof normalizeListFilterInitial>;

/** Preserve the task, tab and dashboard selection while replacing list conditions. */
export function listFilterSearch(search: string, state: ListFilterState): string {
  const q = new URLSearchParams(search);
  q.set("view", "list");
  q.set(LIST_STATE_PARAM, "1");
  q.delete("saved");
  for (const key of ["hide", "completed", "mine", "assignee", "status", "due", "start", "creator", "created", "updated", "completed_on", "sort", "sortdir", "group", "group2", "groupdir", "subtasks"]) q.delete(key);
  if (state.hide_completed) q.set("hide", "1");
  if (state.completed_only) q.set("completed", "done");
  if (state.mine_only) q.set("mine", "1");
  for (const key of ["assignee", "status", "due", "start", "creator", "created", "updated", "completed_on"] as const) {
    if (state[key] !== "") q.set(key, state[key]);
  }
  if (state.sort !== "position") q.set("sort", state.sort);
  if (state.sortdir === "desc") q.set("sortdir", "desc");
  if (state.group !== "section") q.set("group", state.group);
  if (state.group2 && state.group2 !== state.group) q.set("group2", state.group2);
  if (state.groupdir === "desc") q.set("groupdir", "desc");
  if (state.subtasks_collapsed) q.set("subtasks", "collapsed");
  return q.toString();
}
