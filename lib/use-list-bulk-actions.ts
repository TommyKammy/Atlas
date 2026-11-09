"use client";

import { useState } from "react";
import { confirmAction, toast as toastMessage } from "./ui-feedback";

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

  const bulk = async (op: string, extra?: Record<string, unknown>) => {
    if (selected.size === 0) return;
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
    } catch {
      toastMessage("一括操作に失敗しました");
    }
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!(await confirmAction(`${selected.size}件のタスクを削除しますか？`))) return;
    await bulk("delete");
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
