"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "ホーム", icon: "home" },
  { href: "/my-tasks", label: "マイタスク", icon: "check" },
  { href: "/inbox", label: "受信トレイ", icon: "inbox" },
  { href: "/search", label: "検索", icon: "search" },
  { href: "/portfolio", label: "ポートフォリオ", icon: "portfolio" },
] as const;

function RailIcon({ name }: { name: (typeof ITEMS)[number]["icon"] }) {
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

export default function SidebarRail() {
  const pathname = usePathname();
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto py-2">
      {ITEMS.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            aria-label={item.label}
            className={`flex h-9 w-9 items-center justify-center rounded-lg ${
              active ? "bg-white/15 text-white" : "text-neutral-400 hover:bg-white/10 hover:text-white"
            }`}
          >
            <RailIcon name={item.icon} />
          </Link>
        );
      })}
    </div>
  );
}
