"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { todayISO } from "@/lib/dates";
import {
  canEditCustomField,
  customValueToInput,
  type ColumnFunction,
  type CustomField,
  type CustomFieldType,
  type CustomValue,
} from "@/lib/custom-fields";
import type { SavedView, Section, TaskRow, User } from "@/lib/data";
import { groupTasks } from "@/lib/list-grouping";
import type { ListGroupBy } from "@/lib/list-view";
import { compareListTasks, filterListTasks, listFooterTotals } from "@/lib/list-view-model";
import { useApiRefresh } from "@/lib/use-api-refresh";
import { useLive } from "@/lib/use-live";
import { useListBulkActions } from "@/lib/use-list-bulk-actions";
import { useColumnLayout } from "@/lib/use-column-layout";
import { useListFilters } from "@/lib/use-list-filters";
import { useListRowContext } from "@/lib/use-list-row-context";
import { useListRowDnd } from "@/lib/use-list-row-dnd";
import { useListRowInteraction } from "@/lib/use-list-row-interaction";
import { useListSections } from "@/lib/use-list-sections";
import { useListSelection } from "@/lib/use-list-selection";
import { useListTaskActions } from "@/lib/use-list-task-actions";
import { taskSectionId } from "@/lib/task-section";
import { useListToolbar } from "@/lib/use-list-toolbar";
import { confirmAction, toast as toastMessage } from "@/lib/ui-feedback";
import ListFooterRow from "@/components/list/ListFooterRow";
import ListSectionHeader from "@/components/list/ListSectionHeader";
import type { FieldLibraryEntry } from "@/components/list/FieldTypeMenu";
import type { ListViewContentProps } from "@/components/list/ListViewContent";

export type ListViewProps = {
  projectId: number;
  sections: Section[];
  tasks: TaskRow[];
  users: User[];
  customFields: CustomField[];
  customValues: Record<number, Record<number, CustomValue>>;
  savedViews: SavedView[];
  subtaskMap: Record<number, TaskRow[]>;
  activeSavedId: number | null;
  projectStatusOptions: string[];
  statusFieldName: string;
  statusFieldEnabled: boolean;
  activeTaskId: number | null;
  viewerId: number;
  viewName: string;
  viewIcon: string | null;
  viewTabId: number | null;
  canEdit: boolean;
  canAdmin: boolean;
  initial: {
    hide_completed?: boolean;
    completed_only?: boolean;
    mine_only?: boolean;
    assignee?: string;
    status?: string;
    due?: string;
    start?: string;
    creator?: string;
    created?: string;
    updated?: string;
    completed_on?: string;
    sort?: string;
    sortdir?: "asc" | "desc";
    group?: string;
    group2?: string;
    groupdir?: "asc" | "desc";
    subtasks_collapsed?: boolean;
  };
};

export function useListView({
  projectId,
  sections,
  tasks,
  users,
  customFields,
  customValues,
  savedViews,
  subtaskMap,
  activeSavedId,
  initial,
  projectStatusOptions,
  statusFieldName,
  statusFieldEnabled,
  activeTaskId,
  viewerId,
  viewName,
  viewIcon,
  viewTabId,
  canEdit,
  canAdmin,
}: ListViewProps): ListViewContentProps {
  const refresh = useApiRefresh();
  const router = useRouter();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const onLive = useCallback(() => {
    router.refresh();
    setLastRefresh(new Date().toLocaleTimeString("ja-JP"));
  }, [router]);
  useLive(projectId, autoRefresh, onLive);
  const [groupSections, setGroupSections] = useState<Record<string, number | null>>({});
  const {
    drafts,
    setDrafts,
    subAdding,
    setSubAdding,
    subDraft,
    setSubDraft,
    editing,
    setEditing,
    editVal,
    setEditVal,
    editStart,
    addingTo,
    setAddingTo,
    addSubtask,
    commitSectionTask,
    commitGroupedTask,
    cancelAddTask,
    openEdit,
    commitEdit,
    cancelEdit,
    openDueEdit,
    applyDueRange,
    toggle,
    remove,
  } = useListTaskActions({ projectId, refresh, customFields, sections, groupSections });
  const {
    addingSection,
    setAddingSection,
    sectionName,
    setSectionName,
    orderedSections,
    sectionDragging,
    setSectionDragging,
    sectionDrop,
    setSectionDrop,
    editingSection,
    setEditingSection,
    sectionEditName,
    setSectionEditName,
    sectionMenu,
    setSectionMenu,
    startSectionDrag,
    reorderSections,
    beginSectionEdit,
    saveSectionName,
    addTaskToSection,
    openSectionMenu,
    deleteSection,
    createSection,
    sectionDropSide,
  } = useListSections({
    projectId,
    sections,
    refresh,
    onAddTask: setAddingTo,
    onDragStart: () => setHint(null),
  });
  const [fieldMenuAnchor, setFieldMenuAnchor] = useState<{
    left: number;
    right: number;
    top: number;
    bottom: number;
  } | null>(null);
  const [fieldDialog, setFieldDialog] = useState<
    { mode: "create"; type: CustomFieldType } | { mode: "edit"; field: CustomField } | null
  >(null);

  const { selected, toggleSelect, selectRange, toggleAll, clear: clearSelection } =
    useListSelection();
  const { bulkSection, setBulkSection, bulkAssignee, setBulkAssignee, bulk, bulkDelete } =
    useListBulkActions({ selected, clearSelection, refresh });

  const removeField = async (f: CustomField) => {
    if (!await confirmAction(`項目「${f.name}」を削除しますか？（削除済みフィールドから復元できます）`)) return;
    await api(`/api/custom-fields/${f.id}`, "DELETE");
    refresh();
  };
  const listFilters = useListFilters({ projectId, initial, statusFieldEnabled });
  const {
    hideCompleted,
    completedOnly,
    mineOnly,
    groupBy,
    group2,
    groupDir,
    assigneeFilter,
    sortKey,
    sortDir,
    dueFilter,
    statusFilter,
    startFilter,
    creatorFilter,
    createdFilter,
    updatedFilter,
    completedDateFilter,
    subtasksCollapsed,
  } = listFilters;
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [menuCol, setMenuCol] = useState<string | null>(null);
  const [rowLimits, setRowLimits] = useState<Record<string, number>>({});
  const [customFilter, setCustomFilter] = useState<Record<number, string>>({});


  const focusAdd = () => {
    if (groupBy === "section" && sections[0]) setAddingTo(sections[0].id);
    else if (groupBy !== "section" && groupOrder[0]) setAddingTo(`g:${groupOrder[0][0]}`);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>("input[data-add-task]")?.focus());
  };
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("focus") === "add") {
      document.querySelector<HTMLInputElement>("input[data-add-task]")?.focus();
    }
  }, []);

  const today = todayISO();
  const distinctStatus = [...new Set(tasks.map((t) => t.status))].sort((a, b) => a.localeCompare(b, "ja"));
  const statusOptions = statusFieldEnabled
    ? projectStatusOptions.length > 0
      ? projectStatusOptions
      : distinctStatus
    : [];
  const {
    hiddenCols,
    setHiddenCols,
    hiddenCore,
    setHiddenCore,
    statusHidden,
    setStatusHidden,
    cycleSort,
    sortMark,
    applySort,
    clearSort,
    applyDueFilter,
    applyAssigneeFilter,
    applyStatusFilter,
    deleteSavedView,
    toolbarProps,
  } = useListToolbar({
    projectId,
    router,
    refresh,
    canEdit,
    viewTabId,
    viewName,
    viewIcon,
    sections,
    users,
    customFields,
    statusFieldName,
    statusFieldEnabled,
    statusOptions,
    focusAdd: () => focusAdd(),
    openFieldAdd: () => {
      const button = document.querySelector<HTMLElement>("[data-field-add-button]");
      if (button) openFieldAdd(button.getBoundingClientRect());
      else setFieldDialog({ mode: "create", type: "text" });
    },
    onCollapseSubtasks: () => clearExpanded(),
    listFilters,
  });
  const shownFields = customFields.filter((f) => !hiddenCols.has(f.id));
  const baseKeys = [
    "assignee",
    "due",
    "progress",
    ...(statusFieldEnabled ? ["status"] : []),
    ...customFields.map((f) => `cf-${f.id}`),
  ];
  const {
    colDragging,
    colDropOver,
    colDropSide,
    visibleCols,
    gridCols,
    compactCells,
    gripMouseDown,
    startColumnDrag,
    dragOverColumn,
    dragLeaveColumn,
    dropColumn,
    clearColumnDrop,
    endColumnDrag,
    moveCol,
  } = useColumnLayout({
    projectId,
    baseKeys,
    hiddenCols,
    hiddenKeys: hiddenCore,
    statusHidden,
    onMenuClose: () => setMenuCol(null),
  });

  const collapseKey = `atlas-listcollapsed-${projectId}`;
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(collapseKey) ?? "[]");
        if (Array.isArray(saved)) setCollapsedGroups(new Set(saved.filter((k) => typeof k === "string")));
      } catch {
        /* ignore */
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [collapseKey]);
  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(collapseKey, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  const visible = filterListTasks(tasks, {
    completedOnly,
    hideCompleted,
    mineOnly,
    assigneeFilter,
    statusFilter,
    statusFieldEnabled,
    creatorFilter,
    startFilter,
    createdFilter,
    updatedFilter,
    completedDateFilter,
    dueFilter,
    customFilter,
    shownFields,
    customValues,
    viewerId,
    today,
  });

  const bySection = new Map<number | null, TaskRow[]>();
  for (const t of visible) {
    const k = taskSectionId(t);
    if (!bySection.has(k)) bySection.set(k, []);
    bySection.get(k)!.push(t);
  }
  for (const list of bySection.values()) list.sort((a, b) => compareListTasks(a, b, sortKey, sortDir));

  const { dragging, dropHint, setHint, beginRowDrag, endRowDrag, appendToSection, moveTask } =
    useListRowDnd({ projectId, tasks, visible, refresh });

  const { expanded, openTask, rowClick, toggleExpand, clearExpanded } = useListRowInteraction({
    projectId,
    router,
    visible,
    selectRange,
    toggleSelect,
    subtasksCollapsed,
    isDragging: () => dragging.current,
  });

  const customRaw = (taskId: number, f: CustomField) =>
    customValueToInput(f, customValues[taskId]?.[f.id]);

  const footerTotals = (items: TaskRow[]) =>
    listFooterTotals(customFields, items, customValues, subtaskMap);

  const editInputCls =
    "w-full min-w-0 rounded border border-blue-500 bg-white py-0.5 pr-1 pl-2 text-[13px] text-neutral-800 outline-none";

  const canEditField = (field: CustomField) =>
    canEditCustomField(field, { viewerId, canEdit, canAdmin });

  const openEditField = (field: CustomField) => {
    setFieldDialog({ mode: "edit", field });
    setMenuCol(null);
  };

  const setColumnFunction = async (field: CustomField, fn: ColumnFunction) => {
    await api(`/api/custom-fields/${field.id}`, "PATCH", {
      config: { ...(field.config ?? {}), column_function: fn },
    });
    setMenuCol(null);
    refresh();
  };

  const toggleSubtaskTotals = async (field: CustomField) => {
    await api(`/api/custom-fields/${field.id}`, "PATCH", {
      config: { ...(field.config ?? {}), include_subtasks: !field.config?.include_subtasks },
    });
    setMenuCol(null);
    refresh();
  };

  const addFieldFromLibrary = async (entry: FieldLibraryEntry) => {
    try {
      await api("/api/custom-fields", "POST", {
        project_id: projectId,
        name: entry.name,
        field_type: entry.field_type,
        options: entry.options,
        description: entry.description,
        config: entry.config ?? {},
      });
      setFieldMenuAnchor(null);
      refresh();
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : "ライブラリからフィールドを作成できませんでした");
    }
  };

  const openFieldAdd = (rect: DOMRect) => {
    setFieldMenuAnchor({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    });
  };

  const allSelected = visible.length > 0 && visible.every((task) => selected.has(task.id));
  const grouping = { customFields, customValues, users };
  const splitGroups = (items: TaskRow[], key: ListGroupBy) =>
    groupTasks(items, key, grouping, sortKey, sortDir, groupDir);
  const groupOrder =
    groupBy !== "section" ? groupTasks(visible, groupBy, grouping, sortKey, sortDir, groupDir) : [];

  const rowLimitFor = (key: string) => rowLimits[key] ?? 100;
  const showMoreRows = (key: string, total: number, shown: number) =>
    total > shown ? (
      <button
        type="button"
        data-list-show-more={key}
        onClick={() => setRowLimits((current) => ({ ...current, [key]: (current[key] ?? 100) + 200 }))}
        className="mx-2 my-1 rounded-md border border-[#e1e1e1] bg-white px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"
      >
        さらに表示（{shown} / {total} 件）
      </button>
    ) : null;

  const rowCtx = useListRowContext({
    view: {
      today,
      compactCells,
      activeTaskId,
      visibleCols,
      statusFieldEnabled,
      statusHidden,
      statusOptions,
      shownFields,
      customFields,
      selected,
      sectionDragging: sectionDragging !== null,
      users,
      subtaskMap,
      customValues,
      gridCols,
      expanded,
      toggleExpand,
      openTask,
    },
    dnd: { dropHint, setHint, beginRowDrag, endRowDrag, rowClick, moveTask },
    editing: {
      editing,
      setEditing,
      editVal,
      setEditVal,
      editStart,
      openEdit,
      commitEdit,
      cancelEdit,
      openDueEdit,
      applyDueRange,
      editInputCls,
    },
    actions: {
      toggle,
      subAdding,
      setSubAdding,
      subDraft,
      setSubDraft,
      addSubtask,
      remove,
      onTimerChange: refresh,
      canEditField,
      customRaw,
    },
  });

  const groupHeader = (key: string, name: string, count: number, depth = 0, sectionId?: number) => (
    <ListSectionHeader
      groupKey={key}
      name={name}
      count={count}
      depth={depth}
      sectionId={sectionId}
      collapsed={collapsedGroups.has(key)}
      groupBy={groupBy}
      group2={group2}
      sectionDragging={sectionDragging}
      dropTargetId={sectionDrop?.id ?? null}
      editingSection={editingSection}
      sectionEditName={sectionEditName}
      sectionMenuId={sectionMenu?.id ?? null}
      canEdit={canEdit}
      onToggle={() => toggleGroup(key)}
      onBeginEdit={beginSectionEdit}
      onEditNameChange={setSectionEditName}
      onSaveName={(id) => void saveSectionName(id)}
      onCancelEdit={() => {
        setEditingSection(null);
        setSectionEditName("");
      }}
      onAddTask={addTaskToSection}
      onOpenMenu={openSectionMenu}
      onDragStart={startSectionDrag}
      onDragEnd={() => {
        setSectionDragging(null);
        setSectionDrop(null);
        setHint(null);
      }}
    />
  );

  const ghostRow = (onClick: () => void, items: TaskRow[]) => (
    <ListFooterRow
      variant="ghost"
      gridCols={gridCols}
      visibleCols={visibleCols}
      customFields={customFields}
      totals={footerTotals(items)}
      onAdd={onClick}
    />
  );

  const addRow = (input: ReactNode, items: TaskRow[]) => (
    <ListFooterRow
      variant="add"
      gridCols={gridCols}
      visibleCols={visibleCols}
      customFields={customFields}
      totals={footerTotals(items)}
    >
      {input}
    </ListFooterRow>
  );

  const content: ListViewContentProps = {
      view: {
        hideCompleted,
        completedOnly,
        mineOnly,
        sortKey,
        sortDir,
        groupBy,
        group2,
        groupDir,
        subtasksCollapsed,
        assigneeFilter,
        statusFilter,
        dueFilter,
        startFilter,
        creatorFilter,
        createdFilter,
        updatedFilter,
        completedDateFilter,
      },
      toolbar: {
        props: toolbarProps,
        autoRefresh,
        setAutoRefresh,
        lastRefresh,
        savedViews,
        activeSavedId,
        deleteSavedView,
      },
      bulk: {
        selectedCount: selected.size,
        sections: orderedSections,
        users,
        sectionValue: bulkSection,
        assigneeValue: bulkAssignee,
        onSectionChange: setBulkSection,
        onAssigneeChange: setBulkAssignee,
        onComplete: () => void bulk("complete"),
        onReopen: () => void bulk("reopen"),
        onMove: (sectionId) => void bulk("move", { section_id: sectionId }),
        onAssign: (assigneeId) => void bulk("assign", { assignee_id: assigneeId }),
        onDelete: () => void bulkDelete(),
        onClear: clearSelection,
      },
      columns: {
        headerRow: {
          gridCols,
          compactCells,
          allSelected,
          onToggleAll: () => toggleAll(visible.map((task) => task.id)),
          columnDragging: colDragging !== null,
          onClearColumnDrop: clearColumnDrop,
          onEndColumnDrag: endColumnDrag,
          onAddField: (event) => openFieldAdd(event.currentTarget.getBoundingClientRect()),
        },
        headers: {
          layout: {
            visibleCols,
            menuCol,
            setMenuCol,
            colDropOver,
            colDropSide,
            colDragging,
            gripMouseDown,
            moveCol,
            startColumnDrag,
            dragOverColumn,
            dragLeaveColumn,
            dropColumn,
            endColumnDrag,
          },
          sort: { cycleSort, sortMark, applySort, clearSort },
          filters: {
            applyAssigneeFilter,
            assigneeFilter,
            users,
            applyDueFilter,
            dueFilter,
            statusFieldEnabled,
            statusOptions,
            statusFilter,
            applyStatusFilter,
            statusFieldName,
            setStatusHidden,
            customFilter,
            setCustomFilter,
          },
          fields: {
            customFields,
            onEditField: openEditField,
            setColumnFunction,
            toggleSubtaskTotals,
            setHiddenCols,
            removeField,
          },
        },
        hidden: {
          hiddenCore,
          hiddenCols,
          statusHidden,
          statusFieldEnabled,
          statusFieldName,
          customFields,
          onShowCore: (key) =>
            setHiddenCore((previous) => {
              const next = new Set(previous);
              next.delete(key);
              return next;
            }),
          onShowStatus: () => setStatusHidden(false),
          onShowField: (id) =>
            setHiddenCols((previous) => {
              const next = new Set(previous);
              next.delete(id);
              return next;
            }),
        },
      },
      groups: {
        groups: {
          groupBy,
          group2,
          groupOrder,
          orderedSections,
          bySection,
          collapsedGroups,
          rowLimitFor,
        },
        render: { groupHeader, rowCtx, splitGroups, showMoreRows, addRow, ghostRow },
        composer: {
          addingTo,
          setAddingTo,
          drafts,
          setDrafts,
          groupSections,
          setGroupSections,
          sections,
          commitSectionTask,
          commitGroupedTask,
          cancelAddTask,
        },
        dnd: {
          sectionDrop,
          sectionDragging,
          sectionDropSide,
          setSectionDrop,
          reorderSections,
          appendToSection,
        },
      },
      sectionAdd: {
        adding: addingSection,
        name: sectionName,
        onNameChange: setSectionName,
        onCreate: () => void createSection(),
        onCancel: () => setAddingSection(false),
        onStart: () => setAddingSection(true),
      },
      overlays: {
        projectId,
        sectionMenu,
        sections,
        fieldMenuAnchor,
        fieldDialog,
        customFields,
        users,
        onCloseSectionMenu: () => setSectionMenu(null),
        onRenameSection: (section) => beginSectionEdit(section.id, section.name),
        onAddSection: () => {
          setSectionMenu(null);
          setAddingSection(true);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const input = document.querySelector<HTMLInputElement>("input[data-add-section-input]");
              input?.scrollIntoView({ block: "nearest" });
              input?.focus();
            });
          });
        },
        onToggleCollapseSection: (sectionId) => {
          setSectionMenu(null);
          toggleGroup(`s:${sectionId}`);
        },
        onDeleteSection: (section) => void deleteSection(section.id, section.name),
        onCloseFieldMenu: () => setFieldMenuAnchor(null),
        onFieldRestored: refresh,
        onPickFieldTemplate: (entry) => void addFieldFromLibrary(entry),
        onPickFieldType: (type) => {
          setFieldMenuAnchor(null);
          setFieldDialog({ mode: "create", type });
        },
        onCloseFieldDialog: () => setFieldDialog(null),
        onFieldSaved: refresh,
      },
      menuCol: menuCol,
      onCloseMenu: () => setMenuCol(null),
      editingDue: editing?.field === "due",
      onCancelEdit: cancelEdit,
      tasksEmpty: tasks.length === 0,
      focusAdd: focusAdd,
  };
  return content;
}
