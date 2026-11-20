"use client";

import { useRef, type ComponentProps, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { SavedView } from "@/lib/data";
import type { ListGroupBy, ListSortKey } from "@/lib/list-view";
import type { ListTaskSummary } from "@/lib/list-row-state";
import { SectionDraftProvider } from "@/lib/section-draft-context";
import { useClosePaneOnEmptyClick } from "@/lib/use-close-pane-on-empty-click";
import ListBulkToolbar from "./ListBulkToolbar";
import ListColumnHeaderRow from "./ListColumnHeaderRow";
import ListColumnHeaders from "./ListColumnHeaders";
import ListEmptyState from "./ListEmptyState";
import ListGroups from "./ListGroups";
import ListHiddenColumnsBar from "./ListHiddenColumnsBar";
import ListOverlays from "./ListOverlays";
import ListSectionAdd from "./ListSectionAdd";
import ListSummaryLine from "./ListSummaryLine";
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
  sectionDraft: {
    active: boolean;
    atEnd: boolean;
    node: ReactNode | null;
    onStartFromToolbar: () => void;
    onStartAtEnd: () => void;
  };
  overlays: ComponentProps<typeof ListOverlays>;
  summary: ListTaskSummary;
  menuCol: string | null;
  onCloseMenu: () => void;
  editingDue: boolean;
  onCancelEdit: () => void;
  tasksEmpty: boolean;
  emptyState: "project" | "filtered";
  focusAdd: () => void;
};

/** Final presentational composition of the list view. */
export default function ListViewContent({
  view,
  toolbar,
  bulk,
  columns,
  groups,
  sectionDraft,
  overlays,
  summary,
  menuCol,
  onCloseMenu,
  editingDue,
  onCancelEdit,
  tasksEmpty,
  emptyState,
  focusAdd,
}: ListViewContentProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  useClosePaneOnEmptyClick(rootRef, { projectId: toolbar.props.projectId, view: "list" });

  return (
    <SectionDraftProvider start={sectionDraft.onStartFromToolbar}>
    <div
      ref={rootRef}
      className="flex h-full min-h-0 flex-col px-4"
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
      <ListToolbar
        {...toolbar.props}
        autoRefresh={toolbar.autoRefresh}
        setAutoRefresh={toolbar.setAutoRefresh}
        lastRefresh={toolbar.lastRefresh}
      />
      <div data-page-scroll className="min-h-0 flex-1 overflow-auto">
        <div className="min-w-[860px] pb-16">
          <ListSummaryLine summary={summary} />
          <SavedViewsBar
            projectId={toolbar.props.projectId}
            savedViews={toolbar.savedViews}
            activeSavedId={toolbar.activeSavedId}
            onDelete={toolbar.deleteSavedView}
          />
          {bulk.selectedCount > 0 && <ListBulkToolbar {...bulk} />}
          {menuCol !== null && <div data-popover-backdrop className="fixed inset-0 z-30" onClick={onCloseMenu} />}
          {editingDue && <div data-popover-backdrop className="fixed inset-0 z-30" onClick={onCancelEdit} />}
          {tasksEmpty && <ListEmptyState onAdd={focusAdd} mode={emptyState} />}
          <ListColumnHeaderRow
            {...columns.headerRow}
            headers={<ListColumnHeaders {...columns.headers} />}
          />
          <ListHiddenColumnsBar {...columns.hidden} />
          <ListGroups {...groups} />
          {sectionDraft.active && sectionDraft.atEnd && sectionDraft.node}
          {!(sectionDraft.active && sectionDraft.atEnd) && (
            <ListSectionAdd onStart={sectionDraft.onStartAtEnd} />
          )}
        </div>
      </div>
      <ListOverlays {...overlays} />
    </div>
    </SectionDraftProvider>
  );
}
