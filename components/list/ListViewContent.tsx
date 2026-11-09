"use client";

import type { ComponentProps, Dispatch, SetStateAction } from "react";
import type { SavedView } from "@/lib/data";
import type { ListGroupBy, ListSortKey } from "@/lib/list-view";
import ListBulkToolbar from "./ListBulkToolbar";
import ListColumnHeaderRow from "./ListColumnHeaderRow";
import ListColumnHeaders from "./ListColumnHeaders";
import ListEmptyState from "./ListEmptyState";
import ListGroups from "./ListGroups";
import ListHiddenColumnsBar from "./ListHiddenColumnsBar";
import ListOverlays from "./ListOverlays";
import ListSectionAdd from "./ListSectionAdd";
import ListToolbar from "./ListToolbar";
import SavedViewsBar from "./SavedViewsBar";

export type ListViewContentProps = {
  view: {
    hideCompleted: boolean;
    completedOnly: boolean;
    mineOnly: boolean;
    sortKey: ListSortKey;
    sortDir: "asc" | "desc";
    groupBy: ListGroupBy;
    group2: ListGroupBy | null;
    groupDir: "asc" | "desc";
    subtasksCollapsed: boolean;
    assigneeFilter: string;
    statusFilter: string;
    dueFilter: string;
    startFilter: string;
    creatorFilter: string;
    createdFilter: string;
    updatedFilter: string;
    completedDateFilter: string;
  };
  toolbar: {
    props: Omit<ComponentProps<typeof ListToolbar>, "autoRefresh" | "setAutoRefresh" | "lastRefresh">;
    autoRefresh: boolean;
    setAutoRefresh: Dispatch<SetStateAction<boolean>>;
    lastRefresh: string | null;
    savedViews: SavedView[];
    activeSavedId: number | null;
    deleteSavedView: (id: number) => Promise<void>;
  };
  bulk: ComponentProps<typeof ListBulkToolbar>;
  columns: {
    headerRow: Omit<ComponentProps<typeof ListColumnHeaderRow>, "headers">;
    headers: ComponentProps<typeof ListColumnHeaders>;
    hidden: ComponentProps<typeof ListHiddenColumnsBar>;
  };
  groups: ComponentProps<typeof ListGroups>;
  sectionAdd: ComponentProps<typeof ListSectionAdd>;
  overlays: ComponentProps<typeof ListOverlays>;
  menuCol: string | null;
  onCloseMenu: () => void;
  editingDue: boolean;
  onCancelEdit: () => void;
  tasksEmpty: boolean;
  focusAdd: () => void;
};

/** Final presentational composition of the list view. */
export default function ListViewContent({
  view,
  toolbar,
  bulk,
  columns,
  groups,
  sectionAdd,
  overlays,
  menuCol,
  onCloseMenu,
  editingDue,
  onCancelEdit,
  tasksEmpty,
  focusAdd,
}: ListViewContentProps) {
  return (
    <div
      className="px-4 pb-16"
      data-list-view
      data-list-hide-completed={view.hideCompleted}
      data-list-completed-only={view.completedOnly}
      data-list-mine-only={view.mineOnly}
      data-list-sort={view.sortKey}
      data-list-sortdir={view.sortDir}
      data-list-group={view.groupBy}
      data-list-group2={view.group2 ?? ""}
      data-list-groupdir={view.groupDir}
      data-list-subtasks-collapsed={view.subtasksCollapsed}
      data-list-assignee={view.assigneeFilter}
      data-list-status={view.statusFilter}
      data-list-due={view.dueFilter}
      data-list-start={view.startFilter}
      data-list-creator={view.creatorFilter}
      data-list-created={view.createdFilter}
      data-list-updated={view.updatedFilter}
      data-list-completed-on={view.completedDateFilter}
    >
      <div className="overflow-x-auto">
        <div className="min-w-[860px]">
          <ListToolbar
            {...toolbar.props}
            autoRefresh={toolbar.autoRefresh}
            setAutoRefresh={toolbar.setAutoRefresh}
            lastRefresh={toolbar.lastRefresh}
          />
          <SavedViewsBar
            projectId={toolbar.props.projectId}
            savedViews={toolbar.savedViews}
            activeSavedId={toolbar.activeSavedId}
            onDelete={toolbar.deleteSavedView}
          />
          {bulk.selectedCount > 0 && <ListBulkToolbar {...bulk} />}
          {menuCol !== null && <div className="fixed inset-0 z-30" onClick={onCloseMenu} />}
          {editingDue && <div className="fixed inset-0 z-30" onClick={onCancelEdit} />}
          {tasksEmpty && <ListEmptyState onAdd={focusAdd} />}
          <ListColumnHeaderRow
            {...columns.headerRow}
            headers={<ListColumnHeaders {...columns.headers} />}
          />
          <ListHiddenColumnsBar {...columns.hidden} />
          <ListGroups {...groups} />
          <ListSectionAdd {...sectionAdd} />
        </div>
      </div>
      <ListOverlays {...overlays} />
    </div>
  );
}
