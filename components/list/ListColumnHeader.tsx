"use client";

import {
  COLUMN_FUNCTION_LABELS,
  columnFunctionOf,
  type ColumnFunction,
  type CustomField,
} from "@/lib/custom-fields";
import type { User } from "@/lib/data";

const menuLabel = "px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted";
const menuItemBase = "flex w-full items-center gap-1 rounded px-3 py-1.5 text-left text-[13px] hover:bg-hover";
const menuItem = `${menuItemBase} text-secondary`;

export default function ListColumnHeader({
  columnKey,
  label,
  field,
  menuCol,
  setMenuCol,
  colDropOver,
  colDropSide,
  colDragging,
  gripMouseDown,
  visibleCols,
  moveCol,
  startColumnDrag,
  dragOverColumn,
  dragLeaveColumn,
  dropColumn,
  endColumnDrag,
  cycleSort,
  sortMark,
  applySort,
  clearSort,
  applyAssigneeFilter,
  assigneeFilter,
  users,
  applyDueFilter,
  dueFilter,
  statusFieldEnabled,
  statusOptions,
  statusFilter,
  applyStatusFilter,
  statusFieldName,
  setStatusHidden,
  customFilter,
  setCustomFilter,
  onEditField,
  setColumnFunction,
  toggleSubtaskTotals,
  setHiddenCols,
  removeField,
}: {
  columnKey: string;
  label: string;
  field?: CustomField;
  menuCol: string | null;
  setMenuCol: (value: string | null) => void;
  colDropOver: string | null;
  colDropSide: "before" | "after" | null;
  colDragging: string | null;
  gripMouseDown: (event: React.MouseEvent, key: string) => void;
  visibleCols: string[];
  moveCol: (key: string, delta: -1 | 1) => void;
  startColumnDrag: (event: React.DragEvent, key: string, label: string) => void;
  dragOverColumn: (event: React.DragEvent, key: string) => void;
  dragLeaveColumn: (event: React.DragEvent, key: string) => void;
  dropColumn: (event: React.DragEvent, key: string) => void;
  endColumnDrag: () => void;
  cycleSort: (key: "name" | "due" | "progress") => void;
  sortMark: (key: "name" | "due" | "progress") => string;
  applySort: (key: "name" | "due" | "progress", dir: "asc" | "desc") => void;
  clearSort: () => void;
  applyAssigneeFilter: (value: string) => void;
  assigneeFilter: string;
  users: User[];
  applyDueFilter: (value: string) => void;
  dueFilter: string;
  statusFieldEnabled: boolean;
  statusOptions: string[];
  statusFilter: string;
  applyStatusFilter: (value: string) => void;
  statusFieldName: string;
  setStatusHidden: (value: boolean) => void;
  customFilter: Record<number, string>;
  setCustomFilter: (updater: (previous: Record<number, string>) => Record<number, string>) => void;
  onEditField: (field: CustomField) => void;
  setColumnFunction: (field: CustomField, fn: ColumnFunction) => void;
  toggleSubtaskTotals: (field: CustomField) => void;
  setHiddenCols: (updater: (previous: Set<number>) => Set<number>) => void;
  removeField: (field: CustomField) => void;
}) {
  const sortable = columnKey === "name" || columnKey === "due" || columnKey === "progress";
  const open = menuCol === columnKey;
  return (

      <span
        data-list-header={columnKey}
        draggable={columnKey !== "name"}
        className={`group/hd relative flex w-full min-w-0 cursor-grab items-center gap-0.5 self-stretch select-none active:cursor-grabbing ${
          columnKey === "name" ? "" : "pl-2"
        } ${
          colDragging === columnKey
            ? "bg-surface-muted/70 [&>*]:invisible"
            : colDropOver === columnKey
              ? "bg-surface-muted"
              : `hover:bg-surface-muted ${open ? "bg-surface-muted" : ""}`
        }`}
        onDragStart={(event) => startColumnDrag(event, columnKey, label)}
        onDragEnd={endColumnDrag}
        onDragOver={(event) => dragOverColumn(event, columnKey)}
        onDragLeave={(event) => dragLeaveColumn(event, columnKey)}
        onDrop={(event) => dropColumn(event, columnKey)}
      >
        {colDropOver === columnKey && colDropSide && (
          <span
            data-column-drop-indicator={colDropSide}
            className={`pointer-events-none absolute inset-y-0 z-10 w-[2px] bg-accent ${
              colDropSide === "before" ? "-left-[1px]" : "-right-[1px]"
            }`}
          />
        )}
        {sortable ? (
          <button
            onClick={() => cycleSort(columnKey as "name" | "due" | "progress")}
            title="クリックで並び替え（昇順→降順→解除）"
            className="truncate hover:text-text"
          >
            {label}
            {sortMark(columnKey as "name" | "due" | "progress")}
          </button>
        ) : (
          <span className="truncate">{label}</span>
        )}
        <button
          onClick={() => setMenuCol(open ? null : columnKey)}
          title="列メニュー"
          className={`rounded px-0.5 text-[10px] leading-none text-muted hover:bg-hover-strong hover:text-secondary ${
            open ? "opacity-100" : "opacity-0 group-hover/hd:opacity-100 focus-visible:opacity-100"
          }`}
        >
          ▾
        </button>
        {columnKey !== "name" && (
          <span
            onMouseDown={(e) => gripMouseDown(e, columnKey)}
            title="ドラッグで列幅を変更"
            className="absolute top-0 -right-2 bottom-0 z-10 w-4 cursor-col-resize hover:bg-accent-line"
          />
        )}
        {columnKey === "name" && (
          <span
            onMouseDown={(e) => gripMouseDown(e, columnKey)}
            title="ドラッグで列幅を変更"
            className="absolute top-0 -right-2 bottom-0 z-10 w-4 cursor-col-resize hover:bg-accent-line"
          />
        )}
        {open && (
          <div className="absolute top-full left-0 z-40 mt-1 w-60 rounded-lg border bg-surface py-1 text-sm shadow-lg">
            {columnKey !== "name" && (
              <>
                <div className={menuLabel}>列を移動</div>
                <div className="flex gap-1 px-3 pb-1">
                  <button
                    disabled={visibleCols[0] === columnKey}
                    onClick={() => moveCol(columnKey, -1)}
                    className="rounded border px-2 py-0.5 text-xs hover:bg-hover disabled:opacity-40"
                  >
                    ← 左へ
                  </button>
                  <button
                    disabled={visibleCols[visibleCols.length - 1] === columnKey}
                    onClick={() => moveCol(columnKey, 1)}
                    className="rounded border px-2 py-0.5 text-xs hover:bg-hover disabled:opacity-40"
                  >
                    右へ →
                  </button>
                </div>
              </>
            )}
            {sortable && (
              <>
                <div className={menuLabel}>ソート</div>
                <button className={menuItem} onClick={() => { applySort(columnKey as "name" | "due" | "progress", "asc"); setMenuCol(null); }}>
                  {columnKey === "due" ? "期日の近い順（昇順）" : "昇順"}
                </button>
                <button className={menuItem} onClick={() => { applySort(columnKey as "name" | "due" | "progress", "desc"); setMenuCol(null); }}>
                  {columnKey === "due" ? "期日の遠い順（降順）" : "降順"}
                </button>
                <button className={menuItem} onClick={() => { clearSort(); setMenuCol(null); }}>
                  ソートをクリア
                </button>
              </>
            )}
            {columnKey === "assignee" && (
              <>
                <div className={menuLabel}>フィルター</div>
                <button className={menuItem} onClick={() => { applyAssigneeFilter(""); setMenuCol(null); }}>
                  すべて（解除）
                </button>
                <button className={menuItem} onClick={() => { applyAssigneeFilter("none"); setMenuCol(null); }}>
                  未割当
                </button>
                {users.map((u) => (
                  <button key={u.id} className={menuItem} onClick={() => { applyAssigneeFilter(String(u.id)); setMenuCol(null); }}>
                    {u.name}
                    {assigneeFilter === String(u.id) ? " ✓" : ""}
                  </button>
                ))}
              </>
            )}
            {columnKey === "due" && (
              <>
                <div className={menuLabel}>フィルター</div>
                {[
                  ["", "すべて（解除）"],
                  ["overdue", "期限切れ"],
                  ["today", "今日"],
                  ["week", "今週"],
                  ["nextweek", "来週"],
                  ["month", "今月"],
                ].map(([v, l]) => (
                  <button key={v} className={menuItem} onClick={() => { applyDueFilter(v); setMenuCol(null); }}>
                    {l}
                    {dueFilter === v && v !== "" ? " ✓" : ""}
                  </button>
                ))}
              </>
            )}
            {statusFieldEnabled && columnKey === "status" && (
              <>
                <div className={menuLabel}>フィルター</div>
                <button className={menuItem} onClick={() => { applyStatusFilter(""); setMenuCol(null); }}>
                  すべて（解除）
                </button>
                {statusOptions.map((st) => (
                  <button key={st} className={menuItem} onClick={() => { applyStatusFilter(st); setMenuCol(null); }}>
                    {st}
                    {statusFilter === st ? " ✓" : ""}
                  </button>
                ))}
                <button
                  className={menuItem}
                  onClick={() => {
                    setMenuCol(null);
                    window.dispatchEvent(
                      new CustomEvent("atlas:open-customize", { detail: { panel: "status" } }),
                    );
                  }}
                >
                  {statusFieldName}フィールドを編集
                </button>
                <button
                  className={menuItem}
                  onClick={() => {
                    setStatusHidden(true);
                    setMenuCol(null);
                  }}
                >
                  列を非表示
                </button>
              </>
            )}
            {field && (
              <>
                {(field.field_type === "select" || field.field_type === "multi_select") && (
                  <>
                    <div className={menuLabel}>フィルター</div>
                    <button
                      className={menuItem}
                      onClick={() => {
                        setCustomFilter((m) => ({ ...m, [field.id]: "" }));
                        setMenuCol(null);
                      }}
                    >
                      すべて（解除）
                    </button>
                    {field.options.map((o) => (
                      <button
                        key={o}
                        className={menuItem}
                        onClick={() => {
                          setCustomFilter((m) => ({ ...m, [field.id]: o }));
                          setMenuCol(null);
                        }}
                      >
                        {o}
                        {customFilter[field.id] === o ? " ✓" : ""}
                      </button>
                    ))}
                  </>
                )}
                {field.field_type === "people" && (
                  <>
                    <div className={menuLabel}>フィルター</div>
                    <button
                      className={menuItem}
                      onClick={() => {
                        setCustomFilter((m) => ({ ...m, [field.id]: "" }));
                        setMenuCol(null);
                      }}
                    >
                      すべて（解除）
                    </button>
                    {(users ?? []).map((user) => (
                      <button
                        key={user.id}
                        className={menuItem}
                        onClick={() => {
                          setCustomFilter((m) => ({ ...m, [field.id]: String(user.id) }));
                          setMenuCol(null);
                        }}
                      >
                        {user.name}
                        {customFilter[field.id] === String(user.id) ? " ✓" : ""}
                      </button>
                    ))}
                  </>
                )}
                {(field.field_type === "number" || field.field_type === "formula" || field.field_type === "rollup") && (
                  <>
                    <div className={menuLabel}>列の関数</div>
                    {(["none", "sum", "average", "count", "min", "max"] as ColumnFunction[]).map((fn) => (
                      <button
                        key={fn}
                        className={menuItem}
                        onClick={() => {
                          setColumnFunction(field, fn);
                          setMenuCol(null);
                        }}
                      >
                        <span className="w-3 text-[11px]">{columnFunctionOf(field) === fn ? "✓" : ""}</span>
                        {COLUMN_FUNCTION_LABELS[fn]}
                      </button>
                    ))}
                    <button
                      className={menuItem}
                      onClick={() => {
                        toggleSubtaskTotals(field);
                        setMenuCol(null);
                      }}
                    >
                      <span className="w-3 text-[11px]">{field.config?.include_subtasks ? "✓" : ""}</span>
                      サブタスクの合計を含める
                    </button>
                  </>
                )}
                <button
                  className={menuItem}
                  onClick={() => {
                    onEditField(field);
                    setMenuCol(null);
                  }}
                >
                  フィールドアクセスと権限
                </button>
                <button
                  className={menuItem}
                  onClick={() => {
                    onEditField(field);
                    setMenuCol(null);
                  }}
                >
                  フィールドを編集
                </button>
                <button
                  className={menuItem}
                  onClick={() => {
                    setHiddenCols((prev) => new Set(prev).add(field.id));
                    setMenuCol(null);
                  }}
                >
                  列を非表示
                </button>
                <button className={menuItemBase + " text-danger hover:bg-danger-soft"} onClick={() => { removeField(field); setMenuCol(null); }}>
                  フィールドを削除
                </button>
              </>
            )}
          </div>
        )}
      </span>

  );
}
