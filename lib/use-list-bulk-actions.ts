"use client";

import { useState } from "react";
import { rememberTaskDeletion, undoLastTaskDeletion } from "./task-undo";
import { toast as toastMessage } from "./ui-feedback";

/** Bulk operation state/handlers for the list selection toolbar. */
export function useListBulkActions({
  selected,
  clearSelection,
  refresh,
}: {
  selected: Set<number>;
  clearSelection: () => void;
  refresh: () => void;
}) {
  const [bulkSection, setBulkSection] = useState("");
  const [bulkAssignee, setBulkAssignee] = useState("");

  const bulk = async (op: string, extra?: Record<string, unknown>): Promise<boolean> => {
    if (selected.size === 0) return false;
    try {
      const res = await fetch("/api/tasks/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], op, ...extra }),
      });
      if (!res.ok) throw new Error(`bulk ${op}: ${res.status}`);
      setBulkSection("");
      setBulkAssignee("");
      clearSelection();
      refresh();
      return true;
    } catch {
      toastMessage("一括操作に失敗しました");
      return false;
    }
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    const ids = [...selected];
    if (!(await bulk("delete"))) return;
    rememberTaskDeletion(ids, refresh);
    toastMessage(`${ids.length}件のタスクを削除しました`, {
      actionLabel: "元に戻す",
      action: () => void undoLastTaskDeletion(),
    });
  };

  return {
    bulkSection,
    setBulkSection,
    bulkAssignee,
    setBulkAssignee,
    bulk,
    bulkDelete,
  };
}
