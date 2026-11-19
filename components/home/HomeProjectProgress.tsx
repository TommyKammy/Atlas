import Link from "next/link";
import { PROGRESS_BAR_COLORS } from "@/lib/data-colors";
import { homeProjectProgressPercent, homeProjectProgressText } from "@/lib/home-summary";
import type { HomeProject } from "@/lib/home-widgets";

/** Recently opened projects with parent-task completion, above the widgets. */
export default function HomeProjectProgress({ projects }: { projects: HomeProject[] }) {
  const visible = projects.slice(0, 5);
  return (
    <section data-home-progress aria-labelledby="home-progress-title">
      <h3 id="home-progress-title" className="text-[13px] font-bold text-text">
        プロジェクトの進み具合
      </h3>
      {visible.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted">表示できるプロジェクトはありません</p>
      ) : (
        <div className="mt-2">
          {visible.map((project) => {
            const percent = homeProjectProgressPercent(project.parent_total, project.parent_done) ?? 0;
            return (
              <Link
                key={project.id}
                href={`/projects/${project.id}?view=list`}
                data-home-progress-project={project.id}
                className="flex flex-col gap-1 rounded-md px-2 py-1.5 hover:bg-hover sm:grid sm:h-8 sm:grid-cols-[minmax(0,200px)_minmax(64px,1fr)_120px] sm:items-center sm:gap-4 sm:gap-y-0 sm:py-0"
              >
                <span className="min-w-0 truncate text-[13px] text-text" title={project.name}>
                  {project.name}
                </span>
                <span className="h-1 w-full overflow-hidden rounded-full bg-surface-strong">
                  <span
                    className={`block h-full rounded-full ${PROGRESS_BAR_COLORS.green}`}
                    style={{ width: `${percent}%` }}
                  />
                </span>
                <span className="text-right text-[12px] text-muted">
                  {homeProjectProgressText(project.parent_total, project.parent_done, project.parent_overdue)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
