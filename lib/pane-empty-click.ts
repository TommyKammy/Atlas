/**
 * Decide whether a pointer target belongs to something the user is operating.
 * Empty list/board space is only the target when nothing below the task pane,
 * and none of these controls, owns the click.
 *
 * The accepted shape is intentionally the small part of `Element` needed here
 * so the rule can be unit tested without a DOM implementation.
 */
export type ClickTargetNode = {
  tagName?: string | null;
  getAttribute?: (name: string) => string | null;
  hasAttribute?: (name: string) => boolean;
  isContentEditable?: boolean;
  parentElement?: ClickTargetNode | null;
};

const CONTROL_TAGS = new Set([
  "a",
  "button",
  "input",
  "label",
  "optgroup",
  "option",
  "select",
  "summary",
  "textarea",
]);

const CONTROL_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "dialog",
  "link",
  "listbox",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

const CONTROL_ATTRIBUTES = [
  // Task pane, list rows and board cards own their own click behavior.
  "data-task-pane",
  "data-list-row",
  "data-board-card",
  // Explicit drag grips and resize handles.
  "data-drag-handle",
  "data-column-resize-handle",
  // Inline pickers and the overlays they open.
  "data-assignee-picker",
  "data-assignee-menu",
  "data-due-picker",
  "data-due-menu",
  // Open menus, popovers and dialogs (including portals).
  "data-popover-backdrop",
  "data-popover-panel",
  "data-field-type-menu",
  "data-field-dialog",
  "data-list-options-drawer",
  "data-list-filter-menu",
  "data-list-sort-menu",
  "data-list-group-menu",
  "data-board-filter-menu",
  "data-board-sort-menu",
  "data-board-group-menu",
  "data-section-menu",
  "data-task-context-menu",
];

function attribute(node: ClickTargetNode, name: string): string | null {
  if (node.getAttribute) return node.getAttribute(name);
  if (node.hasAttribute) return node.hasAttribute(name) ? "" : null;
  return null;
}

function ownsClick(node: ClickTargetNode): boolean {
  const tag = node.tagName?.toLowerCase() ?? "";
  if (CONTROL_TAGS.has(tag)) return true;

  if (node.isContentEditable) return true;
  const editable = attribute(node, "contenteditable");
  if (editable !== null && editable.toLowerCase() !== "false") return true;

  const role = attribute(node, "role")?.toLowerCase();
  if (role && CONTROL_ROLES.has(role)) return true;

  if (attribute(node, "aria-modal") === "true") return true;
  if (attribute(node, "aria-haspopup") !== null) return true;

  return CONTROL_ATTRIBUTES.some((name) => attribute(node, name) !== null);
}

/**
 * True when the click belongs to a control, an open overlay, a task row/card
 * or the pane, so an empty list/board click must leave the pane alone.
 */
export function isInteractiveClickTarget(
  target: ClickTargetNode | null | undefined,
): boolean {
  for (let node = target ?? null; node; node = node.parentElement ?? null) {
    if (ownsClick(node)) return true;
  }
  return false;
}
