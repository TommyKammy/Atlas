import type { ProjectMenuIcon as IconName } from "@/lib/project-actions";

/** Small line icons used by the project actions menu. */
export default function ProjectMenuIcon({
  name,
  className = "h-4 w-4",
}: {
  name: IconName;
  className?: string;
}) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: `shrink-0 ${className}`,
  };
  if (name === "settings")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </svg>
    );
  if (name === "permissions")
    return (
      <svg {...common}>
        <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
        <path d="M1 14h6M9 8h6M17 16h6" />
      </svg>
    );
  if (name === "palette")
    return (
      <svg {...common}>
        <path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 1.4-3.4 2 2 0 0 1 1.4-3.4H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3z" />
        <circle cx="7.5" cy="11" r=".7" fill="currentColor" />
        <circle cx="10" cy="7.5" r=".7" fill="currentColor" />
        <circle cx="14.5" cy="7" r=".7" fill="currentColor" />
      </svg>
    );
  if (name === "link")
    return (
      <svg {...common}>
        <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5" />
        <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" />
      </svg>
    );
  if (name === "duplicate")
    return (
      <svg {...common}>
        <rect x="8" y="8" width="12" height="12" rx="1.5" />
        <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
      </svg>
    );
  if (name === "template")
    return (
      <svg {...common}>
        <rect x="4" y="3" width="16" height="18" rx="1.5" />
        <path d="M8 7h8M8 11h8M8 15h4" />
        <path d="M14.5 18.5h4M16.5 16.5v4" />
      </svg>
    );
  if (name === "plus")
    return (
      <svg {...common}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  if (name === "table")
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="16" rx="1.5" />
        <path d="M3 10h18M9 10v10M15 10v10" />
      </svg>
    );
  if (name === "import")
    return (
      <svg {...common}>
        <path d="M12 3v12M7 10l5 5 5-5" />
        <path d="M5 21h14" />
      </svg>
    );
  if (name === "export")
    return (
      <svg {...common}>
        <path d="M12 21V9M7 14l5-5 5 5" />
        <path d="M5 3h14" />
      </svg>
    );
  if (name === "archive")
    return (
      <svg {...common}>
        <path d="M3 7h18v13H3z" />
        <path d="M3 7h18M9 7V4h6v3" />
        <path d="M10 12h4" />
      </svg>
    );
  if (name === "trash")
    return (
      <svg {...common}>
        <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" />
        <path d="M10 11v6M14 11v6" />
      </svg>
    );
  if (name === "csv")
    return (
      <svg {...common}>
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v5h4" />
        <path d="M9 13h6M9 17h6" />
      </svg>
    );
  if (name === "xlsx")
    return (
      <svg {...common}>
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v5h4" />
        <path d="m9 13 6 6M15 13l-6 6" />
      </svg>
    );
  if (name === "json")
    return (
      <svg {...common}>
        <path d="M9 4H7a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h2" />
        <path d="M15 4h2a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-2" />
      </svg>
    );
  if (name === "clock")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  if (name === "calendar")
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="16" rx="1.5" />
        <path d="M8 3v4M16 3v4M3 10h18" />
      </svg>
    );
  if (name === "print")
    return (
      <svg {...common}>
        <path d="M7 8V3h10v5" />
        <rect x="4" y="8" width="16" height="9" rx="1.5" />
        <path d="M7 14h10v7H7z" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v5H5V6h5" />
    </svg>
  );
}
