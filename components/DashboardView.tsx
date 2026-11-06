import type { DashboardExtras, ProjectStats } from "@/lib/data";
import type { DashboardWidgetKey } from "@/lib/dashboard-widgets";
import { AssigneeBars, Donut, OverdueList, SectionProgress, StatusBars, TrendBars } from "./Stats";
import DashboardSettings from "./DashboardSettings";

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
                return <StatusBars key="status" stats={extras} />;
              case "overdue":
                return <OverdueList key="overdue" projectId={projectId} overdue={extras.overdue} />;
            }
          })}
      </div>
    </div>
  );
}
