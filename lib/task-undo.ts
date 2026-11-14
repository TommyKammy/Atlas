"use client";

import { ApiError, api } from "./api-client";
import { toast } from "./ui-feedback";

type TaskUndoEntry = {
  ids: number[];
  onRestored?: () => void;
};

let lastDeletion: TaskUndoEntry | null = null;

/** Remember the latest task deletion so Ctrl/Cmd+Z and the toast can undo it. */
export function rememberTaskDeletion(taskIds: number | number[], onRestored?: () => void): void {
  const ids = (Array.isArray(taskIds) ? taskIds : [taskIds]).filter(
    (id) => Number.isInteger(id) && id > 0,
  );
  if (ids.length === 0) return;
  lastDeletion = { ids: [...new Set(ids)], onRestored };
}

export function hasTaskUndo(): boolean {
  return lastDeletion !== null;
}

/** Restore the latest deleted task or task selection. */
export async function undoLastTaskDeletion(): Promise<boolean> {
  const entry = lastDeletion;
  if (!entry) return false;
  lastDeletion = null;
  const failed: number[] = [];
  for (const id of entry.ids) {
    try {
      await api(`/api/tasks/${id}/restore`, "POST");
    } catch (error) {
      // A parent restore also restores its subtasks, so an already-restored
      // child is a successful outcome rather than a failed undo.
      if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 409)) {
        failed.push(id);
      }
    }
  }
  entry.onRestored?.();
  if (failed.length > 0) {
    lastDeletion = { ids: failed, onRestored: entry.onRestored };
    toast("タスクを復元できませんでした");
    return false;
  }
  toast(entry.ids.length > 1 ? `${entry.ids.length}件のタスクを復元しました` : "タスクを復元しました");
  return true;
}
