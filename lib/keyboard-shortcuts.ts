import { isImeComposing } from "./ime-keyboard";

type CompositionKeyboardEvent = {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
};

/**
 * Elements that own text input. Single-key shortcuts must not run while one of
 * them, or a descendant of one, has focus.
 */
const EDITABLE_SELECTOR = [
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="searchbox"]',
  '[role="spinbutton"]',
].join(",");

const NON_TEXT_INPUT_TYPES = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "range",
  "color",
  "file",
]);

const EDITABLE_ROLES = new Set(["textbox", "combobox", "searchbox", "spinbutton"]);

type ShortcutTarget = {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => unknown;
};

export type SingleKeyShortcutEvent = CompositionKeyboardEvent & {
  key?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  defaultPrevented?: boolean;
  target?: unknown;
};

function asTarget(value: unknown): ShortcutTarget | null {
  return value !== null && typeof value === "object" ? (value as ShortcutTarget) : null;
}

function activeElementTarget(): ShortcutTarget | null {
  if (typeof document === "undefined") return null;
  return asTarget(document.activeElement);
}

function isEditableTarget(target: ShortcutTarget | null): boolean {
  if (!target) return false;
  const tagName = (target.tagName ?? "").toUpperCase();
  if (tagName === "TEXTAREA" || tagName === "SELECT") return true;
  if (tagName === "INPUT") {
    const type = (target.type ?? "text").toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }
  if (target.isContentEditable === true) return true;

  // Keep the check usable with minimal DOM stand-ins in unit tests.
  const contentEditable = target.getAttribute?.("contenteditable");
  if (contentEditable === "" || contentEditable === "true") return true;
  const role = target.getAttribute?.("role");
  if (role && EDITABLE_ROLES.has(role)) return true;

  return Boolean(target.closest?.(EDITABLE_SELECTOR));
}

/**
 * Single-character shortcuts (j/k, g then a view key, ?, n) must not fire
 * while the user is typing, converting with an IME, using a modifier shortcut,
 * or when another handler has already claimed the key.
 */
export function shouldIgnoreSingleKeyShortcut(
  event: SingleKeyShortcutEvent,
  activeElement: unknown = activeElementTarget(),
): boolean {
  if (isImeComposing(event)) return true;
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  if (event.defaultPrevented) return true;
  return isEditableTarget(asTarget(event.target)) || isEditableTarget(asTarget(activeElement));
}
