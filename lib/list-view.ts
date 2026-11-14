import { isQuickTask } from "./quick-task";
export type ListSortKey =
  | "position"
  | "start"
  | "due"
  | "assignee"
  | "creator"
  | "created"
  | "updated"
  | "completed"
  | "likes"
  | "name"
  | "progress"
  | "status"
  | "project";

export const LIST_SORT_LABELS: Record<ListSortKey, string> = {
  position: "手動",
  start: "開始日",
  due: "期日",
  assignee: "担当者",
  creator: "作成したユーザー",
  created: "作成日",
  updated: "最終変更日",
  completed: "完了日",
  likes: "いいね",
  name: "アルファベット順",
  progress: "進捗",
  status: "Status",
  project: "プロジェクト",
};

/** Sort fields shown in the toolbar, in Asana order. */
export const LIST_SORT_OPTIONS: readonly Exclude<ListSortKey, "position">[] = [
  "start",
  "due",
  "assignee",
  "creator",
  "created",
  "updated",
  "completed",
  "likes",
  "name",
  "progress",
  "status",
  "project",
];

export type ListGroupBy =
  | "section"
  | "assignee"
  | "status"
  | "creator"
  | "due"
  | "start"
  | "created"
  | "updated"
  | "completed"
  | "project"
  | `cf-${number}`;

export const LIST_GROUP_LABELS: Record<string, string> = {
  section: "セクション",
  assignee: "担当者",
  status: "Status",
  creator: "作成したユーザー",
  due: "期日",
  start: "開始日",
  created: "作成日",
  updated: "最終変更日",
  completed: "完了日",
  project: "プロジェクト",
};

/** Group fields shown in the toolbar, in Asana order. */
export const LIST_GROUP_OPTIONS: readonly Exclude<ListGroupBy, "section" | `cf-${number}`>[] = [
  "start",
  "due",
  "assignee",
  "creator",
  "created",
  "updated",
  "completed",
  "project",
  "status",
];

export type ListDateFilter = "" | "today" | "7" | "30";

export const LIST_DATE_FILTER_OPTIONS: readonly { value: Exclude<ListDateFilter, "">; label: string }[] = [
  { value: "today", label: "今日" },
  { value: "7", label: "過去7日間" },
  { value: "30", label: "過去30日間" },
];

export type ListFilters = {
  hide_completed: boolean;
  completed_only: boolean;
  mine_only: boolean;
  assignee: string;
  status: string;
  due: string;
  start: ListDateFilter;
  creator: string;
  created: ListDateFilter;
  updated: ListDateFilter;
  completed_on: ListDateFilter;
};

const SORT_KEYS = new Set<string>([
  "position",
  ...LIST_SORT_OPTIONS,
]);

const GROUP_KEYS = new Set<string>(["section", ...LIST_GROUP_OPTIONS]);

export function parseListSortKey(value: unknown): ListSortKey {
  return typeof value === "string" && SORT_KEYS.has(value) ? (value as ListSortKey) : "position";
}

export function parseListGroupBy(value: unknown, statusEnabled: boolean): ListGroupBy {
  if (typeof value !== "string") return "section";
  if (/^cf-\d+$/.test(value)) return value as ListGroupBy;
  if (!GROUP_KEYS.has(value)) return "section";
  if (value === "status" && !statusEnabled) return "section";
  return value as ListGroupBy;
}

export function parseListDateFilter(value: unknown): ListDateFilter {
  return value === "today" || value === "7" || value === "30" ? value : "";
}

export function listDateInRange(value: string | null | undefined, filter: ListDateFilter, today: string): boolean {
  if (filter === "") return true;
  if (!value) return false;
  const day = value.slice(0, 10);
  if (filter === "today") return day === today;
  if (filter === "7") {
    const start = new Date(`${today}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 6);
    return day >= start.toISOString().slice(0, 10) && day <= today;
  }
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 29);
  return day >= start.toISOString().slice(0, 10) && day <= today;
}

export type FilterableTask = {
  completed: boolean;
  assignee_id: number | null;
  status: string;
  created_by: number | null;
  start_on: string | null;
  due_on: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

/** Shared filter predicate for list, board, timeline and calendar views. */
export function taskMatchesListFilters(
  task: FilterableTask,
  filters: ListFilters,
  options: {
    today: string;
    viewerId: number | null;
    statusFieldEnabled: boolean;
    dayOffset: (days: number) => string;
  },
): boolean {
  if (isQuickTask(task)) return true;
  const { today, viewerId, statusFieldEnabled, dayOffset } = options;
  if (filters.completed_only) {
    if (!task.completed) return false;
  } else if (filters.hide_completed && task.completed) {
    return false;
  }
  if (filters.mine_only && (viewerId === null || task.assignee_id !== viewerId)) return false;
  if (
    filters.assignee !== "" &&
    (filters.assignee === "none" ? task.assignee_id !== null : task.assignee_id !== Number(filters.assignee))
  ) {
    return false;
  }
  if (statusFieldEnabled && filters.status !== "" && task.status !== filters.status) return false;
  if (
    filters.creator !== "" &&
    (filters.creator === "none" ? task.created_by !== null : task.created_by !== Number(filters.creator))
  ) {
    return false;
  }
  if (!listDateInRange(task.start_on, filters.start, today)) return false;
  if (!listDateInRange(task.created_at, filters.created, today)) return false;
  if (!listDateInRange(task.updated_at, filters.updated, today)) return false;
  if (!listDateInRange(task.completed_at, filters.completed_on, today)) return false;
  if (filters.due !== "") {
    if (task.due_on === null) return false;
    if (filters.due === "overdue") {
      if (task.due_on >= today) return false;
    } else if (filters.due === "today") {
      if (task.due_on !== today) return false;
    } else if (filters.due === "week") {
      if (task.due_on < today || task.due_on > dayOffset(6)) return false;
    } else if (filters.due === "nextweek") {
      if (task.due_on < dayOffset(7) || task.due_on > dayOffset(13)) return false;
    } else if (task.due_on < today || task.due_on > dayOffset(29)) {
      return false;
    }
  }
  return true;
}

