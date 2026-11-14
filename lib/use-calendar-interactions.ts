"use client";

import { useRef } from "react";
import { formatDay, parseDay } from "./calendar";
import type { TaskRow } from "./data";
import { isImeComposing } from "./ime-keyboard";
import { dropTaskOnDate, moveTaskSpan, pixelsToDayDelta, resizeTaskEnd, resizeTaskStart } from "./task-dates";

/** Calendar gestures share a session; rendering and persistence remain with the view. */
export function useCalendarInteractions({ tasks, showMulti, openTask, patchTaskFields }: {
  tasks: TaskRow[];
  showMulti: boolean;
  openTask: (id: number) => void;
  patchTaskFields: (task: TaskRow, fields: Record<string, unknown>) => Promise<boolean>;
}) {
  const dragging = useRef(false);
  const touchMove = useRef<{
    taskId: number;
    startX: number;
    startY: number;
    start: number;
    end: number;
    dayWidth: number;
    single: boolean;
    moved: boolean;
  } | null>(null);
  const calendarResize = useRef<{
    taskId: number;
    edge: "start" | "end";
    startX: number;
    dayWidth: number;
    start: number;
    end: number;
  } | null>(null);

  const onDrop = async (e: React.DragEvent, date: string) => {
    e.preventDefault();
    const taskId = Number(e.dataTransfer.getData("text/atlas-task"));
    if (!taskId) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const fields = dropTaskOnDate(task, date, showMulti);
    if (fields) await patchTaskFields(task, fields);
  };

  const multiDayWidthFromEvent = (event: React.PointerEvent) => {
    const grid = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-calendar-multi-grid]");
    const dayCells = [
      ...(grid?.parentElement?.parentElement?.querySelectorAll<HTMLElement>("[data-calendar-day]") ?? []),
    ];
    return grid && dayCells.length > 0
      ? Math.max(...dayCells.map((cell) => cell.getBoundingClientRect().width))
      : null;
  };

  const multiBarDragStart = (task: TaskRow, event: React.DragEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-calendar-resize]")) {
      event.preventDefault();
      return;
    }
    dragging.current = true;
    event.dataTransfer.setData("text/atlas-task", String(task.id));
  };
  const multiBarDragEnd = () => {
    setTimeout(() => {
      dragging.current = false;
    }, 0);
  };
  const multiBarClick = (task: TaskRow) => {
    if (dragging.current) return;
    openTask(task.id);
  };
  const multiBarKeyDown = (task: TaskRow, event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isImeComposing(event)) return;
    if (event.key === "Enter") openTask(task.id);
  };
  const multiBarPointerDown = (task: TaskRow, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    if ((event.target as HTMLElement).closest("[data-calendar-resize]")) return;
    const start = parseDay(task.start_on ?? task.due_on ?? "");
    const end = parseDay(task.due_on ?? task.start_on ?? "");
    const dayWidth = multiDayWidthFromEvent(event);
    if (dayWidth === null || start === null || end === null) return;
    touchMove.current = {
      taskId: task.id,
      startX: event.clientX,
      startY: event.clientY,
      start,
      end,
      dayWidth,
      single: false,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const multiBarPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = touchMove.current;
    if (!session) return;
    if (Math.abs(event.clientX - session.startX) > 6 || Math.abs(event.clientY - session.startY) > 6) {
      session.moved = true;
      dragging.current = true;
    }
  };
  const finishPointerMove = (task: TaskRow, event: React.PointerEvent<HTMLDivElement>) => {
    const session = touchMove.current;
    touchMove.current = null;
    if (!session || !session.moved) return;
    const delta = pixelsToDayDelta(event.clientX - session.startX, session.dayWidth);
    if (delta !== 0) {
      const fields = session.single
        ? dropTaskOnDate(task, formatDay(session.end + delta), false)
        : moveTaskSpan(task, delta);
      if (fields) void patchTaskFields(task, fields);
    }
    setTimeout(() => { dragging.current = false; }, 30);
  };
  const multiBarPointerUp = finishPointerMove;
  const multiBarPointerCancel = () => {
    touchMove.current = null;
    setTimeout(() => {
      dragging.current = false;
    }, 30);
  };
  const multiBarResizeDown = (
    task: TaskRow,
    edge: "start" | "end",
    event: React.PointerEvent<HTMLSpanElement>,
  ) => {
    const start = parseDay(task.start_on ?? task.due_on ?? "");
    const end = parseDay(task.due_on ?? task.start_on ?? "");
    const dayWidth = multiDayWidthFromEvent(event);
    if (start === null || end === null || dayWidth === null) return;
    event.preventDefault();
    event.stopPropagation();
    calendarResize.current = {
      taskId: task.id,
      edge,
      startX: event.clientX,
      dayWidth,
      start,
      end,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const multiBarResizeUp = (
    task: TaskRow,
    edge: "start" | "end",
    event: React.PointerEvent<HTMLSpanElement>,
  ) => {
    const session = calendarResize.current;
    calendarResize.current = null;
    if (!session) return;
    const delta = pixelsToDayDelta(event.clientX - session.startX, session.dayWidth);
    if (delta === 0) return;
    const fields = edge === "start" ? resizeTaskStart(task, delta) : resizeTaskEnd(task, delta);
    if (fields) void patchTaskFields(task, fields);
  };

  const singleBarDragStart = (task: TaskRow, event: React.DragEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.dataTransfer.setData("text/atlas-task", String(task.id));
  };
  const singleBarDragEnd = multiBarDragEnd;
  const singleBarClick = multiBarClick;
  const singleBarKeyDown = multiBarKeyDown;
  const singleBarPointerDown = (task: TaskRow, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    const day = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-calendar-day]");
    const start = parseDay(task.start_on ?? task.due_on ?? "");
    const end = parseDay(task.due_on ?? task.start_on ?? "");
    if (!day || start === null || end === null) return;
    touchMove.current = {
      taskId: task.id,
      startX: event.clientX,
      startY: event.clientY,
      start,
      end,
      dayWidth: day.getBoundingClientRect().width,
      single: true,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const singleBarPointerMove = multiBarPointerMove;
  const singleBarPointerUp = finishPointerMove;
  const singleBarPointerCancel = multiBarPointerCancel;

  return { dragging, onDrop, multiBarDragStart, multiBarDragEnd, multiBarClick, multiBarKeyDown, multiBarPointerDown, multiBarPointerMove, multiBarPointerUp, multiBarPointerCancel, multiBarResizeDown, multiBarResizeUp, singleBarDragStart, singleBarDragEnd, singleBarClick, singleBarKeyDown, singleBarPointerDown, singleBarPointerMove, singleBarPointerUp, singleBarPointerCancel };
}
