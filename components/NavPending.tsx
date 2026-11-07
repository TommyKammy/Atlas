"use client";

import { useLinkStatus } from "next/link";
import { useEffect, useState } from "react";

/**
 * Small, fixed-size pending hint for a Link. The dot is always rendered so
 * the link does not shift layout; it only fades in after 120ms so fast
 * navigations do not flash an indicator.
 */
export default function NavPending({ className = "" }: { className?: string }) {
  const { pending } = useLinkStatus();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!pending) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), 120);
    return () => clearTimeout(timer);
  }, [pending]);

  return (
    <span
      aria-hidden
      data-nav-pending={visible ? "1" : "0"}
      className={`relative inline-flex h-0 w-0 shrink-0 items-center justify-center ${className}`}
    >
      <span
        className={`absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current transition-opacity duration-150 ${
          visible ? "animate-pulse opacity-70" : "opacity-0"
        }`}
      />
    </span>
  );
}
