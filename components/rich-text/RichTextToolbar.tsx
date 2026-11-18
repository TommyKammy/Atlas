"use client";

import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { toast } from "@/lib/ui-feedback";
import { isSafeHref } from "@/lib/rich-text-url";
import ToolbarButton from "./ToolbarButton";

type IconName =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "code"
  | "highlight"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "quote"
  | "link"
  | "undo"
  | "redo";

function ToolbarIcon({ name }: { name: IconName }) {
  const common = {
    viewBox: "0 0 20 20",
    className: "h-[17px] w-[17px]",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "bold":
      return (
        <svg {...common}>
          <path d="M6 3.5h4.7a3.1 3.1 0 0 1 0 6.2H6zM6 9.7h5.5a3.2 3.2 0 0 1 0 6.4H6z" />
        </svg>
      );
    case "italic":
      return (
        <svg {...common}>
          <path d="M8 3.5h6M6 16.5h6M11.5 3.5l-3 13" />
        </svg>
      );
    case "underline":
      return (
        <svg {...common}>
          <path d="M5 3v5.3a5 5 0 0 0 10 0V3M4 17h12" />
        </svg>
      );
    case "strike":
      return (
        <svg {...common}>
          <path d="M4 10h12M6.4 6.3C7 5.2 8.1 4.5 9.7 4.5c2.2 0 3.6 1.1 3.6 2.6 0 1-.6 1.7-1.8 2.2M13.6 13.7c-.6 1.1-1.7 1.8-3.3 1.8-2.2 0-3.6-1.1-3.6-2.6" />
        </svg>
      );
    case "code":
      return (
        <svg {...common}>
          <path d="M7 5.5 3 10l4 4.5M13 5.5l4 4.5-4 4.5" />
        </svg>
      );
    case "highlight":
      return (
        <svg {...common}>
          <path d="M4.5 16.5h6M7 14 3.5 10.5l6-6 3.5 3.5-6 6zM10 5l2-2 3.5 3.5-2 2" />
        </svg>
      );
    case "bulletList":
      return (
        <svg {...common}>
          <circle cx="4.5" cy="5.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="10" r="1" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="14.5" r="1" fill="currentColor" stroke="none" />
          <path d="M8.5 5.5h8M8.5 10h8M8.5 14.5h8" />
        </svg>
      );
    case "orderedList":
      return (
        <svg {...common}>
          <path d="M3.5 4.5h1v4M3.5 8.5h2M3.5 12h1.5a1 1 0 0 1 0 2H3.5l2 2h-2M9 5h7M9 10h7M9 15h7" />
        </svg>
      );
    case "taskList":
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="3" height="3" rx="0.5" />
          <path d="m4.2 5 0.8.8 1.3-1.5M3.5 12h3v3h-3zM9 5h7M9 13.5h7M9 10h4" />
        </svg>
      );
    case "quote":
      return (
        <svg {...common}>
          <path d="M3.5 7.5h4v4H5c0 1.7.8 2.9 2.3 3.6M11.5 7.5h4v4H13c0 1.7.8 2.9 2.3 3.6" />
        </svg>
      );
    case "link":
      return (
        <svg {...common}>
          <path d="M8 12 12 8M7.2 14.2l-1 1a2.8 2.8 0 0 1-4-4l2.5-2.5M12.8 5.8l1-1a2.8 2.8 0 0 1 4 4l-2.5 2.5" />
        </svg>
      );
    case "undo":
      return (
        <svg {...common}>
          <path d="M8 5 4 9l4 4M4 9h7.2a4.2 4.2 0 0 1 0 8.4H10" />
        </svg>
      );
    case "redo":
      return (
        <svg {...common}>
          <path d="m12 5 4 4-4 4M16 9H8.8a4.2 4.2 0 0 0 0 8.4H10" />
        </svg>
      );
  }
}

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
    }),
  });

  if (!state) return null;

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

  return (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      className={`flex flex-wrap items-center gap-0.5 border-b border-neutral-100 px-1.5 py-1 ${
        compact ? "atlas-toolbar-compact" : ""
      }`}
    >
      <select
        aria-label="段落スタイル"
        title="段落スタイル"
        value={block}
        onChange={(event) => setBlock(event.target.value)}
        className="mr-1 h-8 rounded-md border border-transparent bg-transparent px-1.5 text-[12px] text-neutral-600 outline-none hover:border-neutral-200 hover:bg-neutral-50 focus:border-[#4075cf]"
      >
        <option value="p">ノーマルテキスト</option>
        <option value="h1">見出し1</option>
        <option value="h2">見出し2</option>
        <option value="h3">見出し3</option>
        <option value="blockquote">引用</option>
        <option value="codeBlock">コードブロック</option>
      </select>

      <ToolbarButton label="太字" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
        <ToolbarIcon name="bold" />
      </ToolbarButton>
      <ToolbarButton label="斜体" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <ToolbarIcon name="italic" />
      </ToolbarButton>
      <ToolbarButton label="下線" active={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <ToolbarIcon name="underline" />
      </ToolbarButton>
      <ToolbarButton
        label="取り消し線"
        active={state.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <ToolbarIcon name="strike" />
      </ToolbarButton>
      <ToolbarButton label="インラインコード" active={state.code} onClick={() => editor.chain().focus().toggleCode().run()}>
        <ToolbarIcon name="code" />
      </ToolbarButton>
      <ToolbarButton
        label="ハイライト"
        active={state.highlight}
        onClick={() => editor.chain().focus().toggleHighlight().run()}
      >
        <ToolbarIcon name="highlight" />
      </ToolbarButton>

      <span className="mx-0.5 h-5 w-px bg-surface-strong" />

      <ToolbarButton
        label="箇条書き"
        active={state.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <ToolbarIcon name="bulletList" />
      </ToolbarButton>
      <ToolbarButton
        label="番号付きリスト"
        active={state.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ToolbarIcon name="orderedList" />
      </ToolbarButton>
      <ToolbarButton
        label="チェックリスト"
        active={state.taskList}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <ToolbarIcon name="taskList" />
      </ToolbarButton>
      <ToolbarButton
        label="引用"
        active={state.blockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <ToolbarIcon name="quote" />
      </ToolbarButton>

      <span className="mx-0.5 h-5 w-px bg-surface-strong" />

      <ToolbarButton label="リンク" active={state.link} onClick={setLink}>
        <ToolbarIcon name="link" />
      </ToolbarButton>
      <ToolbarButton label="元に戻す" onClick={() => editor.chain().focus().undo().run()}>
        <ToolbarIcon name="undo" />
      </ToolbarButton>
      <ToolbarButton label="やり直す" onClick={() => editor.chain().focus().redo().run()}>
        <ToolbarIcon name="redo" />
      </ToolbarButton>
    </div>
  );
}
