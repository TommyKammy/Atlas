"use client";

import ProjectTaskCreateButton from "@/components/task/ProjectTaskCreateButton";
import { ProjectViewToolbar, viewToolbarControlClass } from "@/components/view/ProjectViewToolbar";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { toast } from "@/lib/ui-feedback";
import type { Section, User } from "@/lib/data";
import {
  LIST_GROUP_LABELS,
  LIST_SORT_LABELS,
  type ListFilters,
  type ListGroupBy,
  type ListSortKey,
} from "@/lib/list-view";
import ListFilterMenu from "../list/ListFilterMenu";
import ListGroupMenu from "../list/ListGroupMenu";
import ListSortMenu from "../list/ListSortMenu";
import ViewOptionsDrawer from "../view/ViewOptionsDrawer";
import { FilterIcon, GroupIcon, OptionsIcon, SortIcon } from "../view/ViewToolbarIcons";

const toolbarBtn = viewToolbarControlClass;
const activePill = "flex h-7 overflow-hidden rounded-md bg-accent-soft text-accent-text";
const activePillMain = "flex items-center gap-1 pr-1 pl-2 text-[12px] font-medium hover:bg-accent-soft-hover";
const clearPill = "px-1.5 text-[12px] hover:bg-accent-soft-hover";
const popoverBase = "absolute top-full z-40 mt-1 rounded-lg border border-line bg-surface shadow-lg";

export type BoardCardFields = {
  assignee: boolean;
  due: boolean;
  status: boolean;
  meta: boolean;
};

export default function BoardToolbar({
  projectId,
  sections,
  users,
  statusFieldEnabled,
  statusFieldName,
  statusOptions,
  filters,
  activeFilterCount,
  overdueCount,
  onFilterChange,
  clearFilters,
  sortKey,
  sortDir,
  onSortSelect,
  onToggleSortDir,
  clearSort,
  groupBy,
  groupDir,
  onSelectGroup,
  onSetGroupDir,
  clearGroup,
  viewName,
  viewIcon,
  viewTabId,
  canEdit,
  showEmptyGroups,
  setShowEmptyGroups,
  autoRefresh,
  setAutoRefresh,
  cardFields,
  onToggleCardField,
}: {
  projectId: number;
  sections: Section[];
  users: User[];
  statusFieldEnabled: boolean;
  statusFieldName: string;
  statusOptions: string[];
  filters: ListFilters;
  activeFilterCount: number;
  overdueCount: number;
  onFilterChange: (key: keyof ListFilters, value: string | boolean) => void;
  clearFilters: () => void;
  sortKey: ListSortKey;
  sortDir: "asc" | "desc";
  onSortSelect: (key: Exclude<ListSortKey, "position">) => void;
  onToggleSortDir: () => void;
  clearSort: () => void;
  groupBy: ListGroupBy;
  groupDir: "asc" | "desc";
  onSelectGroup: (key: ListGroupBy) => void;
  onSetGroupDir: (dir: "asc" | "desc") => void;
  clearGroup: () => void;
  viewName: string;
  viewIcon: string | null;
  viewTabId: number | null;
  canEdit: boolean;
  showEmptyGroups: boolean;
  setShowEmptyGroups: (value: boolean) => void;
  autoRefresh: boolean;
  setAutoRefresh: (value: boolean) => void;
  cardFields: BoardCardFields;
  onToggleCardField: (key: keyof BoardCardFields) => void;
}) {
  const router = useRouter();
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const closeMenus = () => {
    setFilterOpen(false);
    setSortOpen(false);
    setGroupOpen(false);
  };

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
  }, [filterOpen, sortOpen, groupOpen, optionsOpen]);

  const renameView = async (name: string) => {
    if (!canEdit || viewTabId === null) return;
    try {
      await api(`/api/project-tabs/${viewTabId}`, "PATCH", { name });
      toast("ビュー名を変更しました");
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "ビュー名を変更できませんでした");
    }
  };

  const updateViewIcon = async (icon: string | null) => {
    if (!canEdit || viewTabId === null) return;
    try {
      await api(`/api/project-tabs/${viewTabId}`, "PATCH", { icon });
      toast("ビューのアイコンを変更しました");
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "アイコンを変更できませんでした");
    }
  };

  const overdueActive = filters.due === "overdue";
  const sortLabel = sortKey === "position" ? "" : LIST_SORT_LABELS[sortKey] ?? sortKey;
  const sortArrow = sortDir === "asc" ? "↑" : "↓";
  const groupLabel =
    groupBy === "section"
      ? "セクション"
      : groupBy === "status"
        ? statusFieldName
        : LIST_GROUP_LABELS[groupBy] ?? groupBy;

  return (
    <>
      <ProjectViewToolbar className="px-4">
        <ProjectTaskCreateButton projectId={projectId} sections={sections} users={users} data-board-add disabled={!canEdit} />
        <span className="ml-auto" />

        <button
          type="button"
          data-board-overdue-toggle
          data-board-overdue-count={overdueCount}
          aria-pressed={overdueActive}
          onClick={() => onFilterChange("due", overdueActive ? "" : "overdue")}
          className={
            overdueActive
              ? "inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-accent-soft px-2 text-[12px] font-medium text-accent-text transition-colors hover:bg-accent-soft-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              : toolbarBtn
          }
        >
          要対応 {overdueCount}
        </button>

        <span className="relative">
          {activeFilterCount > 0 ? (
            <span className={activePill}>
              <button
                type="button"
                data-board-filter
                data-board-filter-open
                aria-expanded={filterOpen}
                aria-haspopup="menu"
                onClick={() => {
                  closeMenus();
                  setFilterOpen((value) => !value);
                }}
                className={activePillMain}
              >
                <FilterIcon /> フィルター: {activeFilterCount}
              </button>
              <button type="button" title="フィルターをクリア" onClick={clearFilters} className={clearPill}>
                ×
              </button>
            </span>
          ) : (
            <button
              type="button"
              data-board-filter
              data-board-filter-open
              aria-expanded={filterOpen}
              aria-haspopup="menu"
              onClick={() => {
                closeMenus();
                setFilterOpen((value) => !value);
              }}
              className={toolbarBtn}
            >
              <FilterIcon /> フィルター
            </button>
          )}
          {filterOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setFilterOpen(false)} />
              <div data-board-filter-menu className={`${popoverBase} right-0 w-[560px] max-w-[calc(100vw-2rem)]`}>
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
              <button
                type="button"
                data-board-sort
                data-board-sort-open
                aria-expanded={sortOpen}
                aria-haspopup="menu"
                onClick={() => {
                  closeMenus();
                  setSortOpen((value) => !value);
                }}
                className={activePillMain}
              >
                <SortIcon /> ソート: {sortLabel} {sortArrow}
              </button>
              <button type="button" title="ソートをクリア" onClick={clearSort} className={clearPill}>
                ×
              </button>
            </span>
          ) : (
            <button
              type="button"
              data-board-sort
              data-board-sort-open
              aria-expanded={sortOpen}
              aria-haspopup="menu"
              onClick={() => {
                closeMenus();
                setSortOpen((value) => !value);
              }}
              className={toolbarBtn}
            >
              <SortIcon /> ソート
            </button>
          )}
          {sortOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setSortOpen(false)} />
              <div data-board-sort-menu className={`${popoverBase} right-0 w-60`}>
                <ListSortMenu
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSelect={onSortSelect}
                  onToggleDir={onToggleSortDir}
                  onClear={clearSort}
                  hideProject
                />
              </div>
            </>
          )}
        </span>

        <span className="relative">
          {groupBy !== "section" ? (
            <span className={activePill}>
              <button
                type="button"
                data-board-group
                data-board-group-open
                aria-expanded={groupOpen}
                aria-haspopup="menu"
                onClick={() => {
                  closeMenus();
                  setGroupOpen((value) => !value);
                }}
                className={activePillMain}
              >
                <GroupIcon /> グループ: {groupLabel}
              </button>
              <button type="button" title="グループを解除" onClick={clearGroup} className={clearPill}>
                ×
              </button>
            </span>
          ) : (
            <button
              type="button"
              data-board-group
              data-board-group-open
              aria-expanded={groupOpen}
              aria-haspopup="menu"
              onClick={() => {
                closeMenus();
                setGroupOpen((value) => !value);
              }}
              className={toolbarBtn}
            >
              <GroupIcon /> グループ
            </button>
          )}
          {groupOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setGroupOpen(false)} />
              <div data-board-group-menu className={`${popoverBase} right-0 w-[440px] max-w-[calc(100vw-2rem)]`}>
                <ListGroupMenu
                  groupBy={groupBy}
                  group2={null}
                  groupDir={groupDir}
                  customFields={[]}
                  statusFieldEnabled={statusFieldEnabled}
                  statusFieldName={statusFieldName}
                  allowSubgroup={false}
                  onSelectPrimary={onSelectGroup}
                  onSelectSecondary={() => undefined}
                  onClearSecondary={() => undefined}
                  onSetGroupDir={onSetGroupDir}
                  onClear={clearGroup}
                />
              </div>
            </>
          )}
        </span>

        <button
          type="button"
          data-board-options
          data-board-options-open
          aria-haspopup="dialog"
          aria-expanded={optionsOpen}
          onClick={() => {
            closeMenus();
            setOptionsOpen(true);
          }}
          className={toolbarBtn}
        >
          <OptionsIcon /> オプション
        </button>
      </ProjectViewToolbar>

      <ViewOptionsDrawer
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        title="ボード"
        viewName={viewName}
        viewIcon={viewIcon}
        viewTabId={viewTabId}
        canEdit={canEdit}
        onRenameView={renameView}
        onUpdateIcon={updateViewIcon}
        filterSummary={activeFilterCount > 0 ? `適用中: ${activeFilterCount}` : "なし"}
        sortSummary={sortKey === "position" ? "なし" : `${sortLabel} ${sortArrow}`}
        groupSummary={groupLabel}
        onOpenFilter={() => {
          setOptionsOpen(false);
          setFilterOpen(true);
        }}
        onOpenSort={() => {
          setOptionsOpen(false);
          setSortOpen(true);
        }}
        onOpenGroup={() => {
          setOptionsOpen(false);
          setGroupOpen(true);
        }}
      >
        <div className="mt-3 border-t border-line-subtle pt-3">
          <div className="px-2 text-[11px] font-medium text-muted">レイアウトオプション</div>
          <label className="mt-2 flex h-8 cursor-pointer items-center gap-2 rounded px-2 text-[13px] text-secondary hover:bg-hover">
            <input
              type="checkbox"
              checked={showEmptyGroups}
              onChange={(event) => setShowEmptyGroups(event.target.checked)}
              className="h-3.5 w-3.5 accent-accent"
            />
            空のグループを表示
          </label>
          <label className="flex h-8 cursor-pointer items-center gap-2 rounded px-2 text-[13px] text-secondary hover:bg-hover">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
              className="h-3.5 w-3.5 accent-accent"
            />
            20秒ごとに自動更新
          </label>
        </div>
        <div className="mt-2 border-t border-line-subtle pt-3">
          <div className="px-2 text-[11px] font-medium text-muted">フィールドを表示 / 非表示</div>
          {(
            [
              ["assignee", "担当者"],
              ["due", "期日"],
              ["status", statusFieldName],
              ["meta", "サブタスク・コメント"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex h-8 cursor-pointer items-center gap-2 rounded px-2 text-[13px] text-secondary hover:bg-hover"
            >
              <input
                type="checkbox"
                checked={cardFields[key]}
                onChange={() => onToggleCardField(key)}
                className="h-3.5 w-3.5 accent-accent"
              />
              {label}
            </label>
          ))}
        </div>
      </ViewOptionsDrawer>
    </>
  );
}
