"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { confirmAction, toast } from "@/lib/ui-feedback";
import {
  activeFilterCount,
  computeDashboardWidget,
} from "@/lib/dashboard-compute";
import type {
  DashboardMeta,
  DashboardTask,
  DashboardWidget,
} from "@/lib/dashboard-types";
import EmptyState from "./EmptyState";
import ChartRenderer from "./dashboard/ChartRenderer";
import WidgetDialog from "./dashboard/WidgetDialog";

type DialogState =
  | { mode: "create"; kind: "chart" | "text"; widget: null }
  | { mode: "edit"; kind: "chart" | "text"; widget: DashboardWidget };

function listHref(projectId: number, widget: DashboardWidget): string {
  const params = new URLSearchParams({ view: "list" });
  const completion = widget.filters.completion;
  if (completion === "open") params.set("hide", "1");
  if (completion === "done") params.set("completed", "done");
  if (typeof widget.filters.assignee === "number") {
    params.set("assignee", String(widget.filters.assignee));
  } else if (widget.filters.assignee === "none") {
    params.set("assignee", "none");
  }
  if (widget.filters.status) params.set("status", widget.filters.status);
  if (widget.filters.due) params.set("due", widget.filters.due);
  return `/projects/${projectId}?${params.toString()}`;
}

function AddMenu({ onPick }: { onPick: (kind: "chart" | "text") => void }) {
  return (
    <div
      role="menu"
      data-dashboard-add-menu
      className="absolute left-0 top-full z-40 mt-1 w-44 rounded-lg border border-neutral-200 bg-white p-1 shadow-xl"
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => onPick("chart")}
        data-dashboard-add-chart
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] text-neutral-700 hover:bg-neutral-100"
      >
        <span className="flex h-4 w-4 items-end gap-[2px] text-neutral-500">
          <span className="h-2 w-[3px] rounded-sm bg-current" />
          <span className="h-3 w-[3px] rounded-sm bg-current" />
          <span className="h-4 w-[3px] rounded-sm bg-current" />
        </span>
        チャート
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => onPick("text")}
        data-dashboard-add-text
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] text-neutral-700 hover:bg-neutral-100"
      >
        <span className="w-4 text-center text-[15px] font-serif text-neutral-500">T</span>
        テキスト
      </button>
    </div>
  );
}

export default function DashboardView({
  projectId,
  projectName,
  tasks,
  widgets: initialWidgets,
  sections,
  users,
  statusOptions,
  statusFieldName,
  statusFieldEnabled,
  canEdit,
}: {
  projectId: number;
  projectName: string;
  tasks: DashboardTask[];
  widgets: DashboardWidget[];
  sections: { id: number; name: string }[];
  users: { id: number; name: string }[];
  statusOptions: string[];
  statusFieldName: string;
  statusFieldEnabled: boolean;
  canEdit: boolean;
}) {
  const [widgets, setWidgets] = useState(initialWidgets);
  const [addOpen, setAddOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [menuId, setMenuId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest("[data-dashboard-add-menu]") && !target?.closest("[data-dashboard-add-button]")) {
        setAddOpen(false);
      }
      if (!target?.closest("[data-dashboard-widget-menu]") && !target?.closest("[data-dashboard-widget-menu-button]")) {
        setMenuId(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const meta: DashboardMeta = useMemo(
    () => ({ sections, users, statusOptions, statusFieldName, statusFieldEnabled }),
    [sections, users, statusOptions, statusFieldName, statusFieldEnabled],
  );

  const saveOrder = async (next: DashboardWidget[]) => {
    const previous = widgets;
    setWidgets(next.map((widget, index) => ({ ...widget, position: (index + 1) * 1000 })));
    try {
      const data = await api<{ widgets: DashboardWidget[] }>(
        `/api/projects/${projectId}/dashboard/widgets`,
        "PATCH",
        { order: next.map((widget) => widget.id) },
      );
      setWidgets(data.widgets);
    } catch (error) {
      setWidgets(previous);
      toast(`並び替えに失敗しました: ${error instanceof Error ? error.message : error}`);
    }
  };

  const move = (widget: DashboardWidget, direction: -1 | 1) => {
    const index = widgets.findIndex((item) => item.id === widget.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= widgets.length) return;
    const next = [...widgets];
    [next[index], next[target]] = [next[target], next[index]];
    setMenuId(null);
    void saveOrder(next);
  };

  const remove = async (widget: DashboardWidget) => {
    setMenuId(null);
    if (!(await confirmAction(`「${widget.title}」を削除しますか？`))) return;
    setBusy(true);
    try {
      const data = await api<{ widgets: DashboardWidget[] }>(
        `/api/projects/${projectId}/dashboard/widgets/${widget.id}`,
        "DELETE",
      );
      setWidgets(data.widgets);
    } catch (error) {
      toast(`削除に失敗しました: ${error instanceof Error ? error.message : error}`);
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async (widget: DashboardWidget) => {
    setMenuId(null);
    setBusy(true);
    try {
      const data = await api<{ widgets: DashboardWidget[] }>(
        `/api/projects/${projectId}/dashboard/widgets`,
        "POST",
        {
          title: `${widget.title} のコピー`,
          widget_type: widget.widget_type,
          chart_type: widget.chart_type,
          group_by: widget.group_by,
          metric: widget.metric,
          filters: widget.filters,
          options: widget.options,
          body: widget.body ?? "",
        },
      );
      setWidgets(data.widgets);
    } catch (error) {
      toast(`複製に失敗しました: ${error instanceof Error ? error.message : error}`);
    } finally {
      setBusy(false);
    }
  };

  const dropOn = (target: DashboardWidget) => {
    if (dragId === null || dragId === target.id) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const from = widgets.findIndex((widget) => widget.id === dragId);
    const to = widgets.findIndex((widget) => widget.id === target.id);
    if (from < 0 || to < 0) return;
    const next = [...widgets];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDragId(null);
    setOverId(null);
    void saveOrder(next);
  };

  const openCreate = (kind: "chart" | "text") => {
    setAddOpen(false);
    setDialog({ mode: "create", kind, widget: null });
  };

  const openEdit = (widget: DashboardWidget) => {
    setMenuId(null);
    setDialog({ mode: "edit", kind: widget.widget_type, widget });
  };

  const metaForWidget = (widget: DashboardWidget) => computeDashboardWidget(widget, tasks, meta);

  return (
    <div className="px-4 pb-16" data-dashboard-view>
      <div className="flex flex-wrap items-center gap-2 py-3">
        {canEdit && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setAddOpen((open) => !open)}
              data-dashboard-add-button
              aria-haspopup="menu"
              aria-expanded={addOpen}
              className="flex h-8 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 text-[13px] font-medium text-neutral-700 shadow-sm hover:bg-neutral-50"
            >
              <span className="text-base leading-none">＋</span>
              ウィジェットを追加
            </button>
            {addOpen && <AddMenu onPick={openCreate} />}
          </div>
        )}
        <div className="ml-auto flex items-center gap-3">
          <a href="/help" className="text-[12px] text-blue-700 hover:underline">
            フィードバックを送る
          </a>
          <details className="relative">
            <summary className="flex h-8 cursor-pointer list-none items-center rounded-md border border-neutral-300 bg-white px-3 text-[13px] text-neutral-700 shadow-sm hover:bg-neutral-50 [&::-webkit-details-marker]:hidden">
              ⋯ オプション
            </summary>
            <div className="absolute right-0 z-30 mt-1 flex w-56 flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-3 text-sm shadow-xl">
              <span className="text-[11px] font-medium text-neutral-500">エクスポート</span>
              <a
                href={`/api/projects/${projectId}/dashboard/export?format=json`}
                className="rounded px-1 py-1 text-[13px] text-blue-700 hover:bg-neutral-50 hover:underline"
              >
                JSON
              </a>
              <a
                href={`/api/projects/${projectId}/dashboard/export?format=csv`}
                className="rounded px-1 py-1 text-[13px] text-blue-700 hover:bg-neutral-50 hover:underline"
              >
                CSV
              </a>
            </div>
          </details>
        </div>
      </div>

      {tasks.length === 0 && (
        <EmptyState
          scope="dashboard"
          title="タスクがまだありません"
          description="リストからタスクを追加すると、ダッシュボードに集計が表示されます。"
          action={
            <a
              href={`/projects/${projectId}?view=list`}
              className="h-8 rounded-md bg-[#2c60b8] px-4 text-[13px] font-medium leading-8 text-white hover:bg-[#24529c]"
            >
              リストでタスクを追加
            </a>
          }
        />
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        {widgets.map((widget) => {
          const data = metaForWidget(widget);
          const filtersCount = activeFilterCount(widget.filters);
          const disabledStatus = widget.group_by === "status" && !statusFieldEnabled;
          const displayTitle = disabledStatus ? "Statusフィールド" : widget.title;
          const isNumber = widget.widget_type === "chart" && widget.chart_type === "number";
          const isText = widget.widget_type === "text";
          const span = isNumber ? "lg:col-span-1" : "lg:col-span-2";
          return (
            <article
              key={widget.id}
              data-dashboard-widget={widget.id}
              data-dashboard-widget-kind={isText ? "text" : isNumber ? "number" : "chart"}
              onDragOver={(event) => {
                if (!canEdit || dragId === null) return;
                event.preventDefault();
                setOverId(widget.id);
              }}
              onDragLeave={() => setOverId((current) => (current === widget.id ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                dropOn(widget);
              }}
              className={`group relative flex flex-col rounded-lg border bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${
                isNumber ? "min-h-[140px]" : "min-h-[180px]"
              } ${
                overId === widget.id && dragId !== null ? "border-[#4075cf] ring-2 ring-[#4075cf]/20" : "border-neutral-200"
              } ${span}`}
            >
              <div className="flex items-start gap-2 px-4 pb-1 pt-3">
                <h3
                  data-dashboard-widget-title={displayTitle}
                  className="min-w-0 flex-1 truncate text-[14px] font-medium text-neutral-800"
                  title={displayTitle}
                >
                  {displayTitle}
                </h3>
                {canEdit && (
                  <>
                    <button
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        setDragId(widget.id);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", String(widget.id));
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverId(null);
                      }}
                      aria-label="ウィジェットを移動"
                      title="ドラッグして移動"
                      className="cursor-grab rounded p-0.5 text-neutral-300 opacity-0 hover:bg-neutral-100 hover:text-neutral-500 group-hover:opacity-100"
                    >
                      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
                        <circle cx="5" cy="4" r="1" />
                        <circle cx="11" cy="4" r="1" />
                        <circle cx="5" cy="8" r="1" />
                        <circle cx="11" cy="8" r="1" />
                        <circle cx="5" cy="12" r="1" />
                        <circle cx="11" cy="12" r="1" />
                      </svg>
                    </button>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setMenuId((current) => (current === widget.id ? null : widget.id))}
                        data-dashboard-widget-menu-button
                        aria-label="ウィジェットのオプション"
                        aria-haspopup="menu"
                        aria-expanded={menuId === widget.id}
                        className="rounded p-0.5 text-neutral-400 opacity-0 hover:bg-neutral-100 hover:text-neutral-700 group-hover:opacity-100"
                      >
                        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
                          <circle cx="3" cy="8" r="1.2" />
                          <circle cx="8" cy="8" r="1.2" />
                          <circle cx="13" cy="8" r="1.2" />
                        </svg>
                      </button>
                      {menuId === widget.id && (
                        <div
                          role="menu"
                          data-dashboard-widget-menu
                          className="absolute right-0 top-full z-40 mt-1 w-44 rounded-lg border border-neutral-200 bg-white p-1 text-[13px] shadow-xl"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => openEdit(widget)}
                            className="flex w-full rounded px-2.5 py-1.5 text-left text-neutral-700 hover:bg-neutral-100"
                          >
                            編集
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => void duplicate(widget)}
                            disabled={busy}
                            className="flex w-full rounded px-2.5 py-1.5 text-left text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
                          >
                            複製
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => move(widget, -1)}
                            className="flex w-full rounded px-2.5 py-1.5 text-left text-neutral-700 hover:bg-neutral-100"
                          >
                            上へ移動
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => move(widget, 1)}
                            className="flex w-full rounded px-2.5 py-1.5 text-left text-neutral-700 hover:bg-neutral-100"
                          >
                            下へ移動
                          </button>
                          <div className="my-1 border-t border-neutral-100" />
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => void remove(widget)}
                            disabled={busy}
                            className="flex w-full rounded px-2.5 py-1.5 text-left text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            削除
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div
                className={`flex flex-1 items-center px-4 pb-1 pt-1 ${
                  isNumber ? "min-h-[72px]" : "min-h-[120px]"
                }`}
              >
                {isText ? (
                  <div className="w-full self-start whitespace-pre-wrap text-[13px] leading-5 text-neutral-700">
                    {widget.body || "テキストがありません。"}
                  </div>
                ) : (
                  <div className="w-full">
                    <ChartRenderer data={data} chartType={widget.chart_type} />
                  </div>
                )}
              </div>

              {!isText && (
                <div className="flex min-h-[34px] items-center gap-2 border-t border-neutral-100 px-4 py-1.5 text-[11px] text-neutral-500">
                  <button
                    type="button"
                    onClick={() => canEdit && openEdit(widget)}
                    disabled={!canEdit}
                    className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-neutral-100 disabled:hover:bg-transparent"
                    title={canEdit ? "フィルターを編集" : undefined}
                  >
                    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.3">
                      <path d="M2 3h12l-4.7 5.3V14l-2.6-1.7V8.3z" />
                    </svg>
                    {filtersCount > 0 ? `${filtersCount} 個のフィルター` : "フィルターなし"}
                  </button>
                  {!isNumber && !disabledStatus && (
                    <a href={listHref(projectId, widget)} className="ml-auto rounded border border-neutral-200 px-2 py-0.5 hover:bg-neutral-50">
                      すべて表示
                    </a>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {widgets.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          ウィジェットがありません。「ウィジェットを追加」から作成してください。
        </div>
      )}

      {dialog && (
        <WidgetDialog
          projectId={projectId}
          projectName={projectName}
          mode={dialog.mode}
          initialType={dialog.kind}
          widget={dialog.widget}
          tasks={tasks}
          meta={meta}
          onClose={() => setDialog(null)}
          onSaved={setWidgets}
        />
      )}
    </div>
  );
}
