/** Viewport top for the project customize / list options slide-over panels. */
export function projectDrawerTop(): number {
  if (typeof document === "undefined") return 0;
  const listView = document.querySelector<HTMLElement>("[data-list-view]");
  if (listView) return Math.max(0, Math.round(listView.getBoundingClientRect().top));
  const tabs = document.querySelector<HTMLElement>("[data-project-tabs]");
  if (tabs) return Math.max(0, Math.round(tabs.getBoundingClientRect().bottom));
  return 0;
}
