"use client";

import { isImeComposing } from "./ime-keyboard";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trap Tab/Shift+Tab inside a dialog or pane, focus the first control on open,
 * and restore focus to the previously focused element on close.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
  paused = false,
) {
  const escapeRef = useRef(onEscape);
  const pausedRef = useRef(paused);

  useEffect(() => {
    escapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.getClientRects().length > 0 && element.tabIndex !== -1,
      );

    if (!pausedRef.current) {
      const first = focusable()[0];
      (first ?? container).focus({ preventScroll: true });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      // A quick-task draft owns the keyboard: Escape cancels the draft and Tab
      // moves through the list while the pane shows its unsaved name.
      if (pausedRef.current) return;
      if (isImeComposing(event)) return;
      // A nested native modal owns focus and dismissal while the pane is inert.
      if (document.querySelector("dialog:modal")) return;
      if (event.key === "Escape" && escapeRef.current) {
        const target = event.target as HTMLElement | null;
        if (
          target?.closest(
            "[data-assignee-picker],[data-assignee-menu],[data-due-picker],[data-due-menu]",
          )
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        escapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const current = document.activeElement as HTMLElement | null;
      const index = current ? items.indexOf(current) : -1;
      if (event.shiftKey) {
        if (index <= 0) {
          event.preventDefault();
          items[items.length - 1].focus();
        }
      } else if (index === -1 || index === items.length - 1) {
        event.preventDefault();
        items[0].focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previous?.focus?.({ preventScroll: true });
    };
  }, [active, containerRef]);
}
