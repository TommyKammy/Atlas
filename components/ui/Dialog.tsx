"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export default function Dialog({
  open,
  onClose,
  title,
  titleId,
  children,
  panelClassName = "w-[min(560px,94vw)] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl",
  backdropClassName = "backdrop:bg-black/25",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  titleId?: string;
  children: ReactNode;
  panelClassName?: string;
  backdropClassName?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    dialog.showModal();
    // Closing before removal also restores focus when the owner unmounts us.
    return () => { if (dialog.open) dialog.close(); };
  }, [open, mounted]);

  if (!open || !mounted) return null;

  const outside = (event: { clientX: number; clientY: number }) => {
    const rect = dialogRef.current!.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom;
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      className={`atlas-dialog ${backdropClassName}`}
      aria-label={titleId ? undefined : title}
      aria-labelledby={titleId}
      {...({ closedby: "any" } as Record<string, string>)}
      onClose={(event) => { if (open && !event.currentTarget.open) onClose(); }}
      onPointerDown={(event) => {
        // Safari does not yet support closedby; require both ends outside so
        // selecting text and releasing over the backdrop cannot dismiss it.
        if (!("closedBy" in event.currentTarget)) pressedOutside.current = outside(event);
      }}
      onPointerUp={(event) => {
        if (!("closedBy" in event.currentTarget) && pressedOutside.current && outside(event)) {
          event.currentTarget.close();
        }
        pressedOutside.current = false;
      }}
    >
      <div className={panelClassName}>{children}</div>
    </dialog>,
    document.body,
  );
}
