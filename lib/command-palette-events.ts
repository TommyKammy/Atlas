export const OPEN_COMMAND_PALETTE_EVENT = "atlas:open-command-palette";

export type OpenCommandPaletteDetail = {
  /** The control that opened the palette; focus returns here when it closes. */
  trigger: HTMLElement | null;
};

/**
 * Open the command palette from outside its own component.
 *
 * The trigger is passed through the event instead of relying on
 * document.activeElement: Safari does not focus a button on click, so the
 * clicked search button would otherwise be lost and focus could not return.
 */
export function openCommandPalette(trigger?: HTMLElement | null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OpenCommandPaletteDetail>(OPEN_COMMAND_PALETTE_EVENT, {
      detail: { trigger: trigger ?? null },
    }),
  );
}
