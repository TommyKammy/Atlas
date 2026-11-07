"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RAIL_FLYOUTS, RAIL_ITEMS, type SidebarIconName } from "@/lib/navigation";

function RailIcon({ name }: { name: SidebarIconName }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "h-[18px] w-[18px]",
  };
  if (name === "home")
    return (
      <svg {...common}>
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V21h14V9.5" />
      </svg>
    );
  if (name === "check")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.5 2.5L16 9" />
      </svg>
    );
  if (name === "inbox")
    return (
      <svg {...common}>
        <path d="M4 4h16v16H4z" />
        <path d="M4 14h4l2 3h4l2-3h4" />
      </svg>
    );
  if (name === "search")
    return (
      <svg {...common}>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m15.5 15.5 4 4" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M12 3a9 9 0 1 0 9 9h-9z" />
      <path d="M12 3v9h9" />
    </svg>
  );
}

export default function SidebarRail({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();
  const [openHref, setOpenHref] = useState<string | null>(null);
  const closeTimer = useRef<number | null>(null);

  const showFlyout = (href: string) => {
    if (!collapsed) return;
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setOpenHref(href);
  };
  const scheduleClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpenHref(null), 120);
  };

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  return (
    <div data-sidebar-rail className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-visible py-2">
      {RAIL_ITEMS.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <div
            key={item.href}
            className="relative"
            onMouseEnter={() => showFlyout(item.href)}
            onMouseLeave={scheduleClose}
            onFocus={() => showFlyout(item.href)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) scheduleClose();
            }}
          >
            <Link
              href={item.href}
              title={item.label}
              aria-label={item.label}
              className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                active ? "bg-white/15 text-white" : "text-neutral-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              <RailIcon name={item.icon} />
            </Link>
            <div
              data-sidebar-flyout={item.href}
              className={`absolute left-full top-0 z-[60] ml-2 w-56 rounded-lg border border-white/10 bg-[#1f1f1f] p-2 text-neutral-200 shadow-2xl ${
                collapsed && openHref === item.href ? "" : "hidden"
              }`}
            >
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                {item.label}
              </div>
              {RAIL_FLYOUTS[item.href].map((link) => (
                <Link
                  key={`${item.href}-${link.label}`}
                  href={link.href}
                  data-sidebar-flyout-link={link.label}
                  onClick={() => setOpenHref(null)}
                  className="block rounded px-2 py-1.5 text-[13px] text-neutral-200 hover:bg-white/10 hover:text-white"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
