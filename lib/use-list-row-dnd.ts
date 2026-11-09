"use client";

import { useRef, useState } from "react";
import { ApiError } from "./api-client";
import type { TaskRow } from "./data";
import { positionBetween } from "./order";
import { patchTask, TaskConflictError } from "./task-client";
import { toast as toastMessage } from "./ui-feedback";

export type RowDropHint = { id: number; before: boolean };

/** Row drag/drop state and persistence for list task reordering. */
export function useListRowDnd({
  tasks,
  visible,
  refresh,
}: {
  tasks: TaskRow[];
  visible: TaskRow[];
  refresh: () => void;
}) {
  const dragging = useRef(false);
  const [dropHint, setDropHint] = useState<RowDropHint | null>(null);
  const hintRef = useRef<RowDropHint | null>(null);

  const setHint = (hint: RowDropHint | null) => {
    const previous = hintRef.current;
    if (
      (previous === null) !== (hint === null) ||
      (previous && hint && (previous.id !== hint.id || previous.before !== hint.before))
    ) {
      hintRef.current = hint;
      setDropHint(hint);
    }
  };

  const beginRowDrag = () => {
    dragging.current = true;
  };

  const endRowDrag = () => {
    setTimeout(() => {
      dragging.current = false;
    }, 0);
  };

  const appendToSection = async (dragId: number, sectionId: number | null) => {
    const dragged = tasks.find((task) => task.id === dragId);
    if (!dragged) return;
    const column = visible
      .filter((task) => (task.eff_section_id ?? task.section_id) === sectionId && task.id !== dragId)
      .sort((a, b) => a.position - b.position || a.id - b.id);
    const maxPosition = column.reduce((max, task) => Math.max(max, task.position), 0);
    const fields: Record<string, unknown> = { position: maxPosition + 1000 };
    if ((dragged.eff_section_id ?? dragged.section_id) !== sectionId) {
      fields.section_id = sectionId;
    }
    try {
      await patchTask(dragId, fields, dragged.updated_at);
    } catch (error) {
      if (error instanceof TaskConflictError) {
        toastMessage("他のユーザーが先に更新しました。最新を表示します。");
      } else {
        toastMessage(`移動に失敗しました: ${error instanceof ApiError ? error.status : ""}`);
      }
    }
    refresh();
  };

  const moveTask = async (dragId: number, target: TaskRow, before: boolean) => {
    if (dragId === target.id) return;
    const dragged = tasks.find((task) => task.id === dragId);
    if (!dragged) return;
    const sectionKey = target.eff_section_id ?? target.section_id;
    const column = visible
      .filter((task) => (task.eff_section_id ?? task.section_id) === sectionKey && task.id !== dragId)
      .sort((a, b) => a.position - b.position || a.id - b.id);
    const index = column.findIndex((task) => task.id === target.id);
    const at = before ? index : index + 1;
    const previous = at - 1 >= 0 ? column[at - 1].position : null;
    const next = at < column.length ? column[at].position : null;
    const fields: Record<string, unknown> = { position: positionBetween(previous, next) };
    if ((dragged.eff_section_id ?? dragged.section_id) !== sectionKey) {
      fields.section_id = sectionKey;
    }
    try {
      await patchTask(dragId, fields, dragged.updated_at);
    } catch (error) {
      if (error instanceof TaskConflictError) {
        toastMessage("他のユーザーが先に更新しました。最新を表示します。");
      } else {
        toastMessage(`移動に失敗しました: ${error instanceof ApiError ? error.status : ""}`);
      }
    }
    refresh();
  };

  return {
    dragging,
    dropHint,
    setHint,
    beginRowDrag,
    endRowDrag,
    appendToSection,
    moveTask,
  };
}
