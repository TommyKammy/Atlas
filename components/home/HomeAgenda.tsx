"use client";

import Link from "next/link";
import { HOME_AGENDA_GROUP_LIMIT, homeDueDateLabel, homeDueGroups, homeDueSummary, homeDueSummaryText } from "@/lib/home-summary";
import type { HomeTask } from "@/lib/home-widgets";
import { listRowState } from "@/lib/list-row-state";
import DueStateIcon from "../task/DueStateIcon";
import TaskCompletionToggle from "../task/TaskCompletionToggle";

function HomeAgendaRow({
  task,
  today,
  busy,
  onToggle,
}: {
  task: HomeTask;
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
      className="group flex h-[38px] items-center gap-2 border-b border-line-subtle px-3 last:border-b-0 hover:bg-hover"
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
          className="block truncate text-[13px] text-text hover:underline"
          title={task.name}
        >
          {task.name}
        </Link>
        <span className="block truncate text-[10px] text-muted sm:hidden">
          {task.project_name ?? "–"}
        </span>
      </span>
      <span className="hidden w-[30%] max-w-[180px] shrink-0 truncate text-[11px] text-muted sm:block">
        {task.project_name ?? "–"}
      </span>
      <span
        className={`flex w-[84px] shrink-0 items-center justify-end gap-1 text-right text-[11px] sm:w-[86px] ${
          overdue ? "font-semibold text-danger" : "text-muted"
        }`}
        title={overdue && task.due_on ? `期限超過: ${task.due_on}` : undefined}
      >
        {overdue && <DueStateIcon state="overdue" sizeClassName="h-2.5 w-2.5" />}
        {overdue && <span className="sr-only">期限超過: </span>}
        <span className="truncate">{homeDueDateLabel(task.due_on, today)}</span>
      </span>
    </div>
  );
}

/** The fixed due-date agenda above the saved widget grid. */
export default function HomeAgenda({
  userName,
  tasks,
  today,
  busyTaskId,
  onToggle,
}: {
  userName: string;
  tasks: HomeTask[];
  today: string;
  busyTaskId: number | null;
  onToggle: (task: HomeTask) => void;
}) {
  const groups = homeDueGroups(tasks, today);
  const summary = homeDueSummary(tasks, today);
  const summaryText = homeDueSummaryText(summary);

  return (
    <div data-home-agenda>
      <h2
        id="home-agenda-title"
        data-home-agenda-title
        className="text-[24px] font-bold leading-tight text-text"
      >
        {userName}さん、今日は {summary.total}件です
      </h2>
      {summaryText && <p className="mt-1.5 text-[13px] text-muted">{summaryText}</p>}

      {groups.length === 0 ? (
        <p
          data-home-agenda-empty
          className="mt-5 rounded-lg bg-surface-subtle px-4 py-6 text-[13px] text-muted"
        >
          期日が近いタスクはありません
        </p>
      ) : (
        <div className="mt-3">
          {groups.map((group) => {
            const visible = group.tasks.slice(0, HOME_AGENDA_GROUP_LIMIT);
            const hidden = group.tasks.length - visible.length;
            return (
              <div key={group.key} data-home-agenda-group={group.key}>
                <h3
                  className={`px-3 pb-1 pt-3 text-[12px] font-bold ${
                    group.key === "overdue" ? "text-danger" : "text-muted"
                  }`}
                >
                  {group.label}
                </h3>
                <div>
                  {visible.map((task) => (
                    <HomeAgendaRow
                      key={task.id}
                      task={task}
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
                    className="mt-1 inline-block px-3 text-[12px] text-accent-text hover:underline"
                  >
                    ほか {hidden}件
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
