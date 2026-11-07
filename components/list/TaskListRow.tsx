"use client";

import { Fragment } from "react";
import type { CustomField, CustomValue } from "@/lib/custom-fields";
import { dueSegs } from "@/lib/dates";
import { formatCustomValue } from "@/lib/custom-fields";
import type { TaskRow, User } from "@/lib/data";
import TaskAvatar from "../task/TaskAvatar";
import TaskCompletionToggle from "../task/TaskCompletionToggle";
import TaskStatusChip from "../task/TaskStatusChip";

export type TaskRowContext = {
  today: string;
  compactCells: string;
  activeTaskId: number | null;
  dropHint: { id: number; before: boolean } | null;
  setHint: (hint: { id: number; before: boolean } | null) => void;
  beginRowDrag: () => void;
  endRowDrag: () => void;
  rowClick: (event: React.MouseEvent, id: number) => void;
  moveTask: (dragId: number, target: TaskRow, before: boolean) => Promise<void>;
  subtaskMap: Record<number, TaskRow[]>;
  expanded: Set<number>;
  toggleExpand: (id: number) => void;
  toggle: (task: TaskRow) => Promise<void>;
  editing: { id: number; field: string } | null;
  setEditing: (value: { id: number; field: string } | null) => void;
  editVal: string;
  setEditVal: (value: string) => void;
  editStart: string;
  setEditStart: (value: string) => void;
  openEdit: (event: React.MouseEvent, task: TaskRow, field: string, initial: string) => void;
  commitEdit: (task: TaskRow, field: string, value: string) => Promise<void>;
  cancelEdit: () => void;
  openDueEdit: (event: React.MouseEvent, task: TaskRow) => void;
  commitDueEdit: (task: TaskRow, cleared?: boolean) => Promise<void>;
  editInputCls: string;
  users: User[];
  visibleCols: string[];
  statusFieldEnabled: boolean;
  statusHidden: boolean;
  statusOptions: string[];
  shownFields: CustomField[];
  customRaw: (taskId: number, field: CustomField) => string;
  customValues: Record<number, Record<number, CustomValue>>;
  subAdding: number | null;
  setSubAdding: (id: number | null) => void;
  subDraft: string;
  setSubDraft: (value: string) => void;
  addSubtask: (task: TaskRow) => Promise<void>;
  remove: (task: TaskRow) => Promise<void>;
  gridCols: string;
  openTask: (id: number) => void;
};

/** One list row (top-level task or subtask) with inline cell editors. */
export default function TaskListRow({
  task,
  depth = 0,
  ctx,
}: {
  task: TaskRow;
  depth?: number;
  ctx: TaskRowContext;
}) {
  const t = task;
  const {
    today,
    compactCells,
    activeTaskId,
    dropHint,
    setHint,
    beginRowDrag,
    endRowDrag,
    rowClick,
    moveTask,
    subtaskMap,
    expanded,
    toggleExpand,
    toggle,
    editing,
    setEditing,
    editVal,
    setEditVal,
    editStart,
    setEditStart,
    openEdit,
    commitEdit,
    cancelEdit,
    openDueEdit,
    commitDueEdit,
    editInputCls,
    users,
    visibleCols,
    statusFieldEnabled,
    statusHidden,
    statusOptions,
    shownFields,
    customRaw,
    customValues,
    subAdding,
    setSubAdding,
    subDraft,
    setSubDraft,
    addSubtask,
    remove,
    gridCols,
    openTask,
  } = ctx;

    const overdue = !t.completed && t.due_on !== null && t.due_on < today;
    const isToday = !t.completed && t.due_on !== null && t.due_on === today;
    return (
    <Fragment key={t.id}>
    <div
      draggable
      data-list-row={t.id}
      tabIndex={0}
      role="listitem"
      aria-label={`タスク: ${t.name}`}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("input,select,textarea,button,a,summary")) return;
        if (e.key === "Enter") {
          e.preventDefault();
          openTask(t.id);
          return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const rows = [...document.querySelectorAll<HTMLElement>("[data-list-row]")];
          const index = rows.indexOf(e.currentTarget);
          const next = rows[index + (e.key === "ArrowDown" ? 1 : -1)];
          next?.focus();
        }
      }}
      onDragStart={(e) => {
        beginRowDrag();
        e.dataTransfer.setData("text/atlas-task", String(t.id));
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={endRowDrag}
      onClick={(e) => rowClick(e, t.id)}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setHint({ id: t.id, before: e.clientY < rect.top + rect.height / 2 });
      }}
      onDragLeave={() => setHint(null)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setHint(null);
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        const dragId = Number(e.dataTransfer.getData("text/atlas-task"));
        if (dragId) moveTask(dragId, t, before);
      }}
      className={`group grid min-h-[37px] cursor-pointer items-center divide-x divide-[#eaeaea] border-b border-[#eaeaea] px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2c60b8] ${compactCells} ${
        t.id === activeTaskId ? "bg-[#eff4fd]" : "hover:bg-neutral-50"
      } ${
        dropHint?.id === t.id
          ? dropHint.before
            ? "shadow-[inset_0_2px_0_0_#3b82f6]"
            : "shadow-[inset_0_-2px_0_0_#3b82f6]"
          : ""
      }`}
      style={{ gridTemplateColumns: gridCols }}
    >
      <span className="flex items-center justify-self-center">
        <span
          title="ドラッグで並替え（ホバーで表示）"
          className="cursor-grab text-neutral-300 opacity-0 group-hover:opacity-100 hover:text-neutral-500 active:cursor-grabbing"
        >
          ⋮⋮
        </span>
      </span>
      <div className={`flex min-w-0 flex-wrap items-center gap-1.5 ${depth > 0 ? "pl-7" : ""}`}>
        {(subtaskMap[t.id] ?? []).length > 0 ? (
          <button
            onClick={() => toggleExpand(t.id)}
            title={expanded.has(t.id) ? "サブタスクを閉じる" : "サブタスクを開く"}
            className="w-4 shrink-0 text-center text-xs text-neutral-600 hover:text-black"
          >
            {expanded.has(t.id) ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <TaskCompletionToggle completed={t.completed} onToggle={() => void toggle(t)} />
        {editing?.id === t.id && editing.field === "name" ? (
          <input
            autoFocus
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onBlur={(e) => commitEdit(t, "name", (e.target as HTMLInputElement).value)}
            onFocus={(e) => (e.target as HTMLInputElement).select()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                const el = e.target as HTMLInputElement;
                el.blur();
                setEditing(null);
              }
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full min-w-0 rounded border border-blue-500 bg-white px-1 py-0.5 text-sm outline-none"
          />
        ) : (
          <span
            onClick={(e) => openEdit(e, t, "name", t.name)}
            title={`${t.name} — クリックで名前を編集`}
            dir="auto"
            className="w-fit max-w-full min-w-0 flex-none cursor-text truncate rounded hover:bg-neutral-100"
          >
            {t.name}
          </span>
        )}
        {t.recurrence && t.recurrence !== "none" && (
          <span title="繰り返しタスク" className="shrink-0 text-xs text-neutral-500">
            ↻
          </span>
        )}
        <span className="ml-1 flex items-center gap-2 text-[11px] text-neutral-600">
          {t.subtask_count > 0 && (
            <span className="flex items-center gap-0.5" title="サブタスク">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.2">
                <path d="M4 3v4.5a2 2 0 0 0 2 2h6" />
                <path d="M9.5 7.5 12 9.5 9.5 11.5" />
              </svg>
              {t.subtask_count}
            </span>
          )}
          {t.comment_count > 0 && (
            <span className="flex items-center gap-0.5" title="コメント">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.2">
                <path d="M3 3.5h10v7H7.5L4.5 13v-2.5H3z" />
              </svg>
              {t.comment_count}
            </span>
          )}
        </span>
        <span className="flex w-full flex-wrap items-center gap-2 pl-6 text-[11px] text-neutral-500 lg:hidden">
          {t.due_on && (
            <span className={overdue ? "font-semibold text-red-600" : isToday ? "font-semibold text-[#2c60b8]" : ""}>
              期日 {t.due_on}
            </span>
          )}
          {t.assignee_name && <span>{t.assignee_name}</span>}
          {statusFieldEnabled && t.status !== "inbox" && t.status !== "" && <span>{t.status}</span>}
        </span>
      </div>
      {editing?.id === t.id && editing.field === "assignee" ? (
        <select
          style={{ order: visibleCols.indexOf("assignee") }}
          autoFocus
          value={editVal}
          onChange={(e) => commitEdit(t, "assignee", e.target.value)}
          onBlur={cancelEdit}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancelEdit();
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-full min-w-0 cursor-pointer rounded border border-blue-500 bg-white px-1 py-0.5 text-[13px] outline-none"
        >
          <option value="">–</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      ) : (
        <span
          onClick={(e) => openEdit(e, t, "assignee", t.assignee_id === null ? "" : String(t.assignee_id))}
          title="クリックで編集"
          style={{ order: visibleCols.indexOf("assignee") }}
          className="flex min-w-0 cursor-pointer items-center gap-1.5 truncate rounded text-neutral-600 hover:bg-neutral-100"
        >
          <TaskAvatar name={t.assignee_name} />
          <span className="truncate">{t.assignee_name ?? ""}</span>
        </span>
      )}
      {editing?.id === t.id && editing.field === "due" ? (
        <span style={{ order: visibleCols.indexOf("due") }} className="relative">
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">編集中…</span>
          <div
            className="absolute top-full left-0 z-40 mt-1 w-60 rounded-lg border bg-white p-3 text-sm shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <label className="block text-xs text-neutral-500">
              開始日
              <input
                type="date"
                value={editStart}
                onChange={(e) => setEditStart(e.target.value)}
                className="mt-0.5 w-full rounded border px-2 py-1 text-sm outline-none focus:border-blue-500"
              />
            </label>
            <label className="mt-2 block text-xs text-neutral-500">
              期日
              <input
                type="date"
                value={editVal}
                onChange={(e) => setEditVal(e.target.value)}
                className="mt-0.5 w-full rounded border px-2 py-1 text-sm outline-none focus:border-blue-500"
              />
            </label>
            <div className="mt-2 flex gap-1">
              <button
                onClick={() => commitDueEdit(t)}
                className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
              >
                保存
              </button>
              <button
                onClick={() => {
                  setEditStart("");
                  setEditVal("");
                  commitDueEdit(t, true);
                }}
                title="開始日と期日をクリア"
                className="rounded border px-2 py-1 text-xs hover:bg-neutral-100"
              >
                クリア
              </button>
              <button onClick={cancelEdit} className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100">
                キャンセル
              </button>
            </div>
          </div>
        </span>
      ) : (
        <span onClick={(e) => openDueEdit(e, t)} style={{ order: visibleCols.indexOf("due") }}
          title="クリックで編集" className="cursor-pointer rounded px-1 py-0.5 hover:bg-neutral-100">
          {t.start_on || t.due_on ? (
            (() => {
              const [s1, s2] = dueSegs(t.start_on, t.due_on);
              return (
                <span
                  className={`whitespace-nowrap text-[12px] ${
                    overdue ? "font-medium text-red-700" : isToday ? "text-green-700" : "text-neutral-600"
                  }`}
                >
                  {s1}
                  {s2 && ` – ${s2}`}
                </span>
              );
            })()
          ) : (
            <button
              onClick={(e) => openDueEdit(e, t)}
              title="期日を設定"
              className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-neutral-300 text-[11px] leading-none text-neutral-300 hover:border-neutral-500 hover:text-neutral-500"
            >
              ＋
            </button>
          )}
        </span>
      )}
      {editing?.id === t.id && editing.field === "progress" ? (
        <input
          autoFocus
          style={{ order: visibleCols.indexOf("progress") }}
          type="number"
          min={0}
          max={100}
          value={editVal}
          onChange={(e) => setEditVal(e.target.value)}
          onBlur={(e) => commitEdit(t, "progress", (e.target as HTMLInputElement).value)}
          onFocus={(e) => (e.target as HTMLInputElement).select()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              const el = e.target as HTMLInputElement;
              el.blur();
              setEditing(null);
            }
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          onClick={(e) => e.stopPropagation()}
          className={editInputCls}
        />
      ) : (
        <span
          onClick={(e) => openEdit(e, t, "progress", String(t.progress))}
          title="クリックで編集"
          style={{ order: visibleCols.indexOf("progress") }}
          className="flex min-h-5 cursor-pointer items-center gap-1.5 rounded hover:bg-neutral-100"
        >
          {t.progress > 0 ? (
            <>
              <span className="h-1.5 w-16 overflow-hidden rounded bg-neutral-200">
                <span className="block h-full rounded bg-green-500" style={{ width: `${t.progress}%` }} />
              </span>
              <span className="text-xs text-neutral-600">{t.progress}%</span>
            </>
          ) : null}
        </span>
      )}
      {statusFieldEnabled && !statusHidden && (
        editing?.id === t.id && editing.field === "status" ? (
          <select
          style={{ order: visibleCols.indexOf("status") }}
            autoFocus
            value={editVal}
            onChange={(e) => commitEdit(t, "status", e.target.value)}
            onBlur={cancelEdit}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancelEdit();
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full min-w-0 cursor-pointer rounded border border-blue-500 bg-white px-1 py-0.5 text-[13px] outline-none"
          >
            {!statusOptions.includes(editVal) && <option value={editVal}>{editVal}</option>}
            {statusOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <span
            onClick={(e) => openEdit(e, t, "status", t.status)}
            title="クリックで編集"
            style={{ order: visibleCols.indexOf("status") }}
            className="min-h-5 cursor-pointer truncate rounded hover:bg-neutral-100"
          >
            {t.status && t.status !== "inbox" ? (
              <TaskStatusChip status={t.status} compact />
            ) : null}
          </span>
        )
      )}
      {shownFields.map((f) =>
        editing?.id === t.id && editing.field === `cf-${f.id}` ? (
          f.field_type === "select" ? (
            <select
            style={{ order: visibleCols.indexOf(`cf-${f.id}`) }}
              key={f.id}
              autoFocus
              value={editVal}
              onChange={(e) => commitEdit(t, `cf-${f.id}`, e.target.value)}
              onBlur={cancelEdit}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelEdit();
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full min-w-0 cursor-pointer rounded border border-blue-500 bg-white px-1 py-0.5 text-[13px] outline-none"
            >
              <option value="">–</option>
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
            style={{ order: visibleCols.indexOf(`cf-${f.id}`) }}
              key={f.id}
              autoFocus
              type={f.field_type === "number" ? "number" : "text"}
              value={editVal}
              onChange={(e) => setEditVal(e.target.value)}
              onBlur={(e) => commitEdit(t, `cf-${f.id}`, (e.target as HTMLInputElement).value)}
              onFocus={(e) => (e.target as HTMLInputElement).select()}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelEdit();
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              onClick={(e) => e.stopPropagation()}
              className={editInputCls}
            />
          )
        ) : (
          <span
            key={f.id}
            onClick={(e) => openEdit(e, t, `cf-${f.id}`, customRaw(t.id, f))}
            title="クリックで編集"
            style={{ order: visibleCols.indexOf(`cf-${f.id}`) }}
            className="cursor-pointer truncate rounded text-neutral-600 hover:bg-neutral-100"
          >
            {formatCustomValue(f, customValues[t.id]?.[f.id])}
          </span>
        ),
      )}
      <button
        style={{ order: 999 }}
        onClick={() => remove(t)}
        className="invisible justify-self-end text-neutral-300 hover:text-red-600 group-hover:visible"
        title="削除"
      >
        ×
      </button>
    </div>
    {expanded.has(t.id) &&
      (subtaskMap[t.id] ?? []).map((st) => (
        <Fragment key={`sub-${st.id}`}>
          <TaskListRow task={st} depth={1} ctx={ctx} />
        </Fragment>
      ))}
    {expanded.has(t.id) &&
      (subAdding === t.id ? (
        <div className="flex gap-2 py-1 pl-14">
          <input
            value={subDraft}
            onChange={(e) => setSubDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addSubtask(t);
              if (e.key === "Escape") setSubAdding(null);
            }}
            onBlur={() => {
              if (subDraft.trim() === "") setSubAdding(null);
            }}
            placeholder="サブタスク名を入力"
            autoFocus
            className="w-full max-w-md rounded border px-2 py-1 text-sm outline-none focus:border-blue-500"
          />
          <button
            onClick={() => addSubtask(t)}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
          >
            追加
          </button>
        </div>
      ) : (
        <button
          onClick={() => setSubAdding(t.id)}
          className="flex h-9 w-full items-center rounded pr-2 pl-[108px] text-left text-[13px] whitespace-nowrap text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700"
        >
          サブタスクを追加
        </button>
      ))}
    </Fragment>
    );
}
