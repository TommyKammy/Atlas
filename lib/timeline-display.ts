import { LIST_ROW_STATE_LABELS, type ListRowState } from "./list-row-state";
import type { TaskTimelineRow } from "./timeline-task-payload";

/**
 * A dependency is drawn on the critical path when both endpoints are part of
 * the computed critical set. The critical-path calculation itself is not
 * touched: this only picks the visual tone for an existing edge.
 */
export function isCriticalDependency(
  edge: { task_id: number; depends_on_id: number },
  critical: ReadonlySet<number>,
): boolean {
  return critical.has(edge.task_id) && critical.has(edge.depends_on_id);
}

/**
 * Accessible name and tooltip for a timeline bar. The existing name, dates,
 * progress and operation summary stay first; the four-state word is appended
 * so the visual circle is never the only carrier of state.
 */
export function timelineBarAriaLabel(
  task: TaskTimelineRow,
  state: ListRowState,
  critical: boolean,
): string {
  const rowLocked = task.timeline_row !== null && task.timeline_row !== undefined;
  const dueState = state === "overdue" ? "・期限超過" : "";
  return `${task.name}（${task.start_on ?? "?"} 〜 ${task.due_on ?? "?"}・進捗${task.progress}%${task.assignee_name ? `・担当${task.assignee_name}` : ""}${rowLocked ? "・行固定" : ""}）${!task.completed && critical ? "【クリティカルパス】" : ""} — 左右で日付移動、上下でセクション・行移動、左右端で期間変更、Alt+上下で行移動、Alt+Shift+上下でセクション移動。状態: ${LIST_ROW_STATE_LABELS[state]}${dueState}`;
}
