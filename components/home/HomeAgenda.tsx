"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  HOME_AGENDA_GROUP_LIMIT,
  homeDueDateLabel,
  homeDueGroups,
  homeDueSummary,
  homeDueSummaryText,
  homeWeekCompletion,
  type HomeDueGroupKey,
} from "@/lib/home-summary";
import type { HomeTask } from "@/lib/home-widgets";
import { listRowState } from "@/lib/list-row-state";
import DueStateIcon from "../task/DueStateIcon";
import TaskCompletionToggle from "../task/TaskCompletionToggle";

/** Due chip: red for overdue, amber for today, plain text afterwards. */
const DUE_CHIP: Record<HomeDueGroupKey, string> = {
  overdue: "rounded bg-danger-soft px-1.5 py-px font-semibold text-danger",
  today: "rounded bg-warning-soft px-1.5 py-px font-semibold text-warning",
  week: "text-muted",
};

function HomeAgendaRow({
  task,
  group,
  today,
  busy,
  onToggle,
}: {
  task: HomeTask;
  group: HomeDueGroupKey;
  today: string;
  busy: boolean;
  onToggle: (task: HomeTask) => void;
}) {
  const state = listRowState(task, today);
  const overdue = state === "overdue";
  return (
    <div
      data-home-agenda-row={task.id}
      data-home-agenda-state={state}
      className="group flex h-10 items-center gap-2.5 rounded-md px-2 hover:bg-hover"
    >
      <TaskCompletionToggle
        completed={task.completed}
        state={state}
        onToggle={() => onToggle(task)}
        disabled={busy}
        size="h-[18px] w-[18px]"
        className={busy ? "opacity-50" : ""}
      />
      <span className="min-w-0 flex-1">
        <Link
          href={`/projects/${task.project_id}?view=list&task=${task.id}`}
          className="block truncate text-[13px] font-semibold text-text hover:underline"
          title={task.name}
        >
          {task.name}
        </Link>
        <span className="block truncate text-[10px] text-muted sm:hidden">
          {task.project_name ?? "–"}
        </span>
      </span>
      <span
        className="hidden max-w-[180px] shrink-0 truncate rounded bg-surface-muted px-1.5 py-px text-[11px] text-secondary sm:block"
        title={task.project_name ?? undefined}
      >
        {task.project_name ?? "–"}
      </span>
      <span
        className="flex w-[84px] shrink-0 items-center justify-end text-[11px] sm:w-[86px]"
        title={overdue && task.due_on ? `期限超過: ${task.due_on}` : undefined}
      >
        <span className={`inline-flex min-w-0 items-center gap-1 ${DUE_CHIP[group]}`}>
          {overdue && <DueStateIcon state="overdue" sizeClassName="h-2.5 w-2.5" />}
          {overdue && <span className="sr-only">期限超過: </span>}
          <span className="truncate">{homeDueDateLabel(task.due_on, today)}</span>
        </span>
      </span>
    </div>
  );
}

function Kpi({
  label,
  value,
  unit,
  dotClassName,
  href,
  tone = "plain",
  meter,
  name,
}: {
  label: string;
  value: number;
  unit: string;
  dotClassName?: string;
  href: string;
  tone?: "plain" | "alert";
  meter?: number;
  name: string;
}) {
  const toneClass =
    tone === "alert"
      ? "border-danger-line bg-surface text-text"
      : "border-line bg-surface text-text hover:border-line-strong";
  return (
    <Link
      href={href}
      data-home-kpi={name}
      className={`relative flex min-w-0 flex-col overflow-hidden rounded-[10px] border px-3.5 py-3 shadow-card ${toneClass}`}
    >
      {tone === "alert" && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-danger" />}
      <span className="flex items-center gap-1.5 text-[12px] text-muted">
        {dotClassName && <span aria-hidden className={`h-[7px] w-[7px] rounded-full ${dotClassName}`} />}
        {label}
      </span>
      <span
        className={`mt-1 text-[26px] font-bold leading-tight tabular-nums ${
          tone === "alert" && value > 0 ? "text-danger" : ""
        }`}
      >
        {value}
        <span className="ml-1 text-[12px] font-medium text-muted">{unit}</span>
      </span>
      {meter !== undefined && (
        <span aria-hidden className="mt-2 h-1 overflow-hidden rounded-full bg-surface-strong">
          <span className="block h-full rounded-full bg-success" style={{ width: `${meter}%` }} />
        </span>
      )}
    </Link>
  );
}

/**
 * The fixed area above the widgets: greeting with KPI tiles, then the due-date
 * agenda as a card beside `aside` (the inbox and decisions).
 */
export default function HomeAgenda({
  userName,
  tasks,
  today,
  unreadCount,
  busyTaskId,
  onToggle,
  aside,
}: {
  userName: string;
  tasks: HomeTask[];
  today: string;
  unreadCount: number;
  busyTaskId: number | null;
  onToggle: (task: HomeTask) => void;
  aside: ReactNode;
}) {
  const groups = homeDueGroups(tasks, today);
  const summary = homeDueSummary(tasks, today);
  const summaryText = homeDueSummaryText(summary);
  const week = homeWeekCompletion(tasks, today);
  const weekPercent = week.total === 0 ? 0 : Math.round((week.done / week.total) * 100);

  return (
    <div data-home-agenda className="flex flex-col gap-5">
      <div className="grid grid-cols-1 items-end gap-4 2xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <h2
            id="home-agenda-title"
            data-home-agenda-title
            className="text-[24px] font-bold leading-tight tracking-[-0.01em] text-text"
          >
            {userName}さん、今日は {summary.total}件です
          </h2>
          {summaryText && <p className="mt-1.5 text-[13px] text-muted">{summaryText}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:w-[600px]">
          <Kpi name="overdue" label="期限超過" value={summary.overdue} unit="件" dotClassName="bg-danger" tone="alert" href="/my-tasks" />
          <Kpi name="today" label="今日が期日" value={summary.today} unit="件" dotClassName="bg-warning" href="/my-tasks" />
          <Kpi name="unread" label="未読の通知" value={unreadCount} unit="件" dotClassName="bg-accent" href="/inbox" />
          <Kpi
            name="week"
            label="今週の完了"
            value={week.done}
            unit={`/ ${week.total} 件`}
            dotClassName="bg-success"
            meter={weekPercent}
            href="/my-tasks"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)]">
        <section
          data-home-focus
          aria-labelledby="home-focus-title"
          className="min-w-0 rounded-[10px] border border-line bg-surface shadow-card"
        >
          <div className="flex items-center gap-2 px-4 pb-2 pt-3.5">
            <h3 id="home-focus-title" className="text-[14px] font-bold text-text">
              今日のフォーカス
            </h3>
            <span className="rounded-full bg-surface-muted px-1.5 text-[11px] font-semibold tabular-nums text-secondary">
              {summary.total}
            </span>
            <span className="flex-1" />
            <Link href="/my-tasks" className="text-[12px] font-semibold text-accent-text hover:underline">
              マイタスクを開く →
            </Link>
          </div>
          {groups.length === 0 ? (
            <p data-home-agenda-empty className="mx-4 mb-4 rounded-lg bg-surface-subtle px-4 py-6 text-[13px] text-muted">
              期日が近いタスクはありません
            </p>
          ) : (
            <div className="px-2 pb-2">
              {groups.map((group) => {
                const visible = group.tasks.slice(0, HOME_AGENDA_GROUP_LIMIT);
                const hidden = group.tasks.length - visible.length;
                return (
                  <div key={group.key} data-home-agenda-group={group.key}>
                    <h4
                      className={`flex items-center gap-1.5 px-2 pb-1 pt-2.5 text-[12px] font-bold ${
                        group.key === "overdue" ? "text-danger" : "text-secondary"
                      }`}
                    >
                      {group.label}
                      <span className="font-medium tabular-nums text-muted">{group.tasks.length}</span>
                    </h4>
                    <div>
                      {visible.map((task) => (
                        <HomeAgendaRow
                          key={task.id}
                          task={task}
                          group={group.key}
                          today={today}
                          busy={busyTaskId === task.id}
                          onToggle={onToggle}
                        />
                      ))}
                    </div>
                    {hidden > 0 && (
                      <Link
                        data-home-agenda-more={group.key}
                        href="/my-tasks"
                        className="mt-1 inline-block px-2 text-[12px] font-semibold text-accent-text hover:underline"
                      >
                        ほか {hidden}件
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
        {aside}
      </div>
    </div>
  );
}
