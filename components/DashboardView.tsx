import type { DashboardExtras, ProjectStats } from "@/lib/data";
import type { DashboardWidgetKey } from "@/lib/dashboard-widgets";
import { AssigneeBars, Donut, OverdueList, SectionProgress, StatusBars, TrendBars } from "./Stats";
import DashboardSettings from "./DashboardSettings";
import EmptyState from "./EmptyState";

export default function DashboardView({
  projectId,
  stats,
  extras,
  days,
  prefs,
}: {
  projectId: number;
  stats: ProjectStats;
  extras: DashboardExtras;
  days: number;
  prefs: { key: DashboardWidgetKey; visible: boolean }[];
}) {
  const metrics = [
    { label: "タスクの合計", value: stats.total },
    { label: "未完了のタスクの合計", value: stats.total - stats.done },
    { label: "完了したタスクの合計", value: stats.done },
    { label: "期限超過のタスクの合計", value: stats.overdue },
  ];
  return (
    <div className="px-4 pb-16">
      <div className="flex flex-wrap items-center gap-2 py-2">
        <DashboardSettings projectId={projectId} initial={prefs} />
        <span className="ml-auto" />
        <details className="relative">
          <summary className="flex h-7 cursor-pointer list-none items-center rounded-md border bg-white px-2 text-[13px] text-neutral-700 hover:bg-neutral-50 [&::-webkit-details-marker]:hidden">
            ⋯ オプション
          </summary>
          <div className="absolute right-0 z-30 mt-1 flex w-52 flex-col gap-1 rounded-lg border bg-white p-3 text-sm shadow-lg">
            <span className="text-neutral-500">エクスポート</span>
            <a
              href={`/api/projects/${projectId}/dashboard/export?format=json&days=${days}`}
              className="text-blue-700 hover:underline"
            >
              JSON
            </a>
            <a
              href={`/api/projects/${projectId}/dashboard/export?format=csv&days=${days}`}
              className="text-blue-700 hover:underline"
            >
              CSV
            </a>
          </div>
        </details>
      </div>
      {stats.total === 0 && (
        <EmptyState
          scope="dashboard"
          title="タスクがまだありません"
          description="リストからタスクを追加すると、完了トレンドや担当者別の集計が表示されます。"
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg border bg-white p-4">
            <div className="text-3xl font-bold text-neutral-800">{m.value}</div>
            <div className="mt-1 text-xs text-neutral-500">{m.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-x-6 xl:grid-cols-2">
        {prefs
          .filter((w) => w.visible)
          .map((w) => {
            switch (w.key) {
              case "donut":
                return <Donut key="donut" stats={stats} />;
              case "trend":
                return (
                  <div key="trend">
                    <div className="mt-6 flex items-center gap-1 text-sm">
                      <span className="font-semibold">完了トレンド：</span>
                      {[7, 14, 30].map((d) => (
                        <a
                          key={d}
                          href={`/projects/${projectId}?view=dashboard&days=${d}`}
                          className={`rounded-full border px-2 py-0.5 text-xs ${
                            d === days ? "border-blue-600 bg-blue-50 text-blue-700" : ""
                          }`}
                        >
                          {d}日
                        </a>
                      ))}
                    </div>
                    <TrendBars trend={extras.trend} />
                  </div>
                );
              case "sections":
                return <SectionProgress key="sections" projectId={projectId} view="board" stats={stats} />;
              case "assignees":
                return <AssigneeBars key="assignees" stats={stats} />;
              case "status":
                return extras.statusFieldEnabled ? (
                  <StatusBars key="status" stats={extras} />
                ) : (
                  <div
                    key="status"
                    data-dashboard-status-disabled
                    className="mt-6 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-5"
                  >
                    <h2 className="font-semibold text-neutral-800">Statusフィールドは削除されています</h2>
                    <p className="mt-1 text-sm text-neutral-500">
                      カスタマイズ → フィールドからStatusを再追加すると、保持されている値が再表示されます。
                    </p>
                  </div>
                );
              case "overdue":
                return <OverdueList key="overdue" projectId={projectId} overdue={extras.overdue} />;
            }
          })}
      </div>
    </div>
  );
}
