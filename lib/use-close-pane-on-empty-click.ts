"use client";

import { useEffect, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { taskPaneCloseHref } from "./task-pane-navigation";
import { isInteractiveClickTarget } from "./pane-empty-click";

/** A press that travels farther than this is a drag or a text selection. */
const DRAG_DISTANCE = 5;
/** Ignore the synthetic click browsers may emit right after a drop. */
const DRAG_SETTLE_MS = 250;
const OVERLAY_SELECTOR = [
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[aria-modal="true"]',
  "dialog[open]",
  "details[open]",
  "[data-popover-backdrop]",
  "[data-popover-panel]",
  "[data-field-type-menu]",
  "[data-field-dialog]",
  "[data-list-options-drawer]",
  "[data-list-filter-menu]",
  "[data-list-sort-menu]",
  "[data-list-group-menu]",
  "[data-board-filter-menu]",
  "[data-board-sort-menu]",
  "[data-board-group-menu]",
  "[data-section-menu]",
  "[data-task-context-menu]",
].join(",");

type PointerStart = {
  x: number;
  y: number;
  target: Element | null;
  suppress: boolean;
  /**
   * The gesture began while the pane showed a draft that already has a name.
   * Pressing empty space blurs and commits that draft, and the commit hands the
   * pane to the created task. That can finish before the button is released,
   * so the whole gesture must not close the pane.
   */
  namedDraft: boolean;
};

/** Draft rows keep a negative id until the task is created. */
const DRAFT_NAME_INPUT = '[data-quick-task^="-"] input';

function asElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

/**
 * `true` when the pointer is to the right of the list row's last data cell.
 * The row grid has a final elastic cell for the hover-only delete button; the
 * empty part of that cell is still "outside the columns".
 */
function isPastLastListRowCell(row: Element, clientX: number): boolean {
  let lastCellRight = -Infinity;
  for (const child of row.children) {
    if (child.hasAttribute("data-list-row-delete")) continue;
    const rect = child.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    lastCellRight = Math.max(lastCellRight, rect.right);
  }
  return Number.isFinite(lastCellRight) && clientX > lastCellRight + 1;
}

function isRowGapTarget(target: Element, clientX: number): boolean {
  const row = target.closest("[data-list-row]");
  return row !== null && target === row && isPastLastListRowCell(row, clientX);
}

/**
 * Close the task pane when a click lands on empty list/board space.
 *
 * Clicks on controls, task rows/cards, open overlays and the pane itself keep
 * their normal behavior. A row click past its last data cell closes the pane,
 * and the row handler is stopped so it cannot reopen the clicked task.
 */
export function useClosePaneOnEmptyClick(
  rootRef: RefObject<HTMLElement | null>,
  { projectId, view }: { projectId: number; view: string },
) {
  const router = useRouter();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let start: PointerStart | null = null;
    let dragging = false;
    let dragEndedAt = 0;

    const currentPane = () => document.querySelector<HTMLElement>("[data-task-pane]");

    const hasOpenOverlay = (pane: HTMLElement | null) => {
      for (const node of document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)) {
        if (pane?.contains(node)) continue;
        if (node.getClientRects().length === 0) continue;
        return true;
      }
      return false;
    };

    // On narrow screens the pane is a full-viewport overlay; there is no list
    // or board area beside it, so the feature stays out of the way.
    const isOutsidePane = (pane: HTMLElement, clientX: number) => {
      const rect = pane.getBoundingClientRect();
      return rect.left > 0 && clientX < rect.left;
    };

    const shouldSuppress = (event: PointerEvent, pane: HTMLElement) => {
      if (event.button !== 0) return true;
      if (event.shiftKey || event.ctrlKey || event.metaKey) return true;
      if (!isOutsidePane(pane, event.clientX)) return true;
      if (hasOpenOverlay(pane)) return true;
      const target = asElement(event.target);
      if (!target) return true;
      if (isRowGapTarget(target, event.clientX)) return false;
      return isInteractiveClickTarget(target);
    };

    const hasNamedDraft = (pane: HTMLElement) =>
      pane.hasAttribute("data-task-pane-draft") &&
      [...document.querySelectorAll<HTMLInputElement>(DRAFT_NAME_INPUT)].some(
        (input) => input.value.trim() !== "",
      );

    const onPointerDown = (event: PointerEvent) => {
      // A drag cancelled in dragstart never fires dragend/drop; a new press
      // means any such drag is over, so never carry the flag into it.
      dragging = false;
      const pane = currentPane();
      if (!pane) {
        start = null;
        return;
      }
      start = {
        x: event.clientX,
        y: event.clientY,
        target: asElement(event.target),
        suppress: shouldSuppress(event, pane),
        namedDraft: hasNamedDraft(pane),
      };
    };

    const close = () => {
      // Keep the same URL as the pane header's close link.
      const search = window.location.search.replace(/^\?/, "");
      router.push(taskPaneCloseHref(projectId, view, search));
    };

    const onClick = (event: MouseEvent) => {
      const pane = currentPane();
      const pressed = start;
      start = null;
      if (!pane) return;
      if (event.button !== 0) return;
      if (event.shiftKey || event.ctrlKey || event.metaKey) return;
      if (!isOutsidePane(pane, event.clientX)) return;
      if (
        pressed &&
        Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) >= DRAG_DISTANCE
      ) {
        return;
      }
      if (window.getSelection()?.toString()) return;
      if (dragging || performance.now() - dragEndedAt < DRAG_SETTLE_MS) return;
      if (pressed?.suppress) return;
      if (pressed?.namedDraft) return;

      const target = pressed?.target ?? asElement(event.target);
      if (!target) return;
      // A menu/backdrop may have been closed on mousedown, before this click.
      if (hasOpenOverlay(pane)) return;
      // A draft still saving in the pane keeps it open; its existing handoff to
      // the created task must win. A cancelled empty draft is already gone by
      // the time the click fires, so that click closes the returned pane.
      if (pane.hasAttribute("data-task-pane-draft")) return;

      if (isRowGapTarget(target, event.clientX)) {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (isInteractiveClickTarget(target)) return;
      close();
    };

    const onDragStart = (event: DragEvent) => {
      start = null;
      // Capture runs before the target's handlers. Decide once dispatch is
      // over: a cancelled dragstart (e.g. the draft name input) starts no drag
      // and will never send dragend, so it must not leave the flag set. A
      // microtask is not enough: for native events microtasks run between
      // listeners, i.e. before the target's handler could cancel the drag.
      dragging = true;
      setTimeout(() => {
        if (event.defaultPrevented) dragging = false;
      }, 0);
    };
    const onDragEnd = () => {
      dragging = false;
      dragEndedAt = performance.now();
    };

    root.addEventListener("pointerdown", onPointerDown, true);
    root.addEventListener("click", onClick, true);
    root.addEventListener("dragstart", onDragStart, true);
    root.addEventListener("dragend", onDragEnd, true);
    root.addEventListener("drop", onDragEnd, true);

    return () => {
      root.removeEventListener("pointerdown", onPointerDown, true);
      root.removeEventListener("click", onClick, true);
      root.removeEventListener("dragstart", onDragStart, true);
      root.removeEventListener("dragend", onDragEnd, true);
      root.removeEventListener("drop", onDragEnd, true);
    };
  }, [projectId, router, rootRef, view]);
}
