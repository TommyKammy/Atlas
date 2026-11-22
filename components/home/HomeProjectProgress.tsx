import Link from "next/link";
import { PROGRESS_BAR_COLORS } from "@/lib/data-colors";
import { homeProjectProgressPercent, homeProjectProgressText } from "@/lib/home-summary";
import type { HomeProject } from "@/lib/home-widgets";
import ProjectIcon from "../ProjectIcon";

function projectState(project: HomeProject): { label: string; className: string } | null {
  // No parent task: the progress text already says タスクなし.
  if (project.parent_total === 0) return null;
  if (project.parent_overdue > 0) return { label: "期限超過あり", className: "bg-danger-soft text-danger" };
  if (project.parent_done === project.parent_total) return { label: "完了", className: "bg-success-soft text-success" };
  return null;
}

/** Recently opened projects with parent-task completion, above the widgets. */
export default function HomeProjectProgress({ projects }: { projects: HomeProject[] }) {
  const visible = projects.slice(0, 6);
  return (
    <section
      data-home-progress
      aria-labelledby="home-progress-title"
      className="rounded-[10px] border border-line bg-surface shadow-card"
    >
      <div className="flex items-center gap-2 px-4 pb-2.5 pt-3.5">
        <h3 id="home-progress-title" className="text-[14px] font-bold text-text">
          プロジェクトの進み具合
        </h3>
        <span className="flex-1" />
        <Link href="/portfolio" className="text-[12px] font-semibold text-accent-text hover:underline">
          ポートフォリオで見る →
        </Link>
      </div>
      {visible.length === 0 ? (
        <p className="px-4 pb-4 text-[13px] text-muted">表示できるプロジェクトはありません</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 px-4 pb-4 sm:grid-cols-2 2xl:grid-cols-3">
          {visible.map((project) => {
            const percent = homeProjectProgressPercent(project.parent_total, project.parent_done) ?? 0;
            const overduePercent =
              project.parent_total > 0
                ? Math.min(100 - percent, Math.round((project.parent_overdue / project.parent_total) * 100))
                : 0;
            const state = projectState(project);
            return (
              <Link
                key={project.id}
                href={`/projects/${project.id}?view=list`}
                data-home-progress-project={project.id}
                className="flex min-w-0 flex-col gap-2.5 rounded-lg border border-line px-3.5 py-3 hover:border-line-strong hover:bg-hover"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <ProjectIcon
                    id={project.id}
                    name={project.name}
                    color={project.color}
                    icon={project.icon}
                    className="h-7 w-7 text-[12px]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-text" title={project.name}>
                      {project.name}
                    </span>
                    <span className="block truncate text-[11px] text-muted">
                      未完了 {project.open_count}件
                      {project.due_soon > 0 ? ` ・ まもなく期限 ${project.due_soon}件` : ""}
                    </span>
                  </span>
                  {state && (
                    <span className={`shrink-0 rounded-full px-2 py-px text-[11px] font-semibold ${state.className}`}>
                      {state.label}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2.5">
                  <span className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-strong">
                    <span className={`block h-full ${PROGRESS_BAR_COLORS.green}`} style={{ width: `${percent}%` }} />
                    {overduePercent > 0 && (
                      <span className="block h-full bg-danger" style={{ width: `${overduePercent}%` }} />
                    )}
                  </span>
                  <span
                    className={`shrink-0 text-[12px] tabular-nums ${
                      project.parent_overdue > 0 ? "font-semibold text-danger" : "text-secondary"
                    }`}
                  >
                    {homeProjectProgressText(project.parent_total, project.parent_done, project.parent_overdue)}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
