"use client";

import { Fragment, type Dispatch, type SetStateAction } from "react";
import type { ColumnFunction, CustomField } from "@/lib/custom-fields";
import type { User } from "@/lib/data";
import ListColumnHeader from "./ListColumnHeader";

/** All header cells for the list table (name + visible columns). */
export default function ListColumnHeaders({
  layout,
  sort,
  filters,
  fields,
}: {
  layout: {
    visibleCols: string[];
    menuCol: string | null;
    setMenuCol: (key: string | null) => void;
    colDropOver: string | null;
    colDropSide: "before" | "after" | null;
    colDragging: string | null;
    gripMouseDown: (event: React.MouseEvent, key: string) => void;
    moveCol: (key: string, delta: -1 | 1) => void;
    startColumnDrag: (event: React.DragEvent, key: string, label: string) => void;
    dragOverColumn: (event: React.DragEvent, key: string) => void;
    dragLeaveColumn: (event: React.DragEvent, key: string) => void;
    dropColumn: (event: React.DragEvent, key: string) => void;
    endColumnDrag: () => void;
  };
  sort: {
    cycleSort: (key: "name" | "due" | "progress") => void;
    sortMark: (key: "name" | "due" | "progress") => string;
    applySort: (key: "name" | "due" | "progress", dir: "asc" | "desc") => void;
    clearSort: () => void;
  };
  filters: {
    applyAssigneeFilter: (value: string) => void;
    assigneeFilter: string;
    users: User[];
    applyDueFilter: (value: string) => void;
    dueFilter: string;
    statusFieldEnabled: boolean;
    statusOptions: string[];
    statusFilter: string;
    applyStatusFilter: (value: string) => void;
    statusFieldName: string;
    setStatusHidden: Dispatch<SetStateAction<boolean>>;
    customFilter: Record<number, string>;
    setCustomFilter: Dispatch<SetStateAction<Record<number, string>>>;
  };
  fields: {
    customFields: CustomField[];
    onEditField: (field: CustomField) => void;
    setColumnFunction: (field: CustomField, fn: ColumnFunction) => Promise<void>;
    toggleSubtaskTotals: (field: CustomField) => Promise<void>;
    setHiddenCols: Dispatch<SetStateAction<Set<number>>>;
    removeField: (field: CustomField) => Promise<void>;
  };
}) {
  const headerCell = (key: string, label: string, field?: CustomField) => (
    <ListColumnHeader
      key={key}
      columnKey={key}
      label={label}
      field={field}
      menuCol={layout.menuCol}
      setMenuCol={layout.setMenuCol}
      colDropOver={layout.colDropOver}
      colDropSide={layout.colDropSide}
      colDragging={layout.colDragging}
      gripMouseDown={layout.gripMouseDown}
      visibleCols={layout.visibleCols}
      moveCol={layout.moveCol}
      startColumnDrag={layout.startColumnDrag}
      dragOverColumn={layout.dragOverColumn}
      dragLeaveColumn={layout.dragLeaveColumn}
      dropColumn={layout.dropColumn}
      endColumnDrag={layout.endColumnDrag}
      cycleSort={sort.cycleSort}
      sortMark={sort.sortMark}
      applySort={sort.applySort}
      clearSort={sort.clearSort}
      applyAssigneeFilter={filters.applyAssigneeFilter}
      assigneeFilter={filters.assigneeFilter}
      users={filters.users}
      applyDueFilter={filters.applyDueFilter}
      dueFilter={filters.dueFilter}
      statusFieldEnabled={filters.statusFieldEnabled}
      statusOptions={filters.statusOptions}
      statusFilter={filters.statusFilter}
      applyStatusFilter={filters.applyStatusFilter}
      statusFieldName={filters.statusFieldName}
      setStatusHidden={filters.setStatusHidden}
      customFilter={filters.customFilter}
      setCustomFilter={filters.setCustomFilter}
      onEditField={fields.onEditField}
      setColumnFunction={fields.setColumnFunction}
      toggleSubtaskTotals={fields.toggleSubtaskTotals}
      setHiddenCols={fields.setHiddenCols}
      removeField={fields.removeField}
    />
  );

  const headerCellFor = (key: string) => {
    if (key === "assignee") return headerCell(key, "担当者");
    if (key === "due") return headerCell(key, "期日");
    if (key === "progress") return headerCell(key, "進捗");
    if (key === "status") return headerCell(key, filters.statusFieldName);
    const field = fields.customFields.find((item) => `cf-${item.id}` === key);
    return field ? headerCell(key, field.name, field) : null;
  };

  return (
    <>
      {headerCell("name", "名前")}
      {layout.visibleCols.map((key) => (
        <Fragment key={key}>{headerCellFor(key)}</Fragment>
      ))}
    </>
  );
}
