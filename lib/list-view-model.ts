import { isQuickTask } from "./quick-task";
import type { TaskRow } from "./data";
import {
  COLUMN_FUNCTION_LABELS,
  columnFunctionOf,
  customValueToArray,
  customValueToIdArray,
  customValueToInput,
  evaluateFormulaField,
  formatNumberValue,
  isNumericFieldType,
  type CustomField,
  type CustomValue,
} from "./custom-fields";
import { listDateInRange, type ListDateFilter, type ListSortKey } from "./list-view";

export type ListFilterInput = {
  completedOnly: boolean;
  hideCompleted: boolean;
  mineOnly: boolean;
  assigneeFilter: string;
  statusFilter: string;
  statusFieldEnabled: boolean;
  creatorFilter: string;
  startFilter: ListDateFilter;
  createdFilter: ListDateFilter;
  updatedFilter: ListDateFilter;
  completedDateFilter: ListDateFilter;
  dueFilter: string;
  customFilter: Record<number, string>;
  shownFields: CustomField[];
  customValues: Record<number, Record<number, CustomValue>>;
  viewerId: number;
  today: string;
};

export function dayOffset(today: string, days: number): string {
  const todayMs = Date.parse(today);
  return new Date(todayMs + days * 86_400_000).toISOString().slice(0, 10);
}

export function filterListTasks(tasks: TaskRow[], input: ListFilterInput): TaskRow[] {
  const {
    completedOnly,
    hideCompleted,
    mineOnly,
    assigneeFilter,
    statusFilter,
    statusFieldEnabled,
    creatorFilter,
    startFilter,
    createdFilter,
    updatedFilter,
    completedDateFilter,
    dueFilter,
    customFilter,
    shownFields,
    customValues,
    viewerId,
    today,
  } = input;

  return tasks.filter(
    (task) =>
      isQuickTask(task) || (completedOnly ? task.completed : !hideCompleted || !task.completed) &&
      (!mineOnly || task.assignee_id === viewerId) &&
      (assigneeFilter === "" ||
        (assigneeFilter === "none"
          ? task.assignee_id === null
          : task.assignee_id === Number(assigneeFilter))) &&
      (!statusFieldEnabled || statusFilter === "" || task.status === statusFilter) &&
      (creatorFilter === "" ||
        (creatorFilter === "none"
          ? task.created_by === null
          : task.created_by === Number(creatorFilter))) &&
      listDateInRange(task.start_on, startFilter, today) &&
      listDateInRange(task.created_at, createdFilter, today) &&
      listDateInRange(task.updated_at, updatedFilter, today) &&
      listDateInRange(task.completed_at, completedDateFilter, today) &&
      (dueFilter === "" ||
        (task.due_on !== null &&
          (dueFilter === "overdue"
            ? task.due_on < today
            : dueFilter === "today"
              ? task.due_on === today
              : dueFilter === "week"
                ? task.due_on >= today && task.due_on <= dayOffset(today, 6)
                : dueFilter === "nextweek"
                  ? task.due_on >= dayOffset(today, 7) && task.due_on <= dayOffset(today, 13)
                  : task.due_on >= today && task.due_on <= dayOffset(today, 29)))) &&
      shownFields.every((field) => {
        const filter = customFilter[field.id];
        if (!filter) return true;
        const value = customValues[task.id]?.[field.id];
        if (field.field_type === "multi_select") return customValueToArray(value).includes(filter);
        if (field.field_type === "people") {
          return customValueToIdArray(value).map(String).includes(filter);
        }
        return customValueToInput(field, value) === filter;
      }),
  );
}

export function compareListTasks(a: TaskRow, b: TaskRow, sortKey: ListSortKey, sortDir: "asc" | "desc"): number {
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
}

export function numericValueFor(
  field: CustomField,
  values: Record<number, CustomValue> | undefined,
): number | null {
  if (field.field_type === "formula") return evaluateFormulaField(field, values ?? {});
  const value = values?.[field.id]?.value_number;
  return value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
}

export function aggregateListField(
  field: CustomField,
  items: TaskRow[],
  customValues: Record<number, Record<number, CustomValue>>,
  subtaskMap: Record<number, TaskRow[]>,
): { label: string; value: string } | null {
  if (!isNumericFieldType(field.field_type)) return null;
  const fn = columnFunctionOf(field);
  if (fn === "none") return null;
  const values: number[] = [];
  const pushTask = (task: TaskRow) => {
    const value = numericValueFor(field, customValues[task.id]);
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
    return {
      label: COLUMN_FUNCTION_LABELS.count,
      value: formatNumberValue(values.length, { ...field.config, decimals: 0 }),
    };
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
}

export function listFooterTotals(
  fields: CustomField[],
  items: TaskRow[],
  customValues: Record<number, Record<number, CustomValue>>,
  subtaskMap: Record<number, TaskRow[]>,
): Record<number, { label: string; value: string }> {
  const out: Record<number, { label: string; value: string }> = {};
  for (const field of fields) {
    const total = aggregateListField(field, items, customValues, subtaskMap);
    if (total) out[field.id] = total;
  }
  return out;
}
