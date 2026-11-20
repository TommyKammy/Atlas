import { isImeComposing } from "./ime-keyboard";

export type KeyboardShortcutScope = "global" | "project";

export type KeyboardShortcut = {
  /** Stable identifier used by tests and React keys. */
  id: string;
  /** Where the shortcut works. Project shortcuts are mounted by the project screen. */
  scope: KeyboardShortcutScope;
  /** Display label. Platform differences are written as "Mac / Windows". */
  keys: string;
  description: string;
};

export const KEYBOARD_SHORTCUT_SCOPES = ["global", "project"] as const;

export const SHORTCUT_SCOPE_LABELS: Record<KeyboardShortcutScope, string> = {
  global: "すべての画面",
  project: "プロジェクト画面",
};

export const SHORTCUT_SCOPE_DESCRIPTIONS: Record<KeyboardShortcutScope, string> = {
  global: "どの画面でも使えます。",
  project: "プロジェクト画面でのみ使えます。",
};

/**
 * The one display list shared by the help page, the project shortcut dialog
 * and the sidebar help dialog. Keep it in sync with the handlers in
 * components/Shortcuts.tsx, components/CommandPalette.tsx and
 * components/ui/FeedbackHost.tsx.
 */
export const KEYBOARD_SHORTCUTS: readonly KeyboardShortcut[] = [
  {
    id: "command-palette",
    scope: "global",
    keys: "⌘K / Ctrl+K",
    description: "検索とコマンドパレットを開く / 閉じる",
  },
  {
    id: "undo-task-delete",
    scope: "global",
    keys: "⌘Z / Ctrl+Z",
    description: "最後に削除したタスクを元に戻す（取り消せる場合）",
  },
  {
    id: "toggle-shortcuts",
    scope: "project",
    keys: "?",
    description: "ショートカット一覧の表示/非表示",
  },
  {
    id: "focus-add-task",
    scope: "project",
    keys: "n",
    description: "タスク追加欄にフォーカス",
  },
  {
    id: "go-to-view",
    scope: "project",
    keys: "g → o/d/l/b/t/c/m/f",
    description:
      "概要/ダッシュボード/リスト/ボード/タイムライン/カレンダー/メッセージ/ファイルへ移動",
  },
  {
    id: "move-row-arrows",
    scope: "project",
    keys: "↑ / ↓",
    description: "リスト内のタスク行を移動",
  },
  {
    id: "move-row-jk",
    scope: "project",
    keys: "j / k",
    description: "リスト内のタスク行を移動（次 / 前）",
  },
  {
    id: "open-task",
    scope: "project",
    keys: "Enter",
    description: "選択中のタスクを開く",
  },
  {
    id: "close-pane-or-help",
    scope: "project",
    keys: "Esc",
    description: "タスクペイン / ショートカット一覧を閉じる",
  },
];

/** Project and global rows in display order. */
export function shortcutsForScope(scope: KeyboardShortcutScope): readonly KeyboardShortcut[] {
  return KEYBOARD_SHORTCUTS.filter((shortcut) => shortcut.scope === scope);
}

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
