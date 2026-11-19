"use client";

import { useEffect, useState } from "react";
import { PROGRESS_BAR_COLORS } from "@/lib/data-colors";
import { usageDayLabel, usageValueLabel } from "@/lib/usage-display";

type Series = { day: string; n: number }[];

function Bars({ data, color }: { data: Series; color: string }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  return (
    <div className="flex items-end gap-1">
      {data.map((d, index) => (
        <div
          key={d.day}
          role="img"
          aria-label={`${d.day}: ${d.n}件`}
          className="flex min-w-0 flex-1 flex-col items-center gap-1"
          title={`${d.day}: ${d.n}件`}
        >
          <span className="text-[11px] tabular-nums text-muted">
            {usageValueLabel(d.n, index, data.length)}
          </span>
          <div className="flex h-16 w-full items-end rounded bg-surface-muted">
            <div className={`w-full rounded ${color}`} style={{ height: `${(d.n / max) * 100}%` }} />
          </div>
          <span className="text-[11px] tabular-nums whitespace-nowrap text-muted">
            {usageDayLabel(d.day, index, data.length)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function UsageStats() {
  const [stats, setStats] = useState<{
    created: Series;
    completed: Series;
    comments: Series;
    active_users_7d: number;
  } | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setStats)
      .catch(() => undefined);
  }, []);

  if (!stats) return null;
  return (
    <div className="mt-6">
      <h3 className="text-[13px] font-semibold text-text">利用状況（直近14日）</h3>
      <p className="mt-1 text-[12px] text-muted">
        直近7日のアクティブユーザー: <span className="tabular-nums text-secondary">{stats.active_users_7d}</span>人
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-lg bg-surface-subtle p-3">
          <h4 className="text-[12px] font-medium text-secondary">タスク作成</h4>
          <div className="mt-2">
            <Bars data={stats.created} color={PROGRESS_BAR_COLORS.created} />
          </div>
        </div>
        <div className="rounded-lg bg-surface-subtle p-3">
          <h4 className="text-[12px] font-medium text-secondary">タスク完了</h4>
          <div className="mt-2">
            <Bars data={stats.completed} color={PROGRESS_BAR_COLORS.completed} />
          </div>
        </div>
        <div className="rounded-lg bg-surface-subtle p-3">
          <h4 className="text-[12px] font-medium text-secondary">コメント</h4>
          <div className="mt-2">
            <Bars data={stats.comments} color={PROGRESS_BAR_COLORS.comments} />
          </div>
        </div>
      </div>
    </div>
  );
}
