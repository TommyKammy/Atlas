"use client";

import { api } from "./api-client";
import { patchTask } from "./task-client";
import { toast } from "./ui-feedback";

/** Task mutations shared by the task pane and the context menu. */
export async function duplicateTask(taskId: number): Promise<void> {
  await api(`/api/tasks/${taskId}/duplicate`, "POST");
}

export async function createFollowUpTask(taskId: number): Promise<void> {
  await api(`/api/tasks/${taskId}/follow-up`, "POST");
}

export async function deleteTask(taskId: number): Promise<void> {
  await api(`/api/tasks/${taskId}`, "DELETE");
}

export async function convertTask(
  taskId: number,
  fields: { parent_task_id: number | null; is_milestone: boolean },
  expectedUpdatedAt?: string | null,
): Promise<void> {
  await patchTask(taskId, fields, expectedUpdatedAt);
}

export async function resetTimelineRow(
  taskId: number,
  projectId: number,
  expectedUpdatedAt?: string | null,
): Promise<void> {
  await api(`/api/tasks/${taskId}/timeline-row`, "PUT", {
    project_id: projectId,
    row_index: null,
    expected_updated_at: expectedUpdatedAt,
  });
}

/** Copy a task URL, falling back to a prompt when the clipboard is blocked. */
export async function copyTaskLink(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    toast("タスクのリンクをコピーしました");
  } catch {
    window.prompt("タスクのリンク", url);
  }
}
