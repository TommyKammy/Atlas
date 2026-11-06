import Link from "next/link";

const TABS = [
  ["overview", "概要"],
  ["dashboard", "ダッシュボード"],
  ["list", "リスト"],
  ["board", "ボード"],
  ["timeline", "タイムライン"],
  ["calendar", "カレンダー"],
  ["messages", "メッセージ"],
  ["files", "ファイル"],
] as const;

const IMPLEMENTED = new Set(["overview", "dashboard", "list", "board", "timeline", "calendar", "messages", "files"]);

export default function ProjectTabs({
  projectId,
  active,
}: {
  projectId: number;
  active: string;
}) {
  return (
    <nav className="flex items-center gap-2 overflow-x-auto px-6 py-[3px] text-sm whitespace-nowrap">
      {TABS.map(([key, label]) =>
        IMPLEMENTED.has(key) ? (
          <Link
            key={key}
            href={`/projects/${projectId}?view=${key}`}
            className={`flex h-7 shrink-0 items-center rounded-md px-2 text-[14px] font-medium ${
              active === key
                ? "bg-[#eff4fd] text-[#2C60B8]"
                : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
            }`}
          >
            {label}
          </Link>
        ) : (
          <span key={key} className="cursor-not-allowed px-2 py-2 text-neutral-300">
            {label}
          </span>
        ),
      )}
    </nav>
  );
}
