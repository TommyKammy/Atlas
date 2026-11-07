"use client";

import { useEffect, useRef, type ReactNode } from "react";

type DataProps = { [key: `data-${string}`]: string | number | boolean | undefined };

/**
 * Lightweight menu overlay: fixed click-away layer, Escape handling and focus
 * restoration. The panel keeps the caller's exact positioning classes.
 */
export default function PopoverMenu({
  open,
  onClose,
  panelClassName,
  panelProps,
  children,
}: {
  open: boolean;
  onClose: () => void;
  panelClassName: string;
  panelProps?: DataProps;
  children: ReactNode;
}) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <>
      <button
        type="button"
        aria-label="メニューを閉じる"
        onClick={onClose}
        className="fixed inset-0 z-20 cursor-default bg-transparent"
      />
      <div {...panelProps} className={panelClassName}>
        {children}
      </div>
    </>
  );
}
