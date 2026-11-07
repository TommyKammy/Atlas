"use client";

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

const toolbarBtn =
  "flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700";
const activePill = "flex h-7 overflow-hidden rounded-md bg-[#eff4fd] text-[#2C60B8]";
const activePillMain = "flex items-center gap-1 pr-1 pl-2 text-[12px] font-medium hover:bg-[#e3edfc]";
const clearPill = "px-1.5 text-[12px] hover:bg-[#dbe8fb]";
const popoverBase = "absolute top-full z-40 mt-1 rounded-lg border border-neutral-200 bg-white shadow-lg";

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
  focusAdd,
  toggleAddMenu,
  addMenu,
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
      if (event.key !== "Escape") return;
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
      <div className="flex flex-wrap items-center gap-1 border-b py-2 text-sm">
        <span className="relative flex">
          <button
            onClick={focusAdd}
            className="flex h-7 items-center gap-1 rounded-l-md border bg-white px-2.5 text-[12px] text-neutral-800 hover:bg-neutral-50"
          >
            <span className="text-[14px] leading-none text-neutral-500">＋</span> タスクを追加
          </button>
          <button
            onClick={toggleAddMenu}
            title="その他の追加方法"
            className="flex h-7 items-center rounded-r-md border border-l-0 bg-white px-1.5 text-neutral-600 hover:bg-neutral-50"
          >
            ▾
          </button>
          {addMenu && (
            <div className="absolute top-full left-0 z-40 mt-1 w-64 rounded-lg border bg-white py-1 text-sm shadow-lg">
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">
                テンプレートから作成
              </div>
              {addTemplates.length === 0 && (
                <div className="px-3 py-1 text-xs text-neutral-500">テンプレートなし</div>
              )}
              {addTemplates.map((template) => (
                <button
                  key={template.id}
                  className="flex w-full items-center gap-1 rounded px-3 py-1.5 text-left text-[13px] text-neutral-700 hover:bg-neutral-100"
                  onClick={() => instantiateTemplate(template.id)}
                >
                  {template.name}
                </button>
              ))}
            </div>
          )}
        </span>
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
              <div className="fixed inset-0 z-30" onClick={() => setFilterOpen(false)} />
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
              <div className="fixed inset-0 z-30" onClick={() => setSortOpen(false)} />
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
              <div className="fixed inset-0 z-30" onClick={() => setGroupOpen(false)} />
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
      </div>

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
