"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDateTime } from "@/lib/dates";
import type { HomeForm } from "@/lib/home-widgets";
import ProjectIcon from "../../ProjectIcon";

type Tab = "published" | "all";

/** Forms across visible projects with response counts. */
export default function FormsWidget({ forms }: { forms: HomeForm[] }) {
  const publishedCount = forms.filter((form) => form.published).length;
  const [tab, setTab] = useState<Tab>(publishedCount > 0 ? "published" : "all");
  const active: Tab = tab === "published" && publishedCount === 0 ? "all" : tab;
  const scoped = active === "published" ? forms.filter((form) => form.published) : forms;

  return (
    <>
      <div className="flex items-center gap-1 border-b border-line-subtle px-4 py-1.5">
        <button
          type="button"
          onClick={() => setTab("published")}
          data-home-tab="published"
          aria-pressed={active === "published"}
          className={`rounded-full px-2 py-0.5 text-[12px] ${
            active === "published"
              ? "bg-accent-soft font-medium text-accent-text"
              : "text-muted hover:bg-hover"
          }`}
        >
          公開中 ({publishedCount})
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
          すべて ({forms.length})
        </button>
      </div>

      <div className="min-h-[170px] flex-1 p-2">
        {scoped.length === 0 ? (
          <div className="flex h-full min-h-[150px] flex-col items-center justify-center gap-2 px-4 py-6 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong text-subtle">
              📝
            </span>
            <p className="text-[12px] text-muted">
              {active === "published" ? "公開中のフォームはありません。" : "フォームはまだありません。"}
            </p>
            <p className="text-[11px] text-muted">
              プロジェクトの「フォーム」タブから作成できます。
            </p>
          </div>
        ) : (
          scoped.slice(0, 7).map((form) => (
            <Link
              key={form.id}
              href={`/projects/${form.project_id}?view=forms`}
              data-home-form-row={form.id}
              className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2 hover:bg-hover"
            >
              <ProjectIcon
                id={form.project_id}
                name={form.project_name}
                color={form.project_color}
                icon={form.project_icon}
                className="h-7 w-7 text-[10px]"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium text-text">
                    {form.name}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1 py-px text-[9px] ${
                      form.published
                        ? "bg-success-soft text-success"
                        : "bg-surface-muted text-muted"
                    }`}
                  >
                    {form.published ? "公開中" : "下書き"}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-subtle">
                  {form.project_name} ・ 回答 {form.response_count}件 ・ {formatDateTime(form.updated_at)}
                </span>
              </span>
            </Link>
          ))
        )}
      </div>

      <div className="border-t border-line-subtle px-4 py-1.5 text-right">
        <Link href="/portfolio" className="text-[12px] text-muted hover:text-text">
          プロジェクトをすべて表示
        </Link>
      </div>
    </>
  );
}
