import {
  customFieldDisplay,
  type CustomField,
  type CustomValue,
} from "./custom-fields";
import type { TaskRow, User } from "./data";
import type { ListGroupBy, ListSortKey } from "./list-view";
import { compareListTasks } from "./list-view-model";

export type ListGroupingContext = {
  customFields: CustomField[];
  customValues: Record<number, Record<number, CustomValue>>;
  users: User[];
};

/** Group bucket label used by section, secondary and custom-field groups. */
export function groupKeyFor(task: TaskRow, key: ListGroupBy, context: ListGroupingContext): string {
  if (key === "assignee") return task.assignee_name ?? "（未割当）";
  if (key === "creator") return task.creator_name ?? "（作成者なし）";
  if (key === "status") return task.status || "（未設定）";
  if (key === "due") return task.due_on ?? "（期日なし）";
  if (key === "start") return task.start_on ?? "（開始日なし）";
  if (key === "created") return task.created_at.slice(0, 10);
  if (key === "updated") return task.updated_at.slice(0, 10);
  if (key === "completed") {
    if (!task.completed) return "（未完了）";
    return task.completed_at?.slice(0, 10) ?? "（完了日なし）";
  }
  if (key === "project") return task.project_name ?? "（プロジェクトなし）";
  if (key.startsWith("cf-")) {
    const field = context.customFields.find((item) => `cf-${item.id}` === key);
    if (!field) return "（未設定）";
    const value = customFieldDisplay(
      field,
      context.customValues[task.id]?.[field.id],
      task,
      context.users,
      context.customValues[task.id],
      context.customFields,
    );
    return value === "–" ? "（未設定）" : value;
  }
  return "";
}

export function sortGroupEntries(
  entries: [string, TaskRow[]][],
  groupDir: "asc" | "desc",
): [string, TaskRow[]][] {
  return [...entries].sort(([a], [b]) => {
    if (a.startsWith("（") && !b.startsWith("（")) return 1;
    if (!a.startsWith("（") && b.startsWith("（")) return -1;
    return a.localeCompare(b, "ja") * (groupDir === "asc" ? 1 : -1);
  });
}

/** Build sorted group/subgroup buckets in one pass over the visible tasks. */
export function groupTasks(
  items: TaskRow[],
  key: ListGroupBy,
  context: ListGroupingContext,
  sortKey: ListSortKey,
  sortDir: "asc" | "desc",
  groupDir: "asc" | "desc",
): [string, TaskRow[]][] {
  const map = new Map<string, TaskRow[]>();
  for (const task of items) {
    const groupKey = groupKeyFor(task, key, context);
    if (!map.has(groupKey)) map.set(groupKey, []);
    map.get(groupKey)!.push(task);
  }
  for (const list of map.values()) list.sort((a, b) => compareListTasks(a, b, sortKey, sortDir));
  return sortGroupEntries([...map.entries()], groupDir);
}
