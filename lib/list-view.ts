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
