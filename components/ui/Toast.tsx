"use client";

import { createPortal } from "react-dom";

export default function Toast({
  message,
  className = "fixed bottom-6 left-1/2 z-[120] -translate-x-1/2 rounded-md bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg",
  portal = false,
}: {
  message: string;
  className?: string;
  portal?: boolean;
}) {
  if (!message) return null;
  const node = (
    <div role="status" data-toast className={className}>
      {message}
    </div>
  );
  return portal && typeof document !== "undefined" ? createPortal(node, document.body) : node;
}
