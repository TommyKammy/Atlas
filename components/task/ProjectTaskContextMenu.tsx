"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import type { TaskRow } from "@/lib/data";
import { patchTask, TaskConflictError } from "@/lib/task-client";
import { confirmAction, toast } from "@/lib/ui-feedback";
import Dialog from "../ui/Dialog";

type TaskMenuView = "list" | "board" | "timeline" | "calendar";

type MenuRequest = {
  task: TaskRow;
  view: TaskMenuView;
  x: number;
  y: number;
};

function MenuIcon({ name }: { name: string }) {
  const common = {
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "h-4 w-4",
  };
  if (name === "duplicate")
    return (
      <svg {...common}>
        <rect x="5" y="5" width="8" height="8" rx="1" />
        <path d="M3 10V4a1 1 0 0 1 1-1h6" />
      </svg>
    );
  if (name === "follow")
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6" />
        <path d="M8 11V5m-2 2 2-2 2 2" />
      </svg>
    );
  if (name === "complete")
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6" />
        <path d="m5.3 8.2 1.7 1.7 3.7-3.8" />
      </svg>
    );
  if (name === "subtask")
    return (
      <svg {...common}>
        <path d="M4 3v6a2 2 0 0 0 2 2h4" />
        <path d="M8 8h5v5H8z" />
      </svg>
    );
  if (name === "convert")
    return (
      <svg {...common}>
        <path d="M3 5h8l-2-2m2 2L9 7" />
        <path d="M13 11H5l2-2m-2 2 2 2" />
      </svg>
    );
  if (name === "milestone")
    return (
      <svg {...common}>
        <path d="M8 2 14 8 8 14 2 8z" />
      </svg>
    );
  if (name === "details")
    return (
      <svg {...common}>
        <rect x="3" y="3" width="10" height="10" rx="1" />
        <path d="M6 3v10" />
      </svg>
    );
  if (name === "external")
    return (
      <svg {...common}>
        <path d="M9 3h4v4M13 3 7.5 8.5" />
        <path d="M12 9v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" />
      </svg>
    );
  if (name === "link")
    return (
      <svg {...common}>
        <path d="M6.5 9.5 9.5 6.5" />
        <path d="M5.5 7.5 4 9a2.1 2.1 0 0 0 3 3l1.5-1.5" />
        <path d="M10.5 8.5 12 7a2.1 2.1 0 0 0-3-3L7.5 5.5" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M3 4h10M6 4V2.5h4V4M4.5 4l.7 9h5.6l.7-9" />
    </svg>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger = false,
  disabled = false,
  checked = false,
  hasSubmenu = false,
  hasPopup = false,
  expanded = false,
  title,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  hasSubmenu?: boolean;
  hasPopup?: boolean;
  expanded?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      aria-haspopup={hasPopup ? "menu" : undefined}
      aria-expanded={hasPopup ? expanded : undefined}
      onClick={onClick}
      className={`flex h-8 w-full items-center gap-2.5 px-3 text-left text-[13px] ${
        danger
          ? "text-rose-600 hover:bg-rose-50 disabled:text-rose-300"
          : "text-neutral-700 hover:bg-neutral-100 disabled:text-neutral-300"
      }`}
    >
      <span className="w-4 shrink-0 text-neutral-400">
        <MenuIcon name={icon} />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {checked && <span className="text-[12px] text-[#2c60b8]">✓</span>}
      {hasSubmenu && <span className="text-[12px] text-neutral-400">›</span>}
    </button>
  );
}

/** One global task context menu for every project view. */
export default function ProjectTaskContextMenu({
  tasks,
  canEdit,
}: {
  tasks: TaskRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [request, setRequest] = useState<MenuRequest | null>(null);
  const [subtaskFor, setSubtaskFor] = useState<TaskRow | null>(null);
  const [subtaskName, setSubtaskName] = useState("");
  const [convertFor, setConvertFor] = useState<TaskRow | null>(null);
  const [parentId, setParentId] = useState("");
  const [convertOpen, setConvertOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  const taskMap = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const task = request?.task ?? null;

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("input, textarea, select, [contenteditable='true']")) return;
      const row = target.closest<HTMLElement>(
        "[data-list-row], [data-board-card], [data-timeline-bar], [data-calendar-multiday], [data-calendar-single]",
      );
      if (!row) return;
      let view: TaskMenuView | null = null;
      let id = NaN;
      if (row.hasAttribute("data-list-row")) {
        view = "list";
        id = Number(row.getAttribute("data-list-row"));
      } else if (row.hasAttribute("data-board-card")) {
        view = "board";
        id = Number(row.getAttribute("data-board-card"));
      } else if (row.hasAttribute("data-timeline-bar")) {
        view = "timeline";
        id = Number(row.getAttribute("data-timeline-bar"));
      } else if (row.hasAttribute("data-calendar-multiday")) {
        view = "calendar";
        id = Number(row.getAttribute("data-calendar-multiday"));
      } else if (row.hasAttribute("data-calendar-single")) {
        view = "calendar";
        id = Number(row.getAttribute("data-calendar-single"));
      }
      if (!view || !Number.isInteger(id) || id <= 0) return;
      const nextTask = taskMap.get(id);
      if (!nextTask) return;
      event.preventDefault();
      event.stopPropagation();
      setConvertOpen(false);
      setRequest({ task: nextTask, view, x: event.clientX, y: event.clientY });
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, [taskMap]);

  useEffect(() => {
    if (!request) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setRequest(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRequest(null);
    };
    const onScroll = () => setRequest(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [request]);

  const close = () => {
    setRequest(null);
    setConvertOpen(false);
  };

  const refresh = () => {
    close();
    router.refresh();
  };

  const hrefFor = (target: TaskRow) => {
    const url = new URL(window.location.href);
    url.searchParams.set("task", String(target.id));
    return `${url.pathname}${url.search}`;
  };

  const openDetails = () => {
    if (!task) return;
    router.push(hrefFor(task));
    close();
  };

  const openNewTab = () => {
    if (!task) return;
    window.open(hrefFor(task), "_blank", "noopener,noreferrer");
    close();
  };

  const copyLink = async () => {
    if (!task) return;
    const url = `${location.origin}${hrefFor(task)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("タスクのリンクをコピーしました");
    } catch {
      window.prompt("タスクのリンク", url);
    }
    close();
  };

  const run = async (action: () => Promise<void>, message: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      toast(message);
      refresh();
    } catch (caught) {
      if (caught instanceof TaskConflictError) {
        toast("他のユーザーが先に更新しました。最新を表示します。");
        refresh();
      } else {
        toast(caught instanceof Error ? caught.message : "操作に失敗しました");
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleComplete = () => {
    if (!task) return;
    void run(
      async () => {
        await patchTask(task.id, { completed: !task.completed }, task.updated_at);
      },
      task.completed ? "タスクを未完了に戻しました" : "タスクを完了しました",
    );
  };

  const duplicate = () => {
    if (!task) return;
    void run(async () => {
      await api(`/api/tasks/${task.id}/duplicate`, "POST");
    }, "タスクを複製しました");
  };

  const followUp = () => {
    if (!task) return;
    void run(async () => {
      await api(`/api/tasks/${task.id}/follow-up`, "POST");
    }, "フォローアップタスクを作成しました");
  };

  const convertToTopLevel = () => {
    if (!task) return;
    void run(async () => {
      await patchTask(
        task.id,
        { parent_task_id: null, is_milestone: false },
        task.updated_at,
      );
    }, "タスクに変換しました");
  };

  const convertToMilestone = () => {
    if (!task) return;
    void run(async () => {
      await patchTask(
        task.id,
        { parent_task_id: null, is_milestone: true },
        task.updated_at,
      );
    }, "マイルストーンに変換しました");
  };

  const createSubtask = async () => {
    if (!subtaskFor || subtaskName.trim() === "" || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/tasks", "POST", {
        project_id: subtaskFor.project_id,
        section_id: subtaskFor.section_id,
        parent_task_id: subtaskFor.id,
        name: subtaskName.trim(),
      });
      setSubtaskFor(null);
      setSubtaskName("");
      toast("サブタスクを追加しました");
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "追加に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const convertToSubtask = async () => {
    if (!convertFor || parentId === "" || busy) return;
    setBusy(true);
    setError("");
    try {
      await patchTask(
        convertFor.id,
        { parent_task_id: Number(parentId), is_milestone: false },
        convertFor.updated_at,
      );
      setConvertFor(null);
      setParentId("");
      toast("サブタスクに変換しました");
      refresh();
    } catch (caught) {
      if (caught instanceof TaskConflictError) {
        toast("他のユーザーが先に更新しました。最新を表示します。");
        refresh();
      } else {
        setError(caught instanceof Error ? caught.message : "変換に失敗しました");
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!task) return;
    if (!(await confirmAction(`タスク「${task.name}」を削除しますか？`))) return;
    void run(async () => {
      await api(`/api/tasks/${task.id}`, "DELETE");
    }, "タスクを削除しました");
  };

  const left = request ? Math.max(8, Math.min(request.x, window.innerWidth - 300)) : 0;
  const top = request ? Math.max(8, Math.min(request.y, window.innerHeight - 460)) : 0;
  const submenuOnLeft = request ? left + 300 + 190 > window.innerWidth : false;
  const candidates = convertFor
    ? tasks.filter((candidate) => {
        if (candidate.id === convertFor.id) return false;
        let cursor: TaskRow | undefined = candidate;
        const seen = new Set<number>();
        while (cursor && cursor.parent_task_id !== null && !seen.has(cursor.id)) {
          if (cursor.parent_task_id === convertFor.id) return false;
          seen.add(cursor.id);
          cursor = taskMap.get(cursor.parent_task_id);
        }
        return true;
      })
    : [];

  return (
    <>
      <span hidden data-task-context-menu-host data-task-count={tasks.length} />
      {request &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            data-task-context-menu
            className="fixed z-[170] w-[292px] rounded-lg border border-neutral-200 bg-white py-1 text-[13px] shadow-2xl"
            style={{ left, top }}
          >
            {canEdit && (
              <>
                <MenuItem icon="duplicate" label="タスクを複製" onClick={duplicate} />
                <MenuItem icon="follow" label="フォローアップタスクを作成" onClick={followUp} />
                <MenuItem
                  icon="complete"
                  label={request.task.completed ? "未完了に戻す" : "完了にする"}
                  onClick={toggleComplete}
                />
                {(request.view === "list" || request.view === "board") && (
                  <MenuItem
                    icon="subtask"
                    label="サブタスクを追加"
                    onClick={() => {
                      setRequest(null);
                      setSubtaskFor(request.task);
                      setSubtaskName("");
                      setError("");
                    }}
                  />
                )}
                <div
                  className="relative"
                  onMouseEnter={() => setConvertOpen(true)}
                  onMouseLeave={() => setConvertOpen(false)}
                >
                  <MenuItem
                    icon="convert"
                    label="変換先"
                    hasSubmenu
                    hasPopup
                    expanded={convertOpen}
                    onClick={() => setConvertOpen(true)}
                  />
                  {convertOpen && (
                    <div
                      className={`absolute top-0 z-10 ${
                        submenuOnLeft ? "right-full pr-1" : "left-full pl-1"
                      }`}
                    >
                      <div
                        role="menu"
                        className="w-[190px] rounded-lg border border-neutral-200 bg-white py-1 shadow-xl"
                      >
                        <MenuItem
                          icon="complete"
                          label="タスク"
                          checked={request.task.parent_task_id === null && !request.task.is_milestone}
                          disabled={request.task.parent_task_id === null && !request.task.is_milestone}
                          onClick={convertToTopLevel}
                        />
                        <MenuItem
                          icon="milestone"
                          label="マイルストーン"
                          checked={request.task.parent_task_id === null && request.task.is_milestone}
                          disabled={request.task.parent_task_id === null && request.task.is_milestone}
                          onClick={convertToMilestone}
                        />
                        <MenuItem
                          icon="subtask"
                          label="サブタスク"
                          checked={request.task.parent_task_id !== null}
                          disabled={request.task.parent_task_id !== null}
                          onClick={() => {
                            setRequest(null);
                            setConvertFor(request.task);
                            setParentId("");
                            setError("");
                          }}
                        />
                        <MenuItem
                          icon="complete"
                          label="承認リクエスト"
                          disabled
                          title="Atlasでは未対応"
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div className="my-1 border-t border-neutral-100" />
              </>
            )}
            <MenuItem icon="details" label="タスクの詳細を開く" onClick={openDetails} />
            <MenuItem icon="external" label="新しいタブで開く" onClick={openNewTab} />
            <MenuItem icon="link" label="タスクのリンクをコピー" onClick={() => void copyLink()} />
            {canEdit && (
              <>
                <div className="my-1 border-t border-neutral-100" />
                <MenuItem icon="delete" label="タスクを削除" danger onClick={() => void remove()} />
              </>
            )}
          </div>,
          document.body,
        )}

      {subtaskFor && (
        <Dialog
          open
          onClose={() => setSubtaskFor(null)}
          title="サブタスクを追加"
          panelClassName="w-[min(460px,94vw)] rounded-xl border border-neutral-200 bg-white shadow-2xl"
        >
          <div className="p-5">
            <h3 className="text-[15px] font-semibold text-neutral-900">サブタスクを追加</h3>
            <p className="mt-1 text-[11px] text-neutral-500">{subtaskFor.name}</p>
            <input
              autoFocus
              value={subtaskName}
              onChange={(event) => setSubtaskName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createSubtask();
              }}
              placeholder="サブタスク名"
              className="mt-3 h-9 w-full rounded-md border border-neutral-200 px-2 text-[13px] outline-none focus:border-[#2c60b8]"
            />
            {error && <p className="mt-2 text-[11px] text-rose-600">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSubtaskFor(null)}
                className="h-8 rounded-md border border-neutral-200 px-3 text-[12px] text-neutral-700 hover:bg-neutral-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void createSubtask()}
                disabled={busy || subtaskName.trim() === ""}
                className="h-8 rounded-md bg-[#2c60b8] px-4 text-[12px] font-medium text-white hover:bg-[#24529c] disabled:opacity-50"
              >
                {busy ? "追加中…" : "追加"}
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {convertFor && (
        <Dialog
          open
          onClose={() => setConvertFor(null)}
          title="サブタスクに変換"
          panelClassName="w-[min(460px,94vw)] rounded-xl border border-neutral-200 bg-white shadow-2xl"
        >
          <div className="p-5">
            <h3 className="text-[15px] font-semibold text-neutral-900">サブタスクに変換</h3>
            <p className="mt-1 text-[11px] text-neutral-500">{convertFor.name}</p>
            <select
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
              className="mt-3 h-9 w-full rounded-md border border-neutral-200 bg-white px-2 text-[13px]"
            >
              <option value="">親タスクを選択…</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
            {error && <p className="mt-2 text-[11px] text-rose-600">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConvertFor(null)}
                className="h-8 rounded-md border border-neutral-200 px-3 text-[12px] text-neutral-700 hover:bg-neutral-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void convertToSubtask()}
                disabled={busy || parentId === ""}
                className="h-8 rounded-md bg-[#2c60b8] px-4 text-[12px] font-medium text-white hover:bg-[#24529c] disabled:opacity-50"
              >
                {busy ? "変換中…" : "変換"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
