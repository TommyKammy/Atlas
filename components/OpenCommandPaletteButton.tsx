"use client";

import { useRef, useSyncExternalStore } from "react";
import { openCommandPalette } from "@/lib/command-palette-events";

function platformShortcut(): string {
  if (typeof navigator === "undefined") return "⌘K";
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
    ? "⌘K"
    : "Ctrl+K";
}

// The platform does not change while the page is open, so there is nothing to
// subscribe to. useSyncExternalStore serves "⌘K" during SSR and then switches
// to the platform label after hydration without a setState-in-effect cascade.
function subscribeToPlatform(): () => void {
  return () => {};
}

/**
 * Opens the command palette and returns focus to this button when it closes.
 * Color and spacing classes come from the surrounding rail or sidebar so the
 * new control uses the same visual language without adding color literals.
 */
export default function OpenCommandPaletteButton({
  className,
  iconOnly = false,
  showShortcut = false,
}: {
  className: string;
  iconOnly?: boolean;
  showShortcut?: boolean;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const shortcut = useSyncExternalStore(subscribeToPlatform, platformShortcut, () => "⌘K");

  const accessibleName = `検索（${shortcut}）`;

  return (
    <button
      ref={button}
      type="button"
      data-command-palette-open
      aria-label={accessibleName}
      title={accessibleName}
      onClick={() => openCommandPalette(button.current)}
      className={className}
    >
      {iconOnly ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="h-[18px] w-[18px]"
        >
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 4 4" />
        </svg>
      ) : (
        <span className="min-w-0 truncate">検索</span>
      )}
      {!iconOnly && showShortcut && (
        <kbd className="ml-auto shrink-0 font-mono text-[10px] leading-4 opacity-70">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}
