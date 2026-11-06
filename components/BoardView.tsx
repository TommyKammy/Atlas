"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Section, TaskRow } from "@/lib/data";
import { todayISO } from "@/lib/dates";
import { groupBoardTasks, type BoardGroup } from "@/lib/board-group";
import { useLive } from "@/lib/use-live";
import { useApiRefresh, dueSegs } from "./ListView";

async function api(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
  return res.json();
}



export default function BoardView({
  projectId,
  sections,
  tasks,
  initialGroup,
}: {
  projectId: number;
  sections: Section[];
  tasks: TaskRow[];
  users: unknown;
  initialGroup: "section" | "assignee" | "status";
}) {
  const refresh = useApiRefresh();
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<"section" | "assignee" | "status">(initialGroup);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const onLive = useCallback(() => router.refresh(), [router]);
  useLive(projectId, autoRefresh, onLive);
  const dragging = useRef(false);
  const openTask = (id: number) => {
    const q = new URLSearchParams(window.location.search);
    q.set("task", String(id));
    router.push(`/projects/${projectId}?${q.toString()}`);
  };
  const cardClick = (e: React.MouseEvent, id: number) => {
    if (dragging.current) return;
    if ((e.target as HTMLElement).closest("a,button,input,select,textarea,[contenteditable]")) return;
    openTask(id);
  };

  const today = todayISO();
  const sectionName = new Map(sections.map((s) => [s.id, s.name] as const));

  const groups: BoardGroup<TaskRow>[] = groupBoardTasks(
    tasks,
    sections.map((sc) => sc.id),
    groupBy,
  );
  for (const g of groups) {
    if (g.sectionId !== undefined) {
      g.label = sections.find((sc) => sc.id === g.sectionId)?.name ?? "";
    }
  }

  const patchTask = async (taskId: number, fields: Record<string, unknown>) => {
    const target = tasks.find((t) => t.id === taskId);
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fields, expected_updated_at: target?.updated_at }),
    });
    if (res.status === 409) {
      alert("他のユーザーが先に更新しました。最新を表示します。");
      refresh();
      return;
    }
    if (!res.ok) throw new Error(`PATCH /api/tasks/${taskId}: ${res.status}`);
    refresh();
  };

  const onDrop = async (e: React.DragEvent, g: BoardGroup<TaskRow>) => {
    e.preventDefault();
    const taskId = Number(e.dataTransfer.getData("text/atlas-task"));
    if (!taskId) return;
    const moved = tasks.find((t) => t.id === taskId);
    if (!moved) return;
    await applyMove(moved, g);
  };

  const applyMove = async (moved: TaskRow, g: BoardGroup<TaskRow>) => {
    const taskId = moved.id;
    if (g.sectionId !== undefined) {
      const col = g.items;
      const maxPos = col.reduce((mm, t) => Math.max(mm, t.position), 0);
      if (moved.project_id !== null && moved.project_id !== projectId) {
        await api("/api/memberships", "POST", {
          task_id: taskId,
          project_id: projectId,
          section_id: g.sectionId,
        });
        refresh();
      } else {
        await patchTask(taskId, { section_id: g.sectionId, position: maxPos + 1000 });
      }
    } else if (g.assigneeId !== undefined) {
      if ((moved.assignee_id ?? null) !== (g.assigneeId ?? null)) {
        await patchTask(taskId, { assignee_id: g.assigneeId });
      }
    } else if (g.status !== undefined) {
      if (moved.status !== g.status) await patchTask(taskId, { status: g.status });
    }
  };

  const moveCard = async (t: TaskRow, dir: -1 | 1) => {
    const gi = groups.findIndex((g) => g.items.some((x) => x.id === t.id));
    const target = groups[gi + dir];
    if (gi === -1 || !target) return;
    await applyMove(t, target);
  };

  const addTask = async (g: BoardGroup<TaskRow>) => {
    const name = (drafts[g.key] ?? "").trim();
    if (!name) return;
    const sectionId = g.sectionId ?? sections[0]?.id ?? null;
    const base: Record<string, unknown> = { project_id: projectId, section_id: sectionId, name };
    if (g.assigneeId !== undefined && g.assigneeId !== null) base.assignee_id = g.assigneeId;
    if (g.status !== undefined) base.status = g.status;
    await api("/api/tasks", "POST", base);
    setDrafts((d) => ({ ...d, [g.key]: "" }));
    refresh();
  };

  return (
    <div>
      <div className="flex items-center gap-2 px-4 pt-2 text-sm text-neutral-600">
        <span className="font-semibold text-neutral-800">ボード</span>
        <span className="ml-auto" />
        <label className="flex items-center gap-1 text-[13px]">
          グループ
          <select
            value={groupBy}
            onChange={(e) => {
              const v = e.target.value as typeof groupBy;
              setGroupBy(v);
              router.push(`/projects/${projectId}?view=board&group=${v}`);
            }}
            className="h-7 rounded-md border bg-white px-1.5 text-[13px] text-neutral-700 outline-none hover:bg-neutral-50"
          >
            <option value="section">セクション</option>
            <option value="assignee">担当者</option>
            <option value="status">Status</option>
          </select>
        </label>
        <label className="flex h-7 items-center gap-1 rounded-md border bg-white px-1.5 text-[13px] hover:bg-neutral-50" title="20秒ごとに自動更新（表示中のみ）">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          自動更新
        </label>
      </div>
      <div className="flex gap-3 overflow-x-auto p-4 pb-16">
        {groups.map((g) => (
          <div
            key={g.key}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(e, g)}
            className="w-72 shrink-0 rounded-lg bg-neutral-100 p-2"
          >
            <div className="flex items-baseline gap-2 px-1 py-1">
              <span className="font-semibold">{g.label}</span>
              <span className="text-sm text-neutral-500">{g.items.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {g.items.map((t) => (
                <div
                  key={t.id}
                  draggable
                  onDragStart={(e) => {
                    dragging.current = true;
                    e.dataTransfer.setData("text/atlas-task", String(t.id));
                  }}
                  onDragEnd={() => {
                    setTimeout(() => {
                      dragging.current = false;
                    }, 0);
                  }}
                  onClick={(e) => cardClick(e, t.id)}
                  className="cursor-pointer rounded-lg border border-[#eaeaea] bg-white p-2 text-sm shadow-[0_1px_4px_rgba(0,0,0,0.06)] hover:shadow-md active:cursor-grabbing"
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                        t.completed ? "border-green-600 bg-green-600 text-white" : "border-neutral-400"
                      }`}
                    >
                      {t.completed && "✓"}
                    </span>
                    <Link
                      href={`/projects/${projectId}?view=board&task=${t.id}`}
                      className={t.completed ? "text-neutral-400 line-through" : ""}
                    >
                      {t.name}
                    </Link>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                    {groupBy !== "section" && (t.eff_section_id ?? t.section_id) !== null && (
                      <span className="rounded bg-neutral-200 px-1.5 py-0.5">
                        {sectionName.get((t.eff_section_id ?? t.section_id) as number) ?? ""}
                      </span>
                    )}
                    {t.assignee_name && (
                      <span className="flex items-center gap-1">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-400 text-[10px] font-bold text-white">
                          {t.assignee_name.slice(0, 1)}
                        </span>
                        {t.assignee_name}
                      </span>
                    )}
                    {(t.start_on || t.due_on) && (
                      (() => {
                        const [s1, s2] = dueSegs(t.start_on, t.due_on);
                        return (
                          <span
                            className={`rounded-full px-1.5 py-0.5 ${
                              !t.completed && t.due_on !== null && t.due_on < today
                                ? "bg-red-100 font-semibold text-red-700"
                                : "bg-neutral-100 text-neutral-500"
                            }`}
                          >
                            <span className="whitespace-nowrap">{s1}</span>
                            {s2 && <span className="whitespace-nowrap"> – {s2}</span>}
                          </span>
                        );
                      })()
                    )}
                    {t.status !== "inbox" && (
                      <span
                        className={`rounded-full px-1.5 py-0.5 ${
                          t.status === "Done"
                            ? "bg-green-100 text-green-800"
                            : t.status === "進行中"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-neutral-100 text-neutral-500"
                        }`}
                      >
                        {t.status}
                      </span>
                    )}
                    {t.comment_count > 0 && <span>◔{t.comment_count}</span>}
                  </div>
                  <div className="mt-1 flex gap-1 md:hidden">
                    <button
                      onClick={() => moveCard(t, -1)}
                      className="rounded border px-2 py-0.5 text-xs"
                    >
                      ←
                    </button>
                    <button
                      onClick={() => moveCard(t, 1)}
                      className="rounded border px-2 py-0.5 text-xs"
                    >
                      →
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {addingTo === g.key ? (
              <div className="mt-2 flex gap-1">
                <input
                  value={drafts[g.key] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [g.key]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      addTask(g);
                      setAddingTo(null);
                    }
                    if (e.key === "Escape") setAddingTo(null);
                  }}
                  onBlur={() => {
                    if ((drafts[g.key] ?? "").trim() === "") setAddingTo(null);
                  }}
                  placeholder="タスク名を入力"
                  data-add-task
                  autoFocus
                  className="w-full rounded border px-2 py-1 text-sm outline-none focus:border-blue-500"
                />
                <button
                  onClick={() => {
                    addTask(g);
                    setAddingTo(null);
                  }}
                  className="shrink-0 rounded bg-blue-600 px-2 py-1 text-sm text-white"
                >
                  追加
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAddingTo(g.key)}
                data-add-task-open
                className="mt-2 w-full rounded px-2 py-1 text-left text-sm text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-700"
              >
                ＋ タスクを追加
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
