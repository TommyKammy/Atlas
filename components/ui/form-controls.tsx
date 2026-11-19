import type { SelectHTMLAttributes } from "react";

/**
 * Shared form primitives for the C workbench forms. These are applied to the
 * project create screen, project settings, the custom field dialogs, the rule
 * editor, and the standalone inbox, search and trash screens.
 *
 * Inputs and selects are 32px tall on the field surface with a hairline
 * border. Focus adds the accent border; the global keyboard focus ring is the
 * only ring (no extra focus:ring-* utility, which would double it).
 */
export const fieldControlClass =
  "h-8 w-full rounded-md border border-line bg-field px-2.5 text-[13px] text-text outline-none transition-colors placeholder:text-subtle hover:border-line-strong focus:border-accent disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-subtle disabled:text-muted";

export const fieldTextareaClass =
  "min-h-16 w-full resize-y rounded-md border border-line bg-field px-2.5 py-2 text-[13px] leading-5 text-text outline-none transition-colors placeholder:text-subtle hover:border-line-strong focus:border-accent disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-subtle disabled:text-muted";

export const fieldLabelClass = "block text-[12px] font-medium text-secondary";
export const fieldHintClass = "text-[12px] leading-5 text-muted";
export const formSectionTitleClass = "text-[13px] font-semibold text-text";
export const checkboxClass = "h-4 w-4 shrink-0 accent-accent";

export const primaryButtonClass =
  "inline-flex h-8 items-center justify-center rounded-md bg-accent px-3 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50";
export const secondaryButtonClass =
  "inline-flex h-8 items-center justify-center rounded-md border border-line bg-surface px-3 text-[13px] text-secondary hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";
export const quietButtonClass =
  "inline-flex h-8 items-center justify-center gap-1 rounded-md px-2 text-[12px] text-secondary hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";
/** The 28px row action used by inbox rows. */
export const smallQuietButtonClass =
  "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-[12px] text-secondary hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";
export const smallSecondaryButtonClass =
  "inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface px-2 text-[12px] text-secondary hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";
export const smallSecondaryPillButtonClass =
  "inline-flex h-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface px-2.5 text-[12px] text-secondary hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";
export const smallDangerButtonClass =
  "inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface px-2 text-[12px] text-danger hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";

export const dialogTitleClass = "text-[16px] font-semibold leading-6 text-text";
export const dialogSubtitleClass = "mt-0.5 text-[12px] leading-5 text-muted";
export const dialogCloseClass =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[18px] leading-none text-muted hover:bg-hover hover:text-text";

export function SelectControl({
  containerClassName = "",
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { containerClassName?: string }) {
  return (
    <span className={`relative block ${containerClassName}`}>
      <select
        {...props}
        className={`${fieldControlClass} appearance-none pr-8 ${className}`}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted"
      >
        <path d="m2.5 4.5 3.5 3 3.5-3" />
      </svg>
    </span>
  );
}
