import { projectColor, readableTextColor, type ProjectIconKey } from "@/lib/project-appearance";

function Glyph({ icon }: { icon: ProjectIconKey }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "h-[60%] w-[60%]",
  };
  if (icon === "list")
    return (
      <svg {...common}>
        <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
      </svg>
    );
  if (icon === "board")
    return (
      <svg {...common}>
        <path d="M4 4h5v16H4zM15 4h5v10h-5z" />
      </svg>
    );
  if (icon === "target")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  if (icon === "briefcase")
    return (
      <svg {...common}>
        <path d="M3 8h18v11H3z" />
        <path d="M9 8V5h6v3" />
      </svg>
    );
  if (icon === "heart")
    return (
      <svg {...common}>
        <path d="M12 20s-7-4.4-7-9.5A4.5 4.5 0 0 1 12 8a4.5 4.5 0 0 1 7 2.5C19 15.6 12 20 12 20z" />
      </svg>
    );
  if (icon === "star")
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-[62%] w-[62%]">
        <path d="m12 3 2.7 5.9 6.3.7-4.7 4.3 1.3 6.3-5.6-3.2-5.6 3.2 1.3-6.3L3 9.6l6.3-.7z" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M14 4c4 1.5 6 4.5 6 9-5 1-8-1-9-6" />
      <path d="M11 13 5 19" />
      <path d="M8 16c-3-1-4-3-4-6 3 0 5 1 6 4" />
    </svg>
  );
}

export default function ProjectIcon({
  id,
  name,
  color,
  icon,
  className = "h-7 w-7 text-sm",
}: {
  id: number;
  name: string;
  color?: string | null;
  icon?: string | null;
  className?: string;
}) {
  const key = icon as ProjectIconKey | null | undefined;
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-[5px] font-bold ${className}`}
      style={{ backgroundColor: projectColor(id, color), color: readableTextColor(projectColor(id, color)) }}
    >
      {key ? <Glyph icon={key} /> : name.slice(0, 1)}
    </span>
  );
}
