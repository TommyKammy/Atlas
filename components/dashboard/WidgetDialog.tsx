"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { computeDashboardWidget } from "@/lib/dashboard-compute";
import {
  CHART_TYPE_LABELS,
  GROUP_BY_LABELS,
  METRIC_LABELS,
  isMultiSeriesChart,
  isTimeChart,
  type DashboardChartType,
  type DashboardFilter,
  type DashboardGroupBy,
  type DashboardMeta,
  type DashboardMetric,
  type DashboardTask,
  type DashboardWidget,
} from "@/lib/dashboard-types";
import ChartRenderer from "./ChartRenderer";
import {
  checkboxClass,
  dialogCloseClass,
  dialogSubtitleClass,
  dialogTitleClass,
  fieldControlClass,
  fieldLabelClass,
  fieldTextareaClass,
  formSectionTitleClass,
  primaryButtonClass,
  secondaryButtonClass,
  SelectControl,
} from "../ui/form-controls";

const CHART_TYPES: DashboardChartType[] = [
  "bar",
  "stacked_bar",
  "grouped_bar",
  "line",
  "burnup",
  "burndown",
  "donut",
  "number",
  "lollipop",
];

const GROUP_BYS: DashboardGroupBy[] = [
  "section",
  "assignee",
  "status",
  "completion",
  "due_month",
  "created_month",
];

const METRICS: DashboardMetric[] = [
  "count",
  "completed",
  "incomplete",
  "overdue",
  "progress_avg",
  "progress_sum",
];

function suggestedTitle(
  kind: "chart" | "text",
  chartType: DashboardChartType,
  groupBy: DashboardGroupBy,
  metric: DashboardMetric,
): string {
  if (kind === "text") return "テキスト";
  if (chartType === "number") return METRIC_LABELS[metric];
  if (chartType === "burnup") return "バーンアップ";
  if (chartType === "burndown") return "バーンダウン";
  if (isTimeChart(chartType)) return "タスク完了の推移";
  return `${METRIC_LABELS[metric]} (${GROUP_BY_LABELS[groupBy]}別)`;
}

function ChartTypeIcon({ type }: { type: DashboardChartType }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const };
  if (type === "donut")
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" {...common}>
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  if (type === "number")
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" {...common}>
        <path d="M4 17h16M7 13V7m5 6V4m5 9v-3" />
      </svg>
    );
  if (type === "line" || type === "burnup" || type === "burndown") {
    const d = type === "burndown" ? "M3 5l5 4 4-2 4 3 5-5" : "M3 19l5-5 4 2 4-5 5-6";
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" {...common}>
        <path d={d} />
        <path d="M3 21h18" />
      </svg>
    );
  }
  if (type === "lollipop")
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" {...common}>
        <path d="M3 21h18M6 17V9m6 8V5m6 12v-6" />
        <circle cx="6" cy="7" r="1.5" fill="currentColor" />
        <circle cx="12" cy="3" r="1.5" fill="currentColor" />
        <circle cx="18" cy="9" r="1.5" fill="currentColor" />
      </svg>
    );
  if (type === "stacked_bar")
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" {...common}>
        <path d="M3 21h18M6 21V8h4v13m4 0V4h4v17" />
        <path d="M6 14h4M14 12h4M14 17h4" />
      </svg>
    );
  if (type === "grouped_bar")
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" {...common}>
        <path d="M3 21h18M5 21V9h3v12m2 0V5h3v16m2 0v-9h3v9" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...common}>
      <path d="M3 21h18M6 21V11h3v10m3 0V5h3v16m3 0v-7h3v7" />
    </svg>
  );
}

export default function WidgetDialog({
  projectId,
  projectName,
  mode,
  initialType,
  widget,
  tasks,
  meta,
  onClose,
  onSaved,
}: {
  projectId: number;
  projectName: string;
  mode: "create" | "edit";
  initialType: "chart" | "text";
  widget: DashboardWidget | null;
  tasks: DashboardTask[];
  meta: DashboardMeta;
  onClose: () => void;
  onSaved: (widgets: DashboardWidget[]) => void;
}) {
  const kind = widget?.widget_type ?? initialType;
  const initialGroup = widget?.group_by ?? "section";
  const initialMetric = widget?.metric ?? "count";
  const [title, setTitle] = useState(
    widget?.title ?? suggestedTitle(initialType, "bar", initialGroup, initialMetric),
  );
  const [titleTouched, setTitleTouched] = useState(widget !== null);
  const [body, setBody] = useState(widget?.body ?? "");
  const [chartType, setChartType] = useState<DashboardChartType>(widget?.chart_type ?? "bar");
  const [groupBy, setGroupBy] = useState<DashboardGroupBy>(widget?.group_by ?? "section");
  const [metric, setMetric] = useState<DashboardMetric>(widget?.metric ?? "count");
  const [filters, setFilters] = useState<DashboardFilter>(widget?.filters ?? {});
  const [dataLabels, setDataLabels] = useState(widget?.options.data_labels !== false);
  const [rangeDays, setRangeDays] = useState(widget?.options.range_days ?? 30);
  const [benchmark, setBenchmark] = useState(
    widget?.options.benchmark === null || widget?.options.benchmark === undefined
      ? ""
      : String(widget.options.benchmark),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const benchmarkValue =
    benchmark.trim() === ""
      ? null
      : Number.isFinite(Number(benchmark))
        ? Number(benchmark)
        : null;
  const timeChart = isTimeChart(chartType);
  const multiSeries = isMultiSeriesChart(chartType);
  const numberChart = chartType === "number";
  const previewWidget = useMemo<DashboardWidget>(
    () => ({
      id: widget?.id ?? 0,
      project_id: projectId,
      title: title || "無題のウィジェット",
      widget_type: kind,
      chart_type: chartType,
      group_by: groupBy,
      metric,
      filters,
      options: {
        data_labels: dataLabels,
        range_days: rangeDays,
        benchmark: benchmarkValue,
      },
      body,
      position: widget?.position ?? 0,
    }),
    [
      widget?.id,
      widget?.position,
      projectId,
      title,
      kind,
      chartType,
      groupBy,
      metric,
      filters,
      dataLabels,
      rangeDays,
      benchmarkValue,
      body,
    ],
  );
  const preview = useMemo(
    () => computeDashboardWidget(previewWidget, tasks, meta),
    [previewWidget, tasks, meta],
  );

  const save = async () => {
    if (!title.trim()) {
      setError("タイトルを入力してください");
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      title: title.trim(),
      widget_type: kind,
      chart_type: kind === "text" ? "bar" : chartType,
      group_by: groupBy,
      metric,
      filters: kind === "text" ? {} : filters,
      options:
        kind === "text"
          ? {}
          : {
              data_labels: dataLabels,
              range_days: rangeDays,
              benchmark: benchmarkValue,
            },
      body: kind === "text" ? body : "",
    };
    try {
      const data =
        mode === "edit" && widget
          ? await api<{ widgets: DashboardWidget[] }>(
              `/api/projects/${projectId}/dashboard/widgets/${widget.id}`,
              "PATCH",
              payload,
            )
          : await api<{ widgets: DashboardWidget[] }>(
              `/api/projects/${projectId}/dashboard/widgets`,
              "POST",
              payload,
            );
      onSaved(data.widgets);
      onClose();
    } catch (e) {
      setError(`保存に失敗しました: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-scrim p-3 sm:p-6"
      onClick={onClose}
      data-dashboard-dialog
    >
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "edit" ? "ウィジェットを編集" : "ウィジェットを追加"}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line-subtle px-5 py-4">
          <div className="min-w-0">
            <h2 className={dialogTitleClass}>
              {mode === "edit" ? "ウィジェットを編集" : kind === "text" ? "テキストを追加" : "チャートを追加"}
            </h2>
            <p className={dialogSubtitleClass}>
              {kind === "text" ? "メモやリンクをカードとして表示します。" : "集計するデータと見た目を選びます。"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className={dialogCloseClass}
          >
            ×
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
          <div className="flex min-h-[320px] flex-col border-b border-line-subtle bg-surface-subtle p-5 lg:border-b-0 lg:border-r">
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setTitleTouched(true);
              }}
              placeholder={kind === "text" ? "テキストのタイトル" : "チャートのタイトル"}
              data-dashboard-widget-title
              className="h-9 w-full rounded-md border border-transparent bg-transparent px-1 text-[20px] font-semibold text-text outline-none placeholder:text-subtle hover:border-line focus:border-accent"
            />
            <div className="mt-4 min-h-[260px] flex-1">
              {kind === "text" ? (
                <div className="min-h-[260px] rounded-lg bg-surface p-4 text-[13px] leading-6 text-secondary whitespace-pre-wrap">
                  {body || "テキストを入力するとここにプレビューが表示されます。"}
                </div>
              ) : (
                <ChartRenderer data={preview} chartType={chartType} />
              )}
            </div>
            <div className="mt-2 text-[12px] text-muted">
              {kind === "text" ? "テキストウィジェット" : `${CHART_TYPE_LABELS[chartType]} / ${preview.matched} 件のタスク`}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto p-5">
            <div className={formSectionTitleClass}>データソース</div>
            <div className="mt-2 rounded-lg bg-surface-subtle px-3 py-2 text-[13px] text-secondary">
              <div className="font-medium text-text">{projectName}</div>
              <div className="mt-0.5 text-[12px] text-muted">このプロジェクトのタスク</div>
            </div>

            {kind === "chart" && (
              <>
                <div className={`${formSectionTitleClass} mt-5`}>チャートのスタイル</div>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {CHART_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        setChartType(type);
                        if (!titleTouched) setTitle(suggestedTitle(kind, type, groupBy, metric));
                      }}
                      title={CHART_TYPE_LABELS[type]}
                      data-dashboard-chart-type={type}
                      className={`flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-md border px-1 py-1.5 text-[11px] ${
                        chartType === type
                          ? "border-accent-line bg-accent-soft text-accent-text"
                          : "border-line text-muted hover:bg-hover hover:text-secondary"
                      }`}
                    >
                      <ChartTypeIcon type={type} />
                      <span className="w-full truncate text-center">{CHART_TYPE_LABELS[type]}</span>
                    </button>
                  ))}
                </div>

                {!timeChart && !numberChart && (
                  <label className={`${fieldLabelClass} mt-3 block`}>
                    {multiSeries ? "グループ" : "X 軸"}
                    <SelectControl
                      containerClassName="mt-1"
                      value={groupBy}
                      onChange={(event) => {
                        const next = event.target.value as DashboardGroupBy;
                        setGroupBy(next);
                        if (!titleTouched) setTitle(suggestedTitle(kind, chartType, next, metric));
                      }}
                      data-dashboard-group-by
                    >
                      {GROUP_BYS.map((value) => (
                        <option key={value} value={value}>
                          {GROUP_BY_LABELS[value]}
                        </option>
                      ))}
                    </SelectControl>
                  </label>
                )}

                {!timeChart && !multiSeries && (
                  <label className={`${fieldLabelClass} mt-3 block`}>
                    Y 軸
                    <SelectControl
                      containerClassName="mt-1"
                      value={metric}
                      onChange={(event) => {
                        const next = event.target.value as DashboardMetric;
                        setMetric(next);
                        if (!titleTouched) setTitle(suggestedTitle(kind, chartType, groupBy, next));
                      }}
                      data-dashboard-metric
                    >
                      {METRICS.map((value) => (
                        <option key={value} value={value}>
                          {METRIC_LABELS[value]}
                        </option>
                      ))}
                    </SelectControl>
                  </label>
                )}

                {timeChart && (
                  <label className={`${fieldLabelClass} mt-3 block`}>
                    期間
                    <SelectControl
                      containerClassName="mt-1"
                      value={rangeDays}
                      onChange={(event) => setRangeDays(Number(event.target.value))}
                      data-dashboard-range
                    >
                      <option value={7}>過去7日</option>
                      <option value={14}>過去14日</option>
                      <option value={30}>過去30日</option>
                      <option value={90}>過去90日</option>
                    </SelectControl>
                  </label>
                )}

                {!numberChart && (
                  <div className="mt-5">
                    <div className={formSectionTitleClass}>フィルター</div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className={`${fieldLabelClass} block`}>
                        完了ステータス
                        <SelectControl
                          containerClassName="mt-1"
                          value={filters.completion ?? "all"}
                          onChange={(event) =>
                            setFilters((prev) => ({
                              ...prev,
                              completion: event.target.value as DashboardFilter["completion"],
                            }))
                          }
                        >
                          <option value="all">すべて</option>
                          <option value="open">未完了</option>
                          <option value="done">完了</option>
                        </SelectControl>
                      </label>
                      <label className={`${fieldLabelClass} block`}>
                        期日
                        <SelectControl
                          containerClassName="mt-1"
                          value={filters.due ?? ""}
                          onChange={(event) =>
                            setFilters((prev) => ({ ...prev, due: event.target.value as DashboardFilter["due"] }))
                          }
                        >
                          <option value="">すべて</option>
                          <option value="overdue">期限超過</option>
                          <option value="today">今日</option>
                          <option value="week">7日以内</option>
                          <option value="month">30日以内</option>
                        </SelectControl>
                      </label>
                      <label className={`${fieldLabelClass} block`}>
                        担当者
                        <SelectControl
                          containerClassName="mt-1"
                          value={filters.assignee ?? ""}
                          onChange={(event) => {
                            const value = event.target.value;
                            setFilters((prev) => ({
                              ...prev,
                              assignee: value === "" ? "" : value === "none" ? "none" : Number(value),
                            }));
                          }}
                        >
                          <option value="">すべて</option>
                          <option value="none">未割り当て</option>
                          {meta.users.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.name}
                            </option>
                          ))}
                        </SelectControl>
                      </label>
                      <label className={`${fieldLabelClass} block`}>
                        {meta.statusFieldName}
                        <SelectControl
                          containerClassName="mt-1"
                          value={filters.status ?? ""}
                          onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
                        >
                          <option value="">すべて</option>
                          {meta.statusOptions.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </SelectControl>
                      </label>
                    </div>
                  </div>
                )}

                <div className={`${formSectionTitleClass} mt-5`}>データの注釈</div>
                <div className="mt-2 space-y-2 text-[12px] text-secondary">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className={checkboxClass}
                      checked={dataLabels}
                      onChange={(event) => setDataLabels(event.target.checked)}
                    />
                    データラベル
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={benchmark}
                      onChange={(event) => setBenchmark(event.target.value)}
                      placeholder="ベンチマーク（任意）"
                      className={`${fieldControlClass} w-36`}
                    />
                    <span>ベンチマークライン</span>
                  </label>
                </div>
              </>
            )}

            {kind === "text" && (
              <label className={`${fieldLabelClass} mt-3 block`}>
                本文
                <textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={9}
                  placeholder="プロジェクトの目的、メモ、リンクなどを入力…"
                  className={`${fieldTextareaClass} mt-1`}
                  data-dashboard-widget-body
                />
              </label>
            )}

            {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line-subtle px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className={secondaryButtonClass}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            data-dashboard-widget-save
            className={primaryButtonClass}
          >
            {saving ? "保存中…" : mode === "edit" ? "変更を保存" : kind === "text" ? "テキストを追加" : "チャートを追加"}
          </button>
        </div>
      </div>
    </div>
  );
}
