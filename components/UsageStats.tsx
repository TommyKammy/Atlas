"use client";

import { useEffect, useState } from "react";

type Series = { day: string; n: number }[];

function Bars({ data, color }: { data: Series; color: string }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  return (
    <div className="flex items-end gap-1">
      {data.map((d) => (
        <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.n}件`}>
          <span className="text-[10px] text-neutral-500">{d.n > 0 ? d.n : ""}</span>
          <div className="flex h-16 w-full items-end rounded bg-neutral-100">
            <div className={`w-full rounded ${color}`} style={{ height: `${(d.n / max) * 100}%` }} />
          </div>
          <span className="text-[9px] text-neutral-400">{d.day.slice(5)}</span>
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
    <div className="mt-8">
      <h2 className="font-semibold">利用状況（直近14日）</h2>
      <p className="mt-1 text-sm text-neutral-500">直近7日のアクティブユーザー: {stats.active_users_7d}人</p>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <h3 className="text-sm font-medium">タスク作成</h3>
          <Bars data={stats.created} color="bg-blue-500" />
        </div>
        <div>
          <h3 className="text-sm font-medium">タスク完了</h3>
          <Bars data={stats.completed} color="bg-green-500" />
        </div>
        <div>
          <h3 className="text-sm font-medium">コメント</h3>
          <Bars data={stats.comments} color="bg-amber-500" />
        </div>
      </div>
    </div>
  );
}
