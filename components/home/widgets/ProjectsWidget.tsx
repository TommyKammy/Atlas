"use client";

import Link from "next/link";
import { useState } from "react";
import type { HomeProject } from "@/lib/home-widgets";
import ProjectIcon from "../../ProjectIcon";

type Tab = "recent" | "search";

export default function ProjectsWidget({
  projects,
}: {
  projects: HomeProject[];
}) {
  const [tab, setTab] = useState<Tab>("recent");
  const [query, setQuery] = useState("");
  const filtered =
    query.trim() === ""
      ? projects
      : projects.filter((project) => project.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <>
      <div className="flex items-center gap-1 border-b border-neutral-100 px-4 py-1.5">
        <button
          type="button"
          onClick={() => setTab("recent")}
          data-home-tab="recent"
          aria-pressed={tab === "recent"}
          className={`rounded-full px-2 py-0.5 text-[12px] ${
            tab === "recent"
              ? "bg-[#eff4fd] font-medium text-[#2c60b8]"
              : "text-neutral-500 hover:bg-neutral-100"
          }`}
        >
          最近
        </button>
        <button
          type="button"
          onClick={() => setTab("search")}
          data-home-tab="search"
          aria-pressed={tab === "search"}
          className={`rounded-full px-2 py-0.5 text-[12px] ${
            tab === "search"
              ? "bg-[#eff4fd] font-medium text-[#2c60b8]"
              : "text-neutral-500 hover:bg-neutral-100"
          }`}
        >
          プロジェクトを探す
        </button>
      </div>
      {tab === "search" && (
        <div className="border-b border-neutral-100 px-4 py-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="プロジェクト名で検索"
            autoFocus
            className="w-full rounded border border-neutral-200 px-2 py-1 text-[12px] outline-none focus:border-blue-500"
          />
        </div>
      )}
      <div className="min-h-[190px] flex-1 p-3">
        {filtered.length === 0 ? (
          <div className="flex h-full min-h-[170px] flex-col items-center justify-center gap-2 px-4 py-6 text-center">
            <p className="text-[12px] text-neutral-400">
              {tab === "search" && query.trim() !== ""
                ? "一致するプロジェクトがありません。"
                : "プロジェクトがありません。"}
            </p>
            <Link
              href="/projects/new"
              className="rounded bg-[#2c60b8] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#24529c]"
            >
              ＋ 新規プロジェクト
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {filtered.slice(0, 8).map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}?view=list`}
                  data-home-project-row={project.id}
                  className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2 hover:bg-neutral-50"
                >
                  <ProjectIcon
                    id={project.id}
                    name={project.name}
                    color={project.color}
                    icon={project.icon}
                    className="h-7 w-7 text-[11px]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-neutral-800">
                      {project.name}
                    </span>
                    <span className="block truncate text-[11px] text-neutral-400">
                      {project.due_soon > 0
                        ? `${project.due_soon}件のまもなく期限のタスク`
                        : `${project.open_count}件の未完了タスク`}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
            {projects.length > 0 && (
              <div className="mt-2">
                <Link
                  href="/projects/new"
                  className="text-[12px] text-[#2c60b8] hover:underline"
                >
                  ＋ 新規プロジェクト
                </Link>
              </div>
            )}
          </>
        )}
      </div>
      <div className="border-t border-neutral-100 px-4 py-1.5 text-right">
        <Link href="/portfolio" className="text-[12px] text-neutral-500 hover:text-neutral-800">
          プロジェクトをすべて表示
        </Link>
      </div>
    </>
  );
}
