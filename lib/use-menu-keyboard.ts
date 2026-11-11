"use client";

import { isImeComposing } from "./ime-keyboard";

import { useEffect, useRef, type RefObject } from "react";

const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

/** Next focused item for a menu navigation key, or null when unhandled. */
export function menuIndexForKey(
  key: string,
  currentIndex: number,
  length: number,
): number | null {
  if (length <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowDown") return currentIndex < 0 ? 0 : (currentIndex + 1) % length;
  if (key === "ArrowUp") return currentIndex < 0 ? length - 1 : (currentIndex - 1 + length) % length;
  return null;
}

/**
 * Shared menu keyboard contract: roving focus with arrow keys, Home/End,
 * Escape to close, and focus restoration to the opener.
 */
export function useMenuKeyboard({
  open = true,
  containerRef,
  onClose,
  autoFocus = true,
}: {
  open?: boolean;
  containerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  autoFocus?: boolean;
}) {
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const root = containerRef.current;
    if (!root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = () =>
      Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));

    const focusAt = (index: number) => {
      const list = items();
      if (list.length === 0) return;
      const next = ((index % list.length) + list.length) % list.length;
      list[next]?.focus();
    };

    let raf = 0;
    if (autoFocus) raf = window.requestAnimationFrame(() => focusAt(0));

    const onKeyDown = (event: KeyboardEvent) => {
      if (isImeComposing(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (!NAV_KEYS.has(event.key)) return;
      const list = items();
      if (list.length === 0) return;
      const current = list.indexOf(document.activeElement as HTMLElement);
      const next = menuIndexForKey(event.key, current, list.length);
      if (next === null) return;
      event.preventDefault();
      focusAt(next);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [open, containerRef, autoFocus]);
}
