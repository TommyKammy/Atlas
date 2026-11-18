import { addDaysISO } from "@/lib/dashboard-compute";
import type { DashboardDrilldown, DashboardMeta } from "@/lib/dashboard-types";
import { isMultiSeriesChart, isTimeChart, METRIC_LABELS } from "@/lib/dashboard-types";

const formatDay = (day: string) => day.replaceAll("-", "/");

function conditionLabels(selection: DashboardDrilldown, meta: DashboardMeta): string[] {
  const labels: string[] = [];
  const { filters, category } = selection;
  if (filters.completion === "open") labels.push("未完了のみ");
  if (filters.completion === "done") labels.push("完了のみ");
  if (filters.assignee === "none") labels.push("担当者：未割り当て");
  else if (typeof filters.assignee === "number") {
    labels.push(`担当者：${meta.users.find((user) => user.id === filters.assignee)?.name ?? "不明な担当者"}`);
  }
  if (typeof filters.section === "number") {
    labels.push(`セクション：${meta.sections.find((section) => section.id === filters.section)?.name ?? "不明なセクション"}`);
  }
  if (filters.status) labels.push(`${meta.statusFieldName}：${filters.status}`);
  const day = formatDay(selection.asOfDay);
  if (filters.due === "overdue") labels.push(`期限超過（${day}より前）`);
  if (filters.due === "today") labels.push(`期日：${day}`);
  if (filters.due === "week" || filters.due === "month") {
    const end = addDaysISO(selection.asOfDay, filters.due === "week" ? 7 : 30);
    labels.push(`期日：${day}〜${formatDay(end)}`);
  }
  if (!isMultiSeriesChart(selection.chartType) && !isTimeChart(selection.chartType) && selection.metric !== "count") {
    labels.push(`集計：${METRIC_LABELS[selection.metric]}`);
  }
  if (category?.kind === "section") {
    labels.push(`セクション：${category.id === null ? "セクションなし" : meta.sections.find((section) => section.id === category.id)?.name ?? "不明なセクション"}`);
  } else if (category?.kind === "assignee") {
    labels.push(`担当者：${category.id === null ? "未割り当て" : meta.users.find((user) => user.id === category.id)?.name ?? "不明な担当者"}`);
  } else if (category?.kind === "status") {
    labels.push(`${meta.statusFieldName}：${category.value || "未設定"}`);
  } else if (category?.kind === "completion") {
    labels.push(category.completed ? "完了" : "未完了");
  } else if (category?.kind === "due_month") {
    labels.push(`期日：${category.month === null ? "期限なし" : formatDay(category.month)}`);
  } else if (category?.kind === "created_month") {
    labels.push(`作成日：${formatDay(category.month)}`);
  } else if (category?.kind === "day") {
    labels.push(`${formatDay(category.day)}時点`);
  }
  if (selection.seriesKey === "open" || selection.seriesKey === "remaining") labels.push("未完了");
  if (selection.seriesKey === "done") labels.push("完了");
  if (selection.seriesKey === "total") labels.push("合計");
  return [...new Set(labels)];
}

/** Makes the fixed chart selection visible alongside the normal list controls. */
export default function DashboardDrilldownContext({ projectId, selection, count, meta }: {
  projectId: number;
  selection: DashboardDrilldown | null;
  count: number;
  meta: DashboardMeta;
}) {
  const labels = selection ? conditionLabels(selection, meta) : [];
  return (
    <section
      data-dashboard-drilldown
      data-dashboard-drilldown-count={count}
      aria-label="ダッシュボードからの絞り込み"
      className="mx-4 mb-2 mt-3 flex flex-col gap-3 rounded-md border border-line bg-surface-subtle px-3 py-2.5 sm:flex-row sm:items-center"
    >
      <div className="min-w-0 flex-1">
        {selection ? (
          <>
            <p className="text-[12px] text-secondary">ダッシュボードからの絞り込み</p>
            <p data-dashboard-drilldown-title className="break-words text-[14px] font-medium text-text">{selection.title}</p>
            <p data-dashboard-drilldown-conditions className="mt-0.5 break-words text-[12px] leading-5 text-secondary">
              {labels.length ? labels.join(" · ") : "すべてのタスク"}
              <span className="ml-2 whitespace-nowrap font-medium">元の集計対象 {count} 件</span>
            </p>
          </>
        ) : (
          <p role="alert" className="text-[13px] leading-5 text-secondary">
            集計条件を読み取れませんでした。ダッシュボードに戻って、もう一度選択してください。
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px]">
        <a data-dashboard-return href={`/projects/${projectId}?view=dashboard`} className="rounded text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
          ダッシュボードへ戻る
        </a>
        <a data-dashboard-clear href={`/projects/${projectId}?view=list`} className="rounded text-secondary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
          通常のリストに戻る
        </a>
      </div>
    </section>
  );
}
