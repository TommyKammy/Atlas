"use client";

import type { CustomField, CustomValue } from "./custom-fields";
import type { TaskRow, User } from "./data";
import type { TaskRowContext } from "@/components/list/TaskListRow";

/** Builds the large TaskRowContext once, outside ListView's render body. */
export function useListRowContext({
  view,
  dnd,
  editing,
  actions,
}: {
  view: {
    today: string;
    compactCells: string;
    activeTaskId: number | null;
    visibleCols: string[];
    statusFieldEnabled: boolean;
    statusHidden: boolean;
    statusOptions: string[];
    shownFields: CustomField[];
    customFields: CustomField[];
    selected: Set<number>;
    sectionDragging: boolean;
    users: User[];
    subtaskMap: Record<number, TaskRow[]>;
    customValues: Record<number, Record<number, CustomValue>>;
    gridCols: string;
    expanded: Set<number>;
    toggleExpand: (id: number) => void;
    openTask: (id: number) => void;
  };
  dnd: {
    dropHint: { id: number; before: boolean } | null;
    setHint: (hint: { id: number; before: boolean } | null) => void;
    beginRowDrag: () => void;
    endRowDrag: () => void;
    rowClick: (event: React.MouseEvent, id: number) => void;
    moveTask: (dragId: number, target: TaskRow, before: boolean) => Promise<void>;
  };
  editing: {
    editing: { id: number; field: string } | null;
    setEditing: (value: { id: number; field: string } | null) => void;
    editVal: string;
    setEditVal: (value: string) => void;
    editStart: string;
    openEdit: (event: React.MouseEvent, task: TaskRow, field: string, initial: string) => void;
    commitEdit: (task: TaskRow, field: string, value: string) => Promise<void>;
    cancelEdit: () => void;
    openDueEdit: (event: React.MouseEvent, task: TaskRow) => void;
    applyDueRange: (task: TaskRow, start: string, due: string) => Promise<void>;
    editInputCls: string;
  };
  actions: {
    toggle: (task: TaskRow) => Promise<void>;
    subAdding: number | null;
    setSubAdding: (id: number | null) => void;
    subDraft: string;
    setSubDraft: (value: string) => void;
    addSubtask: (task: TaskRow) => Promise<void>;
    remove: (task: TaskRow) => Promise<void>;
    onTimerChange: () => void;
    canEditField: (field: CustomField) => boolean;
    customRaw: (taskId: number, field: CustomField) => string;
  };
}): TaskRowContext {
  return {
    today: view.today,
    compactCells: view.compactCells,
    activeTaskId: view.activeTaskId,
    dropHint: dnd.dropHint,
    setHint: dnd.setHint,
    beginRowDrag: dnd.beginRowDrag,
    endRowDrag: dnd.endRowDrag,
    rowClick: dnd.rowClick,
    moveTask: dnd.moveTask,
    subtaskMap: view.subtaskMap,
    expanded: view.expanded,
    toggleExpand: view.toggleExpand,
    toggle: actions.toggle,
    editing: editing.editing,
    setEditing: editing.setEditing,
    editVal: editing.editVal,
    setEditVal: editing.setEditVal,
    editStart: editing.editStart,
    openEdit: editing.openEdit,
    commitEdit: editing.commitEdit,
    cancelEdit: editing.cancelEdit,
    openDueEdit: editing.openDueEdit,
    applyDueRange: editing.applyDueRange,
    editInputCls: editing.editInputCls,
    users: view.users,
    visibleCols: view.visibleCols,
    statusFieldEnabled: view.statusFieldEnabled,
    statusHidden: view.statusHidden,
    statusOptions: view.statusOptions,
    shownFields: view.shownFields,
    customFields: view.customFields,
    selected: view.selected,
    sectionDragging: view.sectionDragging,
    canEditField: actions.canEditField,
    onTimerChange: actions.onTimerChange,
    customRaw: actions.customRaw,
    customValues: view.customValues,
    subAdding: actions.subAdding,
    setSubAdding: actions.setSubAdding,
    subDraft: actions.subDraft,
    setSubDraft: actions.setSubDraft,
    addSubtask: actions.addSubtask,
    remove: actions.remove,
    gridCols: view.gridCols,
    openTask: view.openTask,
  };
}
