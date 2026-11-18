import type { ButtonHTMLAttributes, HTMLAttributes } from "react";

// Shared project-view chrome. Page content supplies the 16px horizontal inset.
export const viewToolbarActionClass = "inline-flex h-7 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-line bg-surface px-2.5 text-[12px] font-medium text-text transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50";
export const viewToolbarControlClass = "inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-[12px] font-medium text-muted transition-colors hover:bg-hover hover:text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

export function ProjectViewToolbar({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-project-view-toolbar className={`relative flex min-h-11 shrink-0 flex-wrap items-center gap-x-1.5 gap-y-2 border-b border-line py-2 text-sm ${className}`} {...props} />;
}

export function ViewAddButton({ children = "タスクを追加", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`${viewToolbarActionClass} ${className}`} {...props}>
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 3v10M3 8h10" /></svg>
    {children}
  </button>;
}
