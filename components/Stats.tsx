import Link from "next/link";
import type { ProjectStats } from "@/lib/data";
import { AVATAR_COLORS, CHART_COMPLETION_COLOR, PROGRESS_BAR_COLORS } from "@/lib/data-colors";

export function StatCards({ stats }: { stats: ProjectStats }) {
  const pct = stats.total === 0 ? 0 : Math.round((stats.done / stats.total) * 100);
  const cards: [string, string][] = [
    ["進捗率", `${pct}%`],
    ["完了", `${stats.done}/${stats.total}`],
    ["期限超過", `${stats.overdue}`],
    ["今週期限", `${stats.dueWeek}`],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map(([label, value]) => (
        <div key={label} className="rounded-lg border p-4">
          <div className="text-xs text-muted">{label}</div>
          <div className="mt-1 text-2xl font-bold">{value}</div>
        </div>
      ))}
    </div>
  );
}

export function SectionProgress({
  projectId,
  view,
  stats,
}: {
  projectId: number;
  view: string;
  stats: ProjectStats;
}) {
  return (
    <div className="mt-6">
      <h2 className="font-semibold">セクション別進捗</h2>
      <div className="mt-2 space-y-2">
        {stats.bySection.map((s) => {
          const pct = s.total === 0 ? 0 : Math.round((s.done / s.total) * 100);
          return (
            <div key={s.id}>
              <div className="flex items-center gap-2 text-sm">
                <Link
                  href={`/projects/${projectId}?view=${view}`}
                  className="w-40 shrink-0 truncate font-medium hover:underline"
                >
                  {s.name}
                </Link>
                <div className="h-2 min-w-0 flex-1 overflow-hidden rounded bg-surface-strong">
                  <div className={`h-full ${PROGRESS_BAR_COLORS.green}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="w-24 shrink-0 text-right text-xs text-muted">
                  {s.done}/{s.total}（{pct}%）
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function UpcomingList({
  projectId,
  stats,
}: {
  projectId: number;
  stats: ProjectStats;
}) {
  return (
    <div className="mt-6">
      <h2 className="font-semibold">期限が近いタスク</h2>
      {stats.upcoming.length === 0 && (
        <p className="mt-1 text-sm text-muted">期限付きの未完了タスクはありません。</p>
      )}
      <div className="mt-1">
        {stats.upcoming.map((t) => (
          <div key={t.id} className="flex items-center gap-3 border-b py-1.5 text-sm">
            <Link
              href={`/projects/${projectId}?view=list&task=${t.id}`}
              className="min-w-0 flex-1 truncate hover:underline"
            >
              {t.name}
            </Link>
            <span className="shrink-0 text-xs text-muted">{t.assignee_name ?? "–"}</span>
            <span className="w-24 shrink-0 text-secondary">{t.due_on}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Donut({ stats }: { stats: ProjectStats }) {
  const pct = stats.total === 0 ? 0 : stats.done / stats.total;
  const r = 54;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-4">
      <svg width="130" height="130" viewBox="0 0 130 130">
        <circle cx="65" cy="65" r={r} fill="none" stroke="var(--atlas-surface-strong)" strokeWidth="14" />
        <circle
          cx="65"
          cy="65"
          r={r}
          fill="none"
          stroke={CHART_COMPLETION_COLOR}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          transform="rotate(-90 65 65)"
        />
        <text x="65" y="70" textAnchor="middle" fontSize="20" fontWeight="bold">
          {Math.round(pct * 100)}%
        </text>
      </svg>
      <div className="text-sm text-secondary">
        完了 {stats.done} / 全体 {stats.total}
        <br />
        期限超過 {stats.overdue} ・ 今週期限 {stats.dueWeek}
      </div>
    </div>
  );
}

export function StatusBars({ stats }: { stats: { byStatus: { status: string; n: number }[] } }) {
  const max = Math.max(1, ...stats.byStatus.map((s) => s.n));
  return (
    <div className="mt-6">
      <h2 className="font-semibold">Status別タスク数</h2>
      {stats.byStatus.length === 0 && (
        <p className="mt-1 text-sm text-muted">タスクはありません。</p>
      )}
      <div className="mt-2 space-y-2">
        {stats.byStatus.map((s) => (
          <div key={s.status} className="flex items-center gap-2 text-sm">
            <span className="w-32 shrink-0 truncate">{s.status}</span>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded bg-surface-strong">
              <div className={`h-full ${PROGRESS_BAR_COLORS.amber}`} style={{ width: `${(s.n / max) * 100}%` }} />
            </div>
            <span className="w-10 shrink-0 text-right text-xs text-muted">{s.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OverdueList({
  projectId,
  overdue,
}: {
  projectId: number;
  overdue: { id: number; name: string; due_on: string | null; assignee_name: string | null }[];
}) {
  return (
    <div className="mt-6">
      <h2 className="font-semibold">期限超過（{overdue.length}）</h2>
      {overdue.length === 0 && (
        <p className="mt-1 text-sm text-muted">期限超過タスクはありません。</p>
      )}
      {overdue.map((t) => (
        <div key={t.id} className="flex items-center gap-3 border-b py-1.5 text-sm">
          <a
            href={`/projects/${projectId}?view=list&task=${t.id}`}
            className="min-w-0 flex-1 truncate font-semibold text-danger hover:underline"
          >
            {t.name}
          </a>
          <span className="shrink-0 text-xs text-muted">{t.assignee_name ?? "–"}</span>
          <span className="w-24 shrink-0 font-semibold text-danger">{t.due_on}</span>
        </div>
      ))}
    </div>
  );
}

export function TrendBars({ trend }: { trend: { day: string; n: number }[] }) {
  const max = Math.max(1, ...trend.map((t) => t.n));
  return (
    <div className="mt-6">
      <h2 className="font-semibold">直近{trend.length}日の完了数</h2>
      <div className="mt-2 flex items-end gap-1">
        {trend.map((t) => (
          <div key={t.day} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${t.day}: ${t.n}件`}>
            <span className="text-[10px] text-muted">{t.n > 0 ? t.n : ""}</span>
            <div className="flex h-20 w-full items-end rounded bg-surface-muted">
              <div className={`w-full rounded ${PROGRESS_BAR_COLORS.green}`} style={{ height: `${(t.n / max) * 100}%` }} />
            </div>
            <span className="text-[9px] text-subtle">{t.day.slice(5)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AssigneeBars({ stats }: { stats: ProjectStats }) {
  const max = Math.max(1, ...stats.byAssignee.map((a) => a.open));
  return (
    <div className="mt-6">
      <h2 className="font-semibold">担当者別 未完了タスク</h2>
      {stats.byAssignee.length === 0 && (
        <p className="mt-1 text-sm text-muted">未完了タスクはありません。</p>
      )}
      <div className="mt-2 space-y-2">
        {stats.byAssignee.map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-sm">
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${AVATAR_COLORS[0]}`}>
              {a.name.slice(0, 1)}
            </span>
            <span className="w-32 shrink-0 truncate">{a.name}</span>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded bg-surface-strong">
              <div className={`h-full ${PROGRESS_BAR_COLORS.blue}`} style={{ width: `${(a.open / max) * 100}%` }} />
            </div>
            <span className="w-10 shrink-0 text-right text-xs text-muted">{a.open}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
