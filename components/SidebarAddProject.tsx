import Link from "next/link";

export default function SidebarAddProject() {
  return (
    <Link
      href="/projects/new"
      data-sidebar-add-project
      aria-label="新規プロジェクト"
      title="新規プロジェクト"
      className="flex h-5 w-5 items-center justify-center rounded text-inverse-text-muted hover:bg-overlay/10 hover:text-on-strong"
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M8 3v10M3 8h10" />
      </svg>
    </Link>
  );
}
