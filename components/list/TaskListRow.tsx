"use client";
import { QuickTaskName } from "../task/QuickTaskContext";

import { isImeComposing } from "@/lib/ime-keyboard";
import { isQuickTask } from "@/lib/quick-task";

import { Fragment, useRef, useState } from "react";
import type { CustomField, CustomValue } from "@/lib/custom-fields";
import { dueSegs } from "@/lib/dates";
import {
  customFieldDisplay,
  customValueToIdArray,
  isReadOnlyFieldType,
} from "@/lib/custom-fields";
import type { TaskRow, User } from "@/lib/data";
import TaskAvatar from "../task/TaskAvatar";
import EmptyCellIcon from "../fields/EmptyCellIcon";
import AssigneePicker from "../fields/AssigneePicker";
import DueDatePicker from "../fields/DueDatePicker";
import TaskCompletionToggle from "../task/TaskCompletionToggle";
import TaskStatusChip from "../task/TaskStatusChip";
import TaskApprovalBadge from "../task/TaskApprovalBadge";
import ReferencePicker from "../fields/ReferencePicker";
import TimerCell from "../fields/TimerCell";

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
  openEdit: (event: React.MouseEvent, task: TaskRow, field: string, initial: string) => void;
  commitEdit: (task: TaskRow, field: string, value: string) => Promise<void>;
  cancelEdit: () => void;
  openDueEdit: (event: React.MouseEvent, task: TaskRow) => void;
  applyDueRange: (task: TaskRow, start: string, due: string) => Promise<void>;
  editInputCls: string;
  users: User[];
  visibleCols: string[];
  statusFieldEnabled: boolean;
  statusHidden: boolean;
  statusOptions: string[];
  shownFields: CustomField[];
  customFields: CustomField[];
  selected: Set<number>;
  sectionDragging: boolean;
  canEditField: (field: CustomField) => boolean;
  onTimerChange: () => void;
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

function MultiSelectEditor({
  options,
  initial,
  onSave,
  onCancel,
}: {
  options: string[];
  initial: string[];
  onSave: (values: string[]) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(initial);
  return (
    <div
      className="absolute top-full left-0 z-50 mt-1 w-56 rounded-lg border border-neutral-200 bg-white p-2 shadow-xl"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="max-h-48 space-y-0.5 overflow-y-auto">
        {options.length === 0 && <div className="px-1 py-2 text-[11px] text-neutral-400">選択肢がありません</div>}
        {options.map((option) => (
          <label key={option} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px] hover:bg-neutral-50">
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={(event) =>
                setSelected((current) =>
                  event.target.checked
                    ? [...current, option]
                    : current.filter((value) => value !== option),
                )
              }
            />
            <span className="truncate">{option}</span>
          </label>
        ))}
      </div>
      <div className="mt-2 flex justify-end gap-1.5 border-t border-neutral-100 pt-2">
        <button type="button" onClick={onCancel} className="rounded px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-100">
          キャンセル
        </button>
        <button type="button" onClick={() => onSave(selected)} className="rounded bg-[#2f6fd0] px-3 py-1 text-[11px] font-medium text-white hover:bg-[#2459ad]">
          保存
        </button>
      </div>
    </div>
  );
}

function PeopleEditor({
  users,
  initial,
  onSave,
  onCancel,
}: {
  users: User[];
  initial: number[];
  onSave: (ids: number[]) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<number[]>(initial);
  return (
    <div
      className="absolute top-full left-0 z-50 mt-1 w-60 rounded-lg border border-neutral-200 bg-white p-2 shadow-xl"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="max-h-48 space-y-0.5 overflow-y-auto">
        {users.length === 0 && <div className="px-1 py-2 text-[11px] text-neutral-400">メンバーがいません</div>}
        {users.map((user) => (
          <label key={user.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px] hover:bg-neutral-50">
            <input
              type="checkbox"
              checked={selected.includes(user.id)}
              onChange={(event) =>
                setSelected((current) =>
                  event.target.checked
                    ? [...current, user.id]
                    : current.filter((id) => id !== user.id),
                )
              }
            />
            <span className="truncate">{user.name}</span>
          </label>
        ))}
      </div>
      <div className="mt-2 flex justify-end gap-1.5 border-t border-neutral-100 pt-2">
        <button type="button" onClick={onCancel} className="rounded px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-100">
          キャンセル
        </button>
        <button type="button" onClick={() => onSave(selected)} className="rounded bg-[#2f6fd0] px-3 py-1 text-[11px] font-medium text-white hover:bg-[#2459ad]">
          保存
        </button>
      </div>
    </div>
  );
}

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
  const cancelNameEdit = useRef(false);
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
    openEdit,
    commitEdit,
    cancelEdit,
    openDueEdit,
    applyDueRange,
    editInputCls,
    users,
    visibleCols,
    statusFieldEnabled,
    statusHidden,
    statusOptions,
    shownFields,
    customFields,
    selected,
    sectionDragging,
    canEditField,
    onTimerChange,
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
        if (isImeComposing(e)) return;
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
      data-list-row-selected={selected.has(t.id) ? "true" : undefined}
      onDragStart={(e) => {
        beginRowDrag();
        e.dataTransfer.setData("text/atlas-task", String(t.id));
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={endRowDrag}
      onClick={(e) => rowClick(e, t.id)}
      onDragOver={(e) => {
        if (sectionDragging) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setHint({ id: t.id, before: e.clientY < rect.top + rect.height / 2 });
      }}
      onDragLeave={() => {
        if (!sectionDragging) setHint(null);
      }}
      onDrop={(e) => {
        if (sectionDragging) return;
        e.preventDefault();
        e.stopPropagation();
        setHint(null);
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        const dragId = Number(e.dataTransfer.getData("text/atlas-task"));
        if (dragId) moveTask(dragId, t, before);
      }}
      className={`group grid min-h-[37px] cursor-pointer items-center [&>*:nth-child(n+3)]:border-l [&>*:nth-child(n+3)]:border-[#eaeaea] border-b border-[#eaeaea] px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2c60b8] ${compactCells} ${
        isQuickTask(t)
          ? "bg-[#eff4fd]"
          : selected.has(t.id)
            ? "bg-[#eff4fd]"
            : t.id === activeTaskId
              ? "bg-[#eff4fd]"
              : "hover:bg-neutral-50"
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
      <div
        className={`flex min-w-0 flex-wrap items-center gap-1.5 ${depth > 0 ? "pl-7" : ""} ${
          editing?.id === t.id && editing.field === "name"
            ? "rounded-[2px] ring-1 ring-[#4573d2]"
            : ""
        }`}
      >
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
        <TaskCompletionToggle completed={t.completed} milestone={t.is_milestone} onToggle={() => void toggle(t)}
          disabled={Boolean(t.approval)} title={t.approval ? "承認の状態はタスク詳細から変更してください" : undefined}
          {...(t.approval ? { "aria-label": "承認タスクの完了は承認操作から行います" } : {})} />
        <QuickTaskName task={t}>{editing?.id === t.id && editing.field === "name" ? (
          <input
            autoFocus
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onBlur={(e) => {
              if (cancelNameEdit.current) {
                cancelNameEdit.current = false;
                return;
              }
              void commitEdit(t, "name", (e.target as HTMLInputElement).value);
            }}
            onFocus={(e) => {
              cancelNameEdit.current = false;
              e.target.select();
            }}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancelNameEdit.current = true;
                const el = e.target as HTMLInputElement;
                el.blur();
                setEditing(null);
              }
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            onClick={(e) => e.stopPropagation()}
            dir="auto"
            aria-label="タスク名"
            className="h-5 min-w-[2ch] max-w-[calc(100%-4rem)] flex-none rounded-[2px] border-0 bg-transparent px-0 py-0 text-sm leading-5 text-neutral-900 outline-none [field-sizing:content]"
          />
        ) : (
          <span
            onClick={(e) => openEdit(e, t, "name", t.name)}
            title={`${t.name} — クリックで名前を編集`}
            dir="auto"
            className="w-fit max-w-full min-w-0 flex-none cursor-text truncate rounded hover:bg-neutral-100"
          >
            {t.name || "タスク名を入力"}
          </span>
        )}
        </QuickTaskName>
        {t.approval && <TaskApprovalBadge approval={t.approval} onClick={() => openTask(t.id)} />}
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
        <div style={{ order: visibleCols.indexOf("assignee") }} className="relative min-w-0 pl-2 pr-1">
          <AssigneePicker
            users={users}
            currentId={t.assignee_id}
            onPick={(id) => void commitEdit(t, "assignee", id === null ? "" : String(id))}
            onCancel={cancelEdit}
          />
        </div>
      ) : (
        <span
          onClick={(e) => openEdit(e, t, "assignee", t.assignee_id === null ? "" : String(t.assignee_id))}
          title={t.assignee_name ? "クリックで編集" : "未割り当て — クリックで編集"}
          style={{ order: visibleCols.indexOf("assignee") }}
          className="flex min-w-0 cursor-pointer items-center gap-1.5 truncate rounded pl-2 text-neutral-600 hover:bg-neutral-100"
        >
          {t.assignee_name ? (
            <>
              <TaskAvatar name={t.assignee_name} />
              <span className="truncate">{t.assignee_name}</span>
            </>
          ) : (
            <EmptyCellIcon kind="assignee" />
          )}
        </span>
      )}
      {editing?.id === t.id && editing.field === "due" ? (
        <div style={{ order: visibleCols.indexOf("due") }} className="relative min-w-0 pl-2 pr-1">
          <DueDatePicker
            start={editStart}
            due={editVal}
            today={today}
            onApply={(nextStart, nextDue) => void applyDueRange(t, nextStart, nextDue)}
            onCancel={cancelEdit}
          />
        </div>
      ) : (
        <span onClick={(e) => openDueEdit(e, t)} style={{ order: visibleCols.indexOf("due") }}
          title="クリックで編集" className="cursor-pointer rounded py-0.5 pr-1 pl-2 hover:bg-neutral-100">
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
              aria-label="期日を設定"
              className="flex h-5 w-5 items-center justify-center rounded-full text-[#767676] hover:bg-neutral-100"
            >
              <EmptyCellIcon kind="due" />
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
            if (isImeComposing(e)) return;
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
          className="flex min-h-5 cursor-pointer items-center gap-1.5 rounded pl-2 hover:bg-neutral-100"
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
              if (isImeComposing(e)) return;
              if (e.key === "Escape") cancelEdit();
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full min-w-0 cursor-pointer rounded border border-blue-500 bg-white py-0.5 pr-1 pl-2 text-[13px] outline-none"
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
            className="min-h-5 cursor-pointer truncate rounded pl-2 hover:bg-neutral-100"
          >
            {t.status && t.status !== "inbox" ? (
              <TaskStatusChip status={t.status} compact />
            ) : null}
          </span>
        )
      )}
      {shownFields.map((f) => {
        const fieldKey = `cf-${f.id}`;
        const order = visibleCols.indexOf(fieldKey);
        const active = editing?.id === t.id && editing.field === fieldKey;
        if (!active) {
          if (f.field_type === "timer") {
            return (
              <span key={f.id} style={{ order }} className="min-w-0 pl-2">
                {canEditField(f) ? (
                  <TimerCell
                    taskId={t.id}
                    field={f}
                    value={customValues[t.id]?.[f.id]}
                    onChanged={onTimerChange}
                  />
                ) : (
                  <span className="block truncate text-neutral-600">
                    {customFieldDisplay(
                      f,
                      customValues[t.id]?.[f.id],
                      t,
                      users,
                      customValues[t.id],
                      customFields,
                    )}
                  </span>
                )}
              </span>
            );
          }
          const display = customFieldDisplay(
            f,
            customValues[t.id]?.[f.id],
            t,
            users,
            customValues[t.id],
            customFields,
          );
          if (isReadOnlyFieldType(f.field_type) || !canEditField(f)) {
            return (
              <span
                key={f.id}
                title={display}
                style={{ order }}
                className="truncate rounded pl-2 text-neutral-600"
              >
                {display}
              </span>
            );
          }
          return (
            <span
              key={f.id}
              onClick={(e) => openEdit(e, t, fieldKey, customRaw(t.id, f))}
              title="クリックで編集"
              style={{ order }}
              className="cursor-pointer truncate rounded pl-2 text-neutral-600 hover:bg-neutral-100"
            >
              {display}
            </span>
          );
        }
        if (f.field_type === "reference") {
          return (
            <span key={f.id} style={{ order }} className="relative min-w-0 pl-2">
              <ReferencePicker
                field={f}
                initial={customValueToIdArray(customValues[t.id]?.[f.id])}
                onCancel={cancelEdit}
                onSave={(ids) => void commitEdit(t, fieldKey, JSON.stringify(ids))}
              />
            </span>
          );
        }
        if (f.field_type === "people") {
          return (
            <span key={f.id} style={{ order }} className="relative min-w-0 pl-2">
              <PeopleEditor
                users={users}
                initial={customValueToIdArray(customValues[t.id]?.[f.id])}
                onCancel={cancelEdit}
                onSave={(ids) => void commitEdit(t, fieldKey, JSON.stringify(ids))}
              />
            </span>
          );
        }
        if (f.field_type === "multi_select") {
          let initial: string[] = [];
          try {
            const parsed = JSON.parse(editVal);
            initial = Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
          } catch {
            initial = [];
          }
          return (
            <span key={f.id} style={{ order }} className="relative min-w-0 pl-2">
              <MultiSelectEditor
                options={f.options}
                initial={initial}
                onCancel={cancelEdit}
                onSave={(values) => void commitEdit(t, fieldKey, JSON.stringify(values))}
              />
            </span>
          );
        }
        if (f.field_type === "date") {
          return (
            <input
              key={f.id}
              autoFocus
              type="date"
              style={{ order }}
              value={editVal}
              onChange={(e) => setEditVal(e.target.value)}
              onBlur={(e) => commitEdit(t, fieldKey, (e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (isImeComposing(e)) return;
                if (e.key === "Escape") cancelEdit();
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              onClick={(e) => e.stopPropagation()}
              className={editInputCls}
            />
          );
        }
        if (f.field_type === "select") {
          return (
            <select
              key={f.id}
              style={{ order }}
              autoFocus
              value={editVal}
              onChange={(e) => commitEdit(t, fieldKey, e.target.value)}
              onBlur={cancelEdit}
              onKeyDown={(e) => {
                if (isImeComposing(e)) return;
                if (e.key === "Escape") cancelEdit();
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full min-w-0 cursor-pointer rounded border border-blue-500 bg-white py-0.5 pr-1 pl-2 text-[13px] outline-none"
            >
              <option value="">–</option>
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          );
        }
        return (
          <input
            key={f.id}
            autoFocus
            style={{ order }}
            type={f.field_type === "number" ? "number" : "text"}
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onBlur={(e) => commitEdit(t, fieldKey, (e.target as HTMLInputElement).value)}
            onFocus={(e) => (e.target as HTMLInputElement).select()}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (e.key === "Escape") cancelEdit();
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            onClick={(e) => e.stopPropagation()}
            className={editInputCls}
          />
        );
      })}
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
              if (isImeComposing(e)) return;
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
