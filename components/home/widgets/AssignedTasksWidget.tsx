"use client";

import { useState } from "react";
import { shiftDate } from "@/lib/timeline-dnd";
import type { HomeTask } from "@/lib/home-widgets";
import HomeTaskRow from "../HomeTaskRow";

type Tab = "period" | "upcoming" | "overdue" | "completed";

export default function AssignedTasksWidget({
  tasks,
  today,
  period,
  showCompleted,
  busyTaskId,
  onCompose,
  onToggle,
}: {
  tasks: HomeTask[];
  today: string;
  period: "week" | "month";
  showCompleted: boolean;
  busyTaskId: number | null;
  onCompose: () => void;
  onToggle: (task: HomeTask) => void;
}) {
  const [tab, setTab] = useState<Tab>("period");
  const end = shiftDate(today, period === "week" ? 7 : 30);
  const overdue = tasks.filter((task) => !task.completed && task.due_on !== null && task.due_on < today);
  const dueInPeriod = tasks.filter(
    (task) => !task.completed && task.due_on !== null && task.due_on >= today && task.due_on <= end,
  );
  const upcoming = tasks.filter(
    (task) => !task.completed && (task.due_on === null || task.due_on > end),
  );
  const completed = tasks.filter((task) => task.completed);
  const active: Tab = tab === "completed" && !showCompleted ? "period" : tab;
  const items =
    active === "overdue"
      ? overdue
      : active === "completed"
        ? completed
        : active === "upcoming"
          ? upcoming
          : dueInPeriod;
  const tabs: { key: Tab; label: string; count: number; hidden?: boolean }[] = [
    {
      key: "period",
      label: period === "week" ? "今週期限" : "今月期限",
      count: dueInPeriod.length,
    },
    { key: "upcoming", label: "今後のタスク", count: upcoming.length },
    { key: "overdue", label: "期限超過", count: overdue.length },
    { key: "completed", label: "完了", count: completed.length, hidden: !showCompleted },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center gap-1 border-b border-line-subtle px-4 py-1.5">
        {tabs
          .filter((item) => !item.hidden)
          .map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              data-home-tab={item.key}
              aria-pressed={active === item.key}
              className={`rounded-full px-2 py-0.5 text-[12px] ${
                active === item.key
                  ? "bg-accent-soft font-medium text-accent-text"
                  : "text-muted hover:bg-hover"
              }`}
            >
              {item.label} ({item.count})
            </button>
          ))}
        <span className="flex-1" />
        <button
          type="button"
          data-home-compose
          onClick={onCompose}
          className="rounded px-1.5 py-0.5 text-[12px] text-muted hover:bg-hover hover:text-secondary"
        >
          ＋ タスクを割り当てる
        </button>
      </div>
      <div className="min-h-[170px] flex-1">
        {items.length === 0 ? (
          <div className="flex h-full min-h-[170px] flex-col items-center justify-center gap-2 px-4 py-6 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong text-subtle">
              ✓
            </span>
            <p className="text-[12px] text-muted">表示するタスクはありません。</p>
            <button
              type="button"
              onClick={onCompose}
              className="text-[12px] text-accent-text hover:underline"
            >
              タスクを割り当てる
            </button>
          </div>
        ) : (
          items.slice(0, 8).map((task) => (
            <HomeTaskRow
              key={task.id}
              task={task}
              bucket={active}
              today={today}
              busy={busyTaskId === task.id}
              onToggle={onToggle}
            />
          ))
        )}
      </div>
    </>
  );
}
