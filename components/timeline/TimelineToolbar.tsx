"use client";

import ProjectTaskCreateButton from "@/components/task/ProjectTaskCreateButton";
import { ProjectViewToolbar, viewToolbarControlClass } from "@/components/view/ProjectViewToolbar";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { toast, confirmAction } from "@/lib/ui-feedback";
import type { User, Section } from "@/lib/data";
import type { ListFilters } from "@/lib/list-view";
import ListFilterMenu from "../list/ListFilterMenu";
import ListSortMenu from "../list/ListSortMenu";
import ViewOptionsDrawer from "../view/ViewOptionsDrawer";
import { FilterIcon, OptionsIcon, SortIcon } from "../view/ViewToolbarIcons";

export type TimelineSortKey = "default" | "due" | "start" | "assignee";
export type TimelineMenuKey = "filter" | "sort" | "options" | null;
export type TimelineZoomPreset = { key: string; label: string; dayWidth: number };

const toolbarBtn = viewToolbarControlClass;
const activePill = "flex h-7 overflow-hidden rounded-md bg-accent-soft text-accent-text";
const activePillMain = "flex items-center gap-1 pr-1 pl-2 text-[12px] font-medium hover:bg-[#e3edfc]";
const clearPill = "px-1.5 text-[12px] hover:bg-[#dbe8fb]";
const popoverBase = "absolute top-full z-40 mt-1 rounded-lg border border-line bg-surface shadow-lg";

export default function TimelineToolbar({
  projectId,
  min,
  navigationDays,
  linkDay,
  undatedCount,
  undatedOpen,
  setUndatedOpen,
  zoom,
  zoomPreset,
  zoomPresets,
  zoomMenu,
  setZoomMenu,
  changeZoom,
  filters,
  activeFilterCount,
  onFilterChange,
  clearFilters,
  sortBy,
  setSortBy,
  users,
  statusFieldName,
  statusFieldEnabled,
  statusOptions,
  sections,
  viewName,
  viewIcon,
  viewTabId,
  canEdit,
  showWeekends,
  setShowWeekends,
  showDependencies,
  setShowDependencies,
  showCritical,
  setShowCritical,
}: {
  projectId: number;
  min: number;
  navigationDays: number;
  linkDay: (day: number) => string;
  undatedCount: number;
  undatedOpen: boolean;
  setUndatedOpen: Dispatch<SetStateAction<boolean>>;
  zoom: number;
  zoomPreset: TimelineZoomPreset;
  zoomPresets: readonly TimelineZoomPreset[];
  zoomMenu: boolean;
  setZoomMenu: Dispatch<SetStateAction<boolean>>;
  changeZoom: (next: number) => void;
  filters: ListFilters;
  activeFilterCount: number;
  onFilterChange: (key: keyof ListFilters, value: string | boolean) => void;
  clearFilters: () => void;
  sortBy: TimelineSortKey;
  setSortBy: (value: TimelineSortKey) => void;
  users: User[];
  statusFieldName: string;
  statusFieldEnabled: boolean;
  statusOptions: string[];
  sections: Section[];
  viewName: string;
  viewIcon: string | null;
  viewTabId: number | null;
  canEdit: boolean;
  showWeekends: boolean;
  setShowWeekends: (value: boolean) => void;
  showDependencies: boolean;
  setShowDependencies: (value: boolean) => void;
  showCritical: boolean;
  setShowCritical: (value: boolean) => void;
}) {
  const router = useRouter();
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [resetSectionId, setResetSectionId] = useState("");
  const closeMenus = () => {
    setFilterOpen(false);
    setSortOpen(false);
  };

  useEffect(() => {
    if (!filterOpen && !sortOpen && !optionsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setFilterOpen(false);
      setSortOpen(false);
      setOptionsOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filterOpen, sortOpen, optionsOpen]);

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

  const sortKey = sortBy === "default" ? "position" : (sortBy as "start" | "due" | "assignee");
  const sortLabel = sortBy === "default" ? "" : sortBy === "start" ? "開始日" : sortBy === "due" ? "期日" : "担当者";

  const resetTimelineRows = async () => {
    if (!canEdit) return;
    if (!(await confirmAction("このプロジェクトの行固定をすべて解除しますか？"))) return;
    try {
      const result = await api<{ deleted: number }>(
        `/api/projects/${projectId}/timeline-rows`,
        "DELETE",
      );
      toast(`行固定を解除しました（${result.deleted ?? 0}件）`);
      setOptionsOpen(false);
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "行固定を解除できませんでした");
    }
  };

  const resetSectionRows = async () => {
    if (!canEdit || resetSectionId === "") return;
    if (!(await confirmAction("このセクションの行固定を解除しますか？"))) return;
    try {
      const result = await api<{ deleted: number }>(
        `/api/projects/${projectId}/timeline-rows`,
        "DELETE",
        { section_id: Number(resetSectionId) },
      );
      toast(`行固定を解除しました（${result.deleted ?? 0}件）`);
      setOptionsOpen(false);
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "行固定を解除できませんでした");
    }
  };

  return (
    <>
      <ProjectViewToolbar className="px-4">
        <ProjectTaskCreateButton projectId={projectId} sections={sections} users={users} data-timeline-add disabled={!canEdit} />
        <a
          href={`/projects/${projectId}?view=timeline&from=${linkDay(min - navigationDays)}`}
          aria-label="前の期間"
          title="前の期間"
          className="flex h-7 w-7 items-center justify-center rounded-md text-lg text-secondary hover:bg-hover"
        >
          ‹
        </a>
        <a href={`/projects/${projectId}?view=timeline`} className="flex h-7 items-center rounded-md px-2 text-[13px] text-secondary hover:bg-hover">
          今日
        </a>
        <a
          href={`/projects/${projectId}?view=timeline&from=${linkDay(min + navigationDays)}`}
          aria-label="次の期間"
          title="次の期間"
          className="flex h-7 w-7 items-center justify-center rounded-md text-lg text-secondary hover:bg-hover"
        >
          ›
        </a>
        {showCritical && (
          <span className="ml-2 flex items-center gap-1 text-xs text-muted">
            <span className="inline-block h-2.5 w-4 rounded bg-red-200" /> クリティカルパス
          </span>
        )}
        <span className="ml-auto" />
        <button
          type="button"
          data-timeline-undated
          onClick={() => setUndatedOpen((value) => !value)}
          className={`flex h-7 items-center rounded-md px-2 text-[13px] hover:bg-hover ${
            undatedOpen ? "bg-accent-soft text-accent-text" : "text-secondary"
          }`}
        >
          日付なしのタスク ({undatedCount} 件)
        </button>
        <span className="relative">
          <button
            type="button"
            data-timeline-zoom-level={zoomPreset.label}
            aria-label={`ズームレベル: ${zoomPreset.label}`}
            aria-haspopup="listbox"
            aria-expanded={zoomMenu}
            onClick={() => setZoomMenu((value) => !value)}
            className={toolbarBtn}
          >
            {zoomPreset.label}
            <span className="text-[10px] text-subtle">▾</span>
          </button>
          {zoomMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setZoomMenu(false)} />
              <div
                data-timeline-zoom-menu
                role="listbox"
                className="absolute top-full right-0 z-40 mt-1 w-36 rounded-lg border border-line bg-surface p-1 shadow-lg"
              >
                {zoomPresets.map((preset, index) => (
                  <button
                    key={preset.key}
                    type="button"
                    role="option"
                    aria-selected={index === zoom}
                    data-timeline-zoom-option={preset.label}
                    onClick={() => {
                      changeZoom(index);
                      setZoomMenu(false);
                    }}
                    className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover ${
                      index === zoom ? "bg-accent-soft text-accent-text" : "text-secondary"
                    }`}
                  >
                    {preset.label}
                    {index === zoom && <span className="text-[11px]">✓</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </span>
        <button
          type="button"
          data-timeline-zoom-out
          aria-label="ズームアウト"
          aria-disabled={zoom === zoomPresets.length - 1}
          title="ズームアウト"
          onClick={() => changeZoom(zoom + 1)}
          disabled={zoom === zoomPresets.length - 1}
          className="flex h-7 w-7 items-center justify-center rounded-md text-base text-secondary hover:bg-hover disabled:opacity-30"
        >
          −
        </button>
        <button
          type="button"
          data-timeline-zoom-in
          aria-label="ズームイン"
          aria-disabled={zoom === 0}
          title="ズームイン"
          onClick={() => changeZoom(zoom - 1)}
          disabled={zoom === 0}
          className="flex h-7 w-7 items-center justify-center rounded-md text-base text-secondary hover:bg-hover disabled:opacity-30"
        >
          ＋
        </button>

        <span className="relative">
          {activeFilterCount > 0 ? (
            <span className={activePill}>
              <button
                type="button"
                data-timeline-filter
                data-timeline-filter-open
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
              data-timeline-filter
              data-timeline-filter-open
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
              <div data-timeline-filter-menu className={`${popoverBase} right-0 w-[560px] max-w-[calc(100vw-2rem)]`}>
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
          {sortBy !== "default" ? (
            <span className={activePill}>
              <button
                type="button"
                data-timeline-sort
                data-timeline-sort-open
                aria-expanded={sortOpen}
                aria-haspopup="menu"
                onClick={() => {
                  closeMenus();
                  setSortOpen((value) => !value);
                }}
                className={activePillMain}
              >
                <SortIcon /> ソート: {sortLabel}
              </button>
              <button type="button" title="ソートをクリア" onClick={() => setSortBy("default")} className={clearPill}>
                ×
              </button>
            </span>
          ) : (
            <button
              type="button"
              data-timeline-sort
              data-timeline-sort-open
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
              <div data-timeline-sort-menu className={`${popoverBase} right-0 w-60`}>
                <ListSortMenu
                  sortKey={sortKey}
                  sortDir="asc"
                  allowedKeys={["start", "due", "assignee"]}
                  showDirection={false}
                  includeNone
                  onSelect={(key) => {
                    setSortBy(key as TimelineSortKey);
                    setSortOpen(false);
                  }}
                  onToggleDir={() => undefined}
                  onClear={() => {
                    setSortBy("default");
                    setSortOpen(false);
                  }}
                />
              </div>
            </>
          )}
        </span>

        <button
          type="button"
          data-timeline-options
          data-timeline-options-open
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
        title="タイムライン"
        viewName={viewName}
        viewIcon={viewIcon}
        viewTabId={viewTabId}
        canEdit={canEdit}
        onRenameView={renameView}
        onUpdateIcon={updateViewIcon}
        filterSummary={activeFilterCount > 0 ? `適用中: ${activeFilterCount}` : "なし"}
        sortSummary={sortBy === "default" ? "なし" : sortLabel}
        onOpenFilter={() => {
          setOptionsOpen(false);
          setFilterOpen(true);
        }}
        onOpenSort={() => {
          setOptionsOpen(false);
          setSortOpen(true);
        }}
      >
        <div className="mt-3 border-t border-line-subtle pt-3">
          <div className="px-2 text-[11px] font-medium text-muted">レイアウトオプション</div>
          <label className="mt-2 flex h-8 cursor-pointer items-center gap-2 rounded px-2 text-[13px] text-secondary hover:bg-hover">
            <input type="checkbox" checked={showWeekends} onChange={(event) => setShowWeekends(event.target.checked)} className="h-3.5 w-3.5 accent-accent" />
            週末を網掛け
          </label>
          <label className="flex h-8 cursor-pointer items-center gap-2 rounded px-2 text-[13px] text-secondary hover:bg-hover">
            <input type="checkbox" checked={showCritical} onChange={(event) => setShowCritical(event.target.checked)} className="h-3.5 w-3.5 accent-accent" />
            クリティカルパスを表示
          </label>
          <button
            type="button"
            data-timeline-auto-rows
            disabled={!canEdit}
            onClick={() => void resetTimelineRows()}
            className="mt-1 flex h-8 w-full items-center rounded px-2 text-left text-[13px] text-secondary hover:bg-hover disabled:text-subtle"
          >
            行を自動整列（固定を解除）
          </button>
          <div className="mt-2 px-2 text-[11px] text-muted">セクション単位</div>
          <select
            value={resetSectionId}
            onChange={(event) => setResetSectionId(event.target.value)}
            aria-label="行固定を解除するセクション"
            className="mx-2 mt-1 h-8 w-[calc(100%-1rem)] rounded-md border border-line bg-white px-2 text-[13px] outline-none focus:border-accent"
          >
            <option value="">セクションを選択…</option>
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-timeline-auto-rows-section
            disabled={!canEdit || resetSectionId === ""}
            onClick={() => void resetSectionRows()}
            className="mt-1 flex h-8 w-full items-center rounded px-2 text-left text-[13px] text-secondary hover:bg-hover disabled:text-subtle"
          >
            選択セクションを自動整列
          </button>
        </div>
        <div className="mt-2 border-t border-line-subtle pt-3">
          <div className="px-2 text-[11px] font-medium text-muted">依存関係設定</div>
          <label className="mt-2 flex h-8 cursor-pointer items-center gap-2 rounded px-2 text-[13px] text-secondary hover:bg-hover">
            <input type="checkbox" checked={showDependencies} onChange={(event) => setShowDependencies(event.target.checked)} className="h-3.5 w-3.5 accent-accent" />
            依存関係を表示
          </label>
        </div>
        <div className="mt-2 border-t border-line-subtle pt-3">
          <div className="px-2 text-[11px] font-medium text-muted">ズーム</div>
          <select
            value={zoom}
            onChange={(event) => changeZoom(Number(event.target.value))}
            className="mx-2 mt-1 h-8 w-[calc(100%-1rem)] rounded-md border border-line bg-white px-2 text-[13px] outline-none focus:border-accent"
            aria-label="ズーム"
          >
            {zoomPresets.map((preset, index) => (
              <option key={preset.key} value={index}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>
      </ViewOptionsDrawer>
    </>
  );
}
