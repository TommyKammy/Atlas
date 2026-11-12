import { Extension, mergeAttributes, type Editor } from "@tiptap/core";
import { Selection, TextSelection } from "@tiptap/pm/state";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";

export function isKnowledgeImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}

const KnowledgeImage = Image.extend({
  parseHTML() {
    return [{ tag: "img[src]", getAttrs: (element) => isKnowledgeImageUrl(element.getAttribute("src")) ? null : false }];
  },
  renderHTML({ HTMLAttributes }) {
    if (!isKnowledgeImageUrl(HTMLAttributes.src)) return ["span", {}, "画像URLが無効です"];
    return ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { loading: "lazy", referrerpolicy: "no-referrer" })];
  },
}).configure({ allowBase64: false });

/** Move the selected top-level block, preserving its content and undo history. */
export function moveKnowledgeBlock(editor: Editor, direction: -1 | 1, dispatch = true): boolean {
  const { doc } = editor.state;
  let selection = editor.state.selection;
  // A pointer selection can precede ProseMirror's selectionchange observer.
  // Honor the visible caret even when Alt+Arrow follows the click immediately.
  if (dispatch && selection instanceof TextSelection && editor.view.hasFocus()) {
    const domSelection = editor.view.dom.ownerDocument.getSelection();
    if (domSelection?.anchorNode && domSelection.focusNode &&
      editor.view.dom.contains(domSelection.anchorNode) && editor.view.dom.contains(domSelection.focusNode)) {
      const anchor = editor.view.posAtDOM(domSelection.anchorNode, domSelection.anchorOffset);
      const head = editor.view.posAtDOM(domSelection.focusNode, domSelection.focusOffset);
      selection = TextSelection.between(doc.resolve(anchor), doc.resolve(head));
      if (!selection.eq(editor.state.selection)) editor.view.dispatch(editor.state.tr.setSelection(selection));
    }
  }
  const index = selection.$from.index(0);
  const target = index + direction;
  if (index >= doc.childCount || target < 0 || target >= doc.childCount) return false;
  const from = selection.$from.depth > 0 ? selection.$from.before(1) : selection.from;
  const node = doc.child(index);
  if (selection.to > from + node.nodeSize) return false;
  if (!dispatch) return true;
  const tr = editor.state.tr;
  const neighbor = doc.child(target);
  const start = direction < 0 ? from - neighbor.nodeSize : from;
  const content = direction < 0 ? [node, neighbor] : [neighbor, node];
  tr.replaceWith(start, start + node.nodeSize + neighbor.nodeSize, content);
  const movedStart = direction < 0 ? start : start + neighbor.nodeSize;
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(movedStart + 1, tr.doc.content.size))));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}

const BlockMovement = Extension.create({
  name: "knowledgeBlockMovement",
  addKeyboardShortcuts() {
    return {
      "Alt-ArrowUp": () => moveKnowledgeBlock(this.editor, -1),
      "Alt-ArrowDown": () => moveKnowledgeBlock(this.editor, 1),
    };
  },
});

// Only knowledge pages opt into these nodes. Task/comment schemas stay unchanged.
export const knowledgeExtensions = [TableKit.configure({ table: { resizable: false } }), KnowledgeImage, BlockMovement];
