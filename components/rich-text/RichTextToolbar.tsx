"use client";

import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import type { MouseEvent, ReactNode } from "react";
import { toast } from "@/lib/ui-feedback";
import { isSafeHref } from "@/lib/rich-text-url";

const buttonBase =
  "flex h-6 min-w-6 items-center justify-center rounded px-1 text-[11px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-30";

export default function RichTextToolbar({
  editor,
  compact = false,
  ariaLabel = "書式",
}: {
  editor: Editor;
  compact?: boolean;
  ariaLabel?: string;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      underline: current.isActive("underline"),
      strike: current.isActive("strike"),
      code: current.isActive("code"),
      highlight: current.isActive("highlight"),
      link: current.isActive("link"),
      bulletList: current.isActive("bulletList"),
      orderedList: current.isActive("orderedList"),
      taskList: current.isActive("taskList"),
      blockquote: current.isActive("blockquote"),
      codeBlock: current.isActive("codeBlock"),
      heading1: current.isActive("heading", { level: 1 }),
      heading2: current.isActive("heading", { level: 2 }),
      heading3: current.isActive("heading", { level: 3 }),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  });

  if (!state) return null;

  const keep = (event: MouseEvent) => event.preventDefault();
  const run = (callback: () => void) => {
    callback();
  };

  const block = state.codeBlock
    ? "codeBlock"
    : state.blockquote
      ? "blockquote"
      : state.heading1
        ? "h1"
        : state.heading2
          ? "h2"
          : state.heading3
            ? "h3"
            : "p";

  const setBlock = (value: string) => {
    if (value === "p") editor.chain().focus().setParagraph().run();
    else if (value === "blockquote") editor.chain().focus().toggleBlockquote().run();
    else if (value === "codeBlock") editor.chain().focus().toggleCodeBlock().run();
    else editor.chain().focus().toggleHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run();
  };

  const setLink = () => {
    const selected = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to);
    const href = window.prompt("リンクURL (https://…)", "https://");
    if (!href) return;
    if (!isSafeHref(href)) {
      toast("http / https / mailto のURLを入力してください");
      return;
    }
    if (selected) {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    } else {
      editor
        .chain()
        .focus()
        .insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] })
        .run();
    }
    toast("リンクを設定しました");
  };

  const btn = (active: boolean, label: string, title: string, onClick: () => void, content: ReactNode) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={title}
      onMouseDown={keep}
      onClick={() => run(onClick)}
      className={`${buttonBase} ${active ? "bg-blue-50 text-blue-700" : ""}`}
    >
      {content}
    </button>
  );

  return (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      className={`flex flex-wrap items-center gap-0.5 border-b border-neutral-100 px-1.5 py-1 ${
        compact ? "max-h-9 overflow-hidden" : ""
      }`}
    >
      <select
        aria-label="段落スタイル"
        value={block}
        onChange={(event) => setBlock(event.target.value)}
        className="mr-1 h-6 rounded border border-transparent bg-transparent px-1 text-[11px] text-neutral-600 outline-none hover:border-neutral-200 focus:border-[#4075cf]"
      >
        <option value="p">ノーマルテキスト</option>
        <option value="h1">見出し1</option>
        <option value="h2">見出し2</option>
        <option value="h3">見出し3</option>
        <option value="blockquote">引用</option>
        <option value="codeBlock">コードブロック</option>
      </select>

      {btn(state.bold, "太字", "太字", () => editor.chain().focus().toggleBold().run(), <strong>B</strong>)}
      {btn(state.italic, "斜体", "斜体", () => editor.chain().focus().toggleItalic().run(), <em>I</em>)}
      {btn(state.underline, "下線", "下線", () => editor.chain().focus().toggleUnderline().run(), <u>U</u>)}
      {btn(state.strike, "取り消し線", "取り消し線", () => editor.chain().focus().toggleStrike().run(), <s>S</s>)}
      {btn(state.code, "コード", "インラインコード", () => editor.chain().focus().toggleCode().run(), "<>")}
      {btn(state.highlight, "ハイライト", "ハイライト", () => editor.chain().focus().toggleHighlight().run(), "▮")}

      <span className="mx-0.5 h-4 w-px bg-neutral-200" />

      {btn(state.bulletList, "箇条書き", "箇条書き", () => editor.chain().focus().toggleBulletList().run(), "•")}
      {btn(state.orderedList, "番号付きリスト", "番号付きリスト", () => editor.chain().focus().toggleOrderedList().run(), "1.")}
      {btn(state.taskList, "チェックリスト", "チェックリスト", () => editor.chain().focus().toggleTaskList().run(), "☑")}
      {btn(state.blockquote, "引用", "引用", () => editor.chain().focus().toggleBlockquote().run(), "❝")}

      <span className="mx-0.5 h-4 w-px bg-neutral-200" />

      {btn(state.link, "リンク", "リンク", setLink, "🔗")}
      {btn(false, "元に戻す", "元に戻す", () => editor.chain().focus().undo().run(), "↶")}
      {btn(false, "やり直す", "やり直す", () => editor.chain().focus().redo().run(), "↷")}
    </div>
  );
}
