/**
 * Page chrome shared by the standalone workspace screens (inbox, search,
 * trash, audit). Home sets the C workbench reference: a 15px bold screen name,
 * a 13px muted description, and 32px side padding on desktop.
 */
export const pageShellClass = "px-4 py-6 pb-16 md:px-8 md:py-8";
export const pageHeaderRowClass = "flex flex-wrap items-center gap-x-3 gap-y-2";
export const pageTitleClass = "text-[15px] font-bold text-text";
export const pageDescriptionClass = "mt-1 text-[13px] text-muted";

/**
 * Fixed-header page geometry: the page fills the shell's main region, its
 * header stays put, and only the single `data-page-scroll` region moves.
 * Use `pageFrameClass` on the route root, `pageFixedClass` on the chrome, and
 * `pageScrollClass` on the content region.
 */
export const pageFrameClass = "flex h-full min-h-0 flex-col";
export const pageFixedClass = "shrink-0";
export const pageScrollClass = "min-h-0 flex-1 overflow-auto";

/** Inset that matches the legacy `pageShellClass` left/right padding. */
export const pageHeaderInsetClass = "px-4 pt-6 md:px-8 md:pt-8";
export const pageContentInsetClass = "px-4 pb-16 md:px-8";
