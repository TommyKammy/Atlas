"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ThemeToggle({
  initialTheme,
  variant = "sidebar",
}: {
  initialTheme: "light" | "dark";
  /** "sidebar" follows the sidebar tokens; "topbar" follows the page surface. */
  variant?: "sidebar" | "topbar";
}) {
  const router = useRouter();
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);
  const colorClass =
    variant === "sidebar"
      ? "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-text-strong"
      : "text-muted hover:bg-hover hover:text-text";

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    document.cookie = `atlas_theme=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };

  return (
    <button
      type="button"
      data-theme-toggle
      data-theme-toggle-variant={variant}
      data-theme-state={theme}
      onClick={toggle}
      aria-label={theme === "dark" ? "ライトモードに切り替える" : "ダークモードに切り替える"}
      aria-pressed={theme === "dark"}
      title={theme === "dark" ? "ライトモード" : "ダークモード"}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${colorClass}`}
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z" />
        </svg>
      )}
    </button>
  );
}
