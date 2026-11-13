import type { ButtonHTMLAttributes, HTMLAttributes } from "react";

// Shared project-view chrome. Page content supplies the 16px horizontal inset.
export const viewToolbarActionClass = "inline-flex h-7 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-[#e1e1e1] bg-white px-2.5 text-[12px] font-medium text-neutral-800 transition-colors hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50";
export const viewToolbarControlClass = "inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-[12px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";

export function ProjectViewToolbar({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-project-view-toolbar className={`relative flex min-h-11 shrink-0 flex-wrap items-center gap-x-1.5 gap-y-2 border-b border-neutral-200 py-2 text-sm ${className}`} {...props} />;
}

export function ViewAddButton({ children = "タスクを追加", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`${viewToolbarActionClass} ${className}`} {...props}>
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 3v10M3 8h10" /></svg>
    {children}
  </button>;
}
