"use client";

import Link from "next/link";
import { useState } from "react";
import { shiftDate } from "@/lib/timeline-dnd";
import type { HomeTask } from "@/lib/home-widgets";
import HomeTaskRow from "../HomeTaskRow";

type Tab = "upcoming" | "overdue" | "completed";

export default function MyTasksWidget({
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
  const [tab, setTab] = useState<Tab>("upcoming");
  const end = shiftDate(today, period === "week" ? 7 : 30);
  const overdue = tasks.filter((task) => !task.completed && task.due_on !== null && task.due_on < today);
  const upcoming = tasks.filter(
    (task) =>
      !task.completed &&
      !(task.due_on !== null && task.due_on < today) &&
      (task.due_on === null || task.due_on <= end),
  );
  const completed = tasks.filter((task) => task.completed);
  const active: Tab = tab === "completed" && !showCompleted ? "upcoming" : tab;
  const items = active === "overdue" ? overdue : active === "completed" ? completed : upcoming;
  const tabs: { key: Tab; label: string; count: number; hidden?: boolean }[] = [
    { key: "upcoming", label: "今後", count: upcoming.length },
    { key: "overdue", label: "期限超過", count: overdue.length },
    { key: "completed", label: "完了", count: completed.length, hidden: !showCompleted },
  ];

  return (
    <>
      <div className="flex items-center gap-1 border-b border-line-subtle px-4 py-1.5">
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
          ＋ タスクを作成
        </button>
      </div>
      <div className="min-h-[170px] flex-1">
        {items.length === 0 ? (
          <div className="flex h-full min-h-[170px] flex-col items-center justify-center gap-2 px-4 py-6 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong text-subtle">
              ✓
            </span>
            <p className="text-[12px] text-muted">
              {active === "completed" ? "完了したタスクはありません。" : "この期間のタスクはありません。"}
            </p>
            <button
              type="button"
              onClick={onCompose}
              className="text-[12px] text-accent-text hover:underline"
            >
              タスクを作成
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
      <div className="border-t border-line-subtle px-4 py-1.5 text-right">
        <Link href="/my-tasks" className="text-[12px] text-muted hover:text-text">
          マイタスクをすべて表示
        </Link>
      </div>
    </>
  );
}
