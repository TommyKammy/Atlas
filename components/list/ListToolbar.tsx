"use client";

import ProjectTaskCreateButton from "@/components/task/ProjectTaskCreateButton";
import { ProjectViewToolbar, viewToolbarControlClass } from "@/components/view/ProjectViewToolbar";
import { isImeComposing } from "@/lib/ime-keyboard";

import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { CustomField, Section, TaskTemplate, User } from "@/lib/data";
import {
  LIST_GROUP_LABELS,
  LIST_SORT_LABELS,
  type ListFilters,
  type ListGroupBy,
  type ListSortKey,
} from "@/lib/list-view";
import ListFilterMenu from "./ListFilterMenu";
import ListGroupMenu from "./ListGroupMenu";
import ListOptionsDrawer, { type ListColumnOption } from "./ListOptionsDrawer";
import ListSortMenu from "./ListSortMenu";

const toolbarBtn = viewToolbarControlClass;
const activePill = "flex h-7 overflow-hidden rounded-md bg-accent-soft text-accent-text";
const activePillMain = "flex items-center gap-1 pr-1 pl-2 text-[12px] font-medium hover:bg-accent-soft-hover";
const clearPill = "px-1.5 text-[12px] hover:bg-accent-soft-hover";
const popoverBase = "absolute top-full z-40 mt-1 rounded-lg border border-line bg-surface shadow-lg";

function FilterIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M2 3h12l-4.5 5.2v4.3L6.5 14V8.2L2 3Z" />
    </svg>
  );
}
function SortIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M4 2.5v11M4 13.5 1.8 11.2M4 13.5l2.2-2.3M9 3h5M9 6.5h4M9 10h3" />
    </svg>
  );
}
function GroupIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M2 3h12M2 8h12M2 13h12M5 1.5v3M5 6.5v3M5 11.5v3" />
    </svg>
  );
}
function OptionsIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M2 4h12M2 8h12M2 12h12" />
      <circle cx="6" cy="4" r="1.6" fill="white" />
      <circle cx="10" cy="8" r="1.6" fill="white" />
      <circle cx="5" cy="12" r="1.6" fill="white" />
    </svg>
  );
}

export default function ListToolbar({
  projectId,
  sections,
  users,
  statusFieldEnabled,
  statusFieldName,
  statusOptions,
  customFields,
  addTemplates,
  instantiateTemplate,
  activeFilterCount,
  filterOpen,
  setFilterOpen,
  openFilterMenu,
  clearFilters,
  filters,
  onFilterChange,
  sortOpen,
  setSortOpen,
  openSortMenu,
  clearAllSort,
  sortKey,
  sortDir,
  applySortKey,
  toggleSortDir,
  groupOpen,
  setGroupOpen,
  openGroupMenu,
  groupBy,
  group2,
  groupDir,
  applyGroupBy,
  applyGroup2,
  clearGroup2,
  applyGroupDir,
  clearGroup,
  saving,
  setSaving,
  saveName,
  setSaveName,
  saveView,
  canSaveView = true,
  autoRefresh,
  setAutoRefresh,
  lastRefresh,
  optionsOpen,
  setOptionsOpen,
  viewName,
  viewIcon,
  viewTabId,
  canEdit,
  renameView,
  updateViewIcon,
  subtasksCollapsed,
  toggleSubtasksCollapsed,
  columns,
  onToggleColumn,
  openFieldAdd,
}: {
  projectId: number;
  sections: Section[];
  users: User[];
  statusFieldEnabled: boolean;
  statusFieldName: string;
  statusOptions: string[];
  customFields: CustomField[];
  focusAdd: () => void;
  toggleAddMenu: () => void;
  addMenu: boolean;
  addTemplates: TaskTemplate[];
  instantiateTemplate: (id: number) => void;
  activeFilterCount: number;
  filterOpen: boolean;
  setFilterOpen: Dispatch<SetStateAction<boolean>>;
  openFilterMenu: () => void;
  clearFilters: () => void;
  filters: ListFilters;
  onFilterChange: (key: keyof ListFilters, value: string | boolean) => void;
  sortOpen: boolean;
  setSortOpen: Dispatch<SetStateAction<boolean>>;
  openSortMenu: () => void;
  clearAllSort: () => void;
  sortKey: ListSortKey;
  sortDir: "asc" | "desc";
  applySortKey: (key: Exclude<ListSortKey, "position">) => void;
  toggleSortDir: () => void;
  groupOpen: boolean;
  setGroupOpen: Dispatch<SetStateAction<boolean>>;
  openGroupMenu: () => void;
  groupBy: ListGroupBy;
  group2: ListGroupBy | null;
  groupDir: "asc" | "desc";
  applyGroupBy: (key: ListGroupBy) => void;
  applyGroup2: (key: ListGroupBy | null) => void;
  clearGroup2: () => void;
  applyGroupDir: (dir: "asc" | "desc") => void;
  clearGroup: () => void;
  saving: boolean;
  setSaving: Dispatch<SetStateAction<boolean>>;
  saveName: string;
  setSaveName: (value: string) => void;
  saveView: () => void;
  canSaveView?: boolean;
  autoRefresh: boolean;
  setAutoRefresh: (value: boolean) => void;
  lastRefresh: string | null;
  optionsOpen: boolean;
  setOptionsOpen: Dispatch<SetStateAction<boolean>>;
  viewName: string;
  viewIcon: string | null;
  viewTabId: number | null;
  canEdit: boolean;
  renameView: (name: string) => Promise<void>;
  updateViewIcon: (icon: string | null) => Promise<void>;
  subtasksCollapsed: boolean;
  toggleSubtasksCollapsed: (collapsed: boolean) => void;
  columns: ListColumnOption[];
  onToggleColumn: (key: string) => void;
  openFieldAdd: () => void;
}) {
  const sortLabel =
    sortKey === "position" ? "" : sortKey === "status" ? statusFieldName : LIST_SORT_LABELS[sortKey];
  const sortArrow = sortDir === "asc" ? "↑" : "↓";
  const groupLabelFor = (key: ListGroupBy) => {
    if (key === "status") return statusFieldName || "Status";
    if (key.startsWith("cf-")) {
      const id = Number(key.slice(3));
      return customFields.find((field) => field.id === id)?.name ?? "カスタムフィールド";
    }
    return LIST_GROUP_LABELS[key] ?? key;
  };
  const groupLabel = groupBy === "section" ? "" : groupLabelFor(groupBy);
  const filterSummary = activeFilterCount > 0 ? `適用中: ${activeFilterCount}` : "なし";
  const sortSummary = sortKey === "position" ? "なし" : `${sortLabel} ${sortArrow}`;
  const groupSummary =
    groupBy === "section" && group2 === null
      ? "セクション"
      : group2
        ? `${groupBy === "section" ? "セクション" : groupLabel} > ${groupLabelFor(group2)}`
        : groupLabel;

  useEffect(() => {
    if (!filterOpen && !sortOpen && !groupOpen && !optionsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (isImeComposing(event) || event.key !== "Escape") return;
      setFilterOpen(false);
      setSortOpen(false);
      setGroupOpen(false);
      setOptionsOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filterOpen, sortOpen, groupOpen, optionsOpen, setFilterOpen, setSortOpen, setGroupOpen, setOptionsOpen]);

  const openFromOptions = (open: () => void) => {
    setOptionsOpen(false);
    open();
  };

  return (
    <>
      <ProjectViewToolbar>
        <ProjectTaskCreateButton projectId={projectId} sections={sections} users={users} data-list-add disabled={!canEdit}
          templates={addTemplates} onTemplate={instantiateTemplate} />
        <span className="ml-auto" />

        <span className="relative">
          {activeFilterCount > 0 ? (
            <span className={activePill}>
              <button onClick={openFilterMenu} data-list-filter-open className={activePillMain}>
                <FilterIcon /> フィルター: {activeFilterCount}
              </button>
              <button title="フィルターをクリア" onClick={clearFilters} className={clearPill}>
                ×
              </button>
            </span>
          ) : (
            <button onClick={openFilterMenu} data-list-filter-open className={toolbarBtn}>
              <FilterIcon /> フィルター
            </button>
          )}
          {filterOpen && (
            <>
              <div data-popover-backdrop className="fixed inset-0 z-30" onClick={() => setFilterOpen(false)} />
              <div className={`${popoverBase} right-0 w-[560px] max-w-[calc(100vw-2rem)]`}>
                <ListFilterMenu
                  filters={filters}
                  activeCount={activeFilterCount}
                  users={users}
                  statusFieldEnabled={statusFieldEnabled}
                  statusFieldName={statusFieldName}
                  statusOptions={statusOptions}
                  onChange={onFilterChange}
                  onClear={clearFilters}
                />
              </div>
            </>
          )}
        </span>

        <span className="relative">
          {sortKey !== "position" ? (
            <span className={activePill}>
              <button onClick={openSortMenu} data-list-sort-open className={activePillMain}>
                <SortIcon /> ソート: {sortLabel} {sortArrow}
              </button>
              <button title="ソートをクリア" onClick={clearAllSort} className={clearPill}>
                ×
              </button>
            </span>
          ) : (
            <button onClick={openSortMenu} data-list-sort-open className={toolbarBtn}>
              <SortIcon /> ソート
            </button>
          )}
          {sortOpen && (
            <>
              <div data-popover-backdrop className="fixed inset-0 z-30" onClick={() => setSortOpen(false)} />
              <div className={`${popoverBase} right-0 w-60`}>
                <ListSortMenu
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSelect={applySortKey}
                  onToggleDir={toggleSortDir}
                  onClear={clearAllSort}
                />
              </div>
            </>
          )}
        </span>

        <span className="relative">
          {groupBy !== "section" || group2 !== null ? (
            <span className={activePill}>
              <button onClick={openGroupMenu} data-list-group-open className={activePillMain}>
                <GroupIcon /> グループ: {groupSummary}
              </button>
              <button title="グループを解除" onClick={clearGroup} className={clearPill}>
                ×
              </button>
            </span>
          ) : (
            <button onClick={openGroupMenu} data-list-group-open className={toolbarBtn}>
              <GroupIcon /> グループ
            </button>
          )}
          {groupOpen && (
            <>
              <div data-popover-backdrop className="fixed inset-0 z-30" onClick={() => setGroupOpen(false)} />
              <div className={`${popoverBase} right-0 w-[440px] max-w-[calc(100vw-2rem)]`}>
                <ListGroupMenu
                  groupBy={groupBy}
                  group2={group2}
                  groupDir={groupDir}
                  customFields={customFields}
                  statusFieldEnabled={statusFieldEnabled}
                  statusFieldName={statusFieldName}
                  onSelectPrimary={(key) => {
                    applyGroupBy(key);
                  }}
                  onSelectSecondary={(key) => {
                    applyGroup2(key);
                  }}
                  onClearSecondary={clearGroup2}
                  onSetGroupDir={applyGroupDir}
                  onClear={() => {
                    clearGroup();
                  }}
                />
              </div>
            </>
          )}
        </span>

        <button
          type="button"
          data-list-options-open
          aria-haspopup="dialog"
          aria-expanded={optionsOpen}
          onClick={() => {
            setFilterOpen(false);
            setSortOpen(false);
            setGroupOpen(false);
            setOptionsOpen(true);
          }}
          className={toolbarBtn}
        >
          <OptionsIcon /> オプション
        </button>
      </ProjectViewToolbar>

      <ListOptionsDrawer
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        viewName={viewName}
        viewIcon={viewIcon}
        viewTabId={viewTabId}
        canEdit={canEdit}
        onRenameView={renameView}
        onUpdateIcon={updateViewIcon}
        subtasksCollapsed={subtasksCollapsed}
        onToggleSubtasks={toggleSubtasksCollapsed}
        columns={columns}
        onToggleColumn={onToggleColumn}
        onAddField={() => {
          setOptionsOpen(false);
          openFieldAdd();
        }}
        filterSummary={filterSummary}
        sortSummary={sortSummary}
        groupSummary={groupSummary}
        onOpenFilter={() => openFromOptions(openFilterMenu)}
        onOpenSort={() => openFromOptions(openSortMenu)}
        onOpenGroup={() => openFromOptions(openGroupMenu)}
        saving={saving}
        setSaving={setSaving}
        saveName={saveName}
        setSaveName={setSaveName}
        saveView={saveView}
        canSaveView={canSaveView}
        autoRefresh={autoRefresh}
        setAutoRefresh={setAutoRefresh}
        lastRefresh={lastRefresh}
        projectId={projectId}
        sections={sections}
        users={users}
      />
    </>
  );
}
