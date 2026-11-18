"use client";

import Link from "next/link";
import { PROGRESS_BAR_COLORS } from "@/lib/data-colors";
import { useState } from "react";
import type { HomePortfolioProject } from "@/lib/home-widgets";
import ProjectIcon from "../../ProjectIcon";

type Tab = "saved" | "all";

/** Portfolio widget: progress and risk across the viewer's projects. */
export default function PortfolioWidget({ projects }: { projects: HomePortfolioProject[] }) {
  const savedCount = projects.filter((project) => project.saved).length;
  const [tab, setTab] = useState<Tab>(savedCount > 0 ? "saved" : "all");
  const active: Tab = tab === "saved" && savedCount === 0 ? "all" : tab;
  const scoped = active === "saved" ? projects.filter((project) => project.saved) : projects;
  const totals = scoped.reduce(
    (acc, project) => ({
      total: acc.total + project.total,
      done: acc.done + project.done,
      overdue: acc.overdue + project.overdue,
    }),
    { total: 0, done: 0, overdue: 0 },
  );
  const pct = totals.total === 0 ? 0 : Math.round((totals.done / totals.total) * 100);

  return (
    <>
      <div className="flex items-center gap-1 border-b border-line-subtle px-4 py-1.5">
        <button
          type="button"
          onClick={() => setTab("saved")}
          data-home-tab="saved"
          aria-pressed={active === "saved"}
          className={`rounded-full px-2 py-0.5 text-[12px] ${
            active === "saved"
              ? "bg-accent-soft font-medium text-accent-text"
              : "text-muted hover:bg-hover"
          }`}
        >
          マイポートフォリオ ({savedCount})
        </button>
        <button
          type="button"
          onClick={() => setTab("all")}
          data-home-tab="all"
          aria-pressed={active === "all"}
          className={`rounded-full px-2 py-0.5 text-[12px] ${
            active === "all"
              ? "bg-accent-soft font-medium text-accent-text"
              : "text-muted hover:bg-hover"
          }`}
        >
          すべて ({projects.length})
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 border-b border-line-subtle px-4 py-2 text-center">
        <div>
          <div className="text-[16px] font-semibold text-text">{scoped.length}</div>
          <div className="text-[10px] text-subtle">プロジェクト</div>
        </div>
        <div>
          <div className="text-[16px] font-semibold text-text">{pct}%</div>
          <div className="text-[10px] text-subtle">完了率</div>
        </div>
        <div>
          <div
            className={`text-[16px] font-semibold ${
              totals.overdue > 0 ? "text-danger" : "text-text"
            }`}
          >
            {totals.overdue}
          </div>
          <div className="text-[10px] text-subtle">期限超過</div>
        </div>
      </div>

      <div className="min-h-[170px] flex-1 p-2">
        {scoped.length === 0 ? (
          <div className="flex h-full min-h-[150px] flex-col items-center justify-center gap-2 px-4 py-6 text-center">
            <p className="text-[12px] text-muted">
              {active === "saved"
                ? "マイポートフォリオにプロジェクトがありません。"
                : "表示するプロジェクトがありません。"}
            </p>
            <Link href="/portfolio" className="text-[12px] text-accent-text hover:underline">
              ポートフォリオを開く
            </Link>
          </div>
        ) : (
          scoped.slice(0, 6).map((project) => {
            const progress = project.total === 0 ? 0 : Math.round((project.done / project.total) * 100);
            return (
              <Link
                key={project.id}
                href={`/projects/${project.id}?view=list`}
                data-home-portfolio-row={project.id}
                className="grid grid-cols-[minmax(0,1fr)_110px_58px] items-center gap-2 rounded-md px-2 py-2 hover:bg-hover"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <ProjectIcon
                    id={project.id}
                    name={project.name}
                    color={project.color}
                    icon={project.icon}
                    className="h-6 w-6 text-[10px]"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-text">
                      {project.name}
                    </span>
                    <span className="block truncate text-[10px] text-subtle">
                      {project.members}人
                      {project.min_due ? ` ・ ${project.min_due}〜${project.max_due ?? ""}` : ""}
                    </span>
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded bg-surface-strong">
                    <span className={`block h-full ${PROGRESS_BAR_COLORS.green}`} style={{ width: `${progress}%` }} />
                  </span>
                  <span className="shrink-0 text-[10px] text-muted">
                    {project.done}/{project.total}
                  </span>
                </span>
                <span
                  className={`text-right text-[11px] ${
                    project.overdue > 0 ? "font-semibold text-danger" : "text-subtle"
                  }`}
                >
                  {project.overdue > 0 ? `${project.overdue}件遅延` : "順調"}
                </span>
              </Link>
            );
          })
        )}
      </div>

      <div className="border-t border-line-subtle px-4 py-1.5 text-right">
        <Link href="/portfolio" className="text-[12px] text-muted hover:text-text">
          ポートフォリオをすべて表示
        </Link>
      </div>
    </>
  );
}
