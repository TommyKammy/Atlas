"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import type { FocusEvent, ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { docToText, markdownToDoc } from "@/lib/rich-text-markdown";
import { richTextExtensions } from "@/lib/rich-text-extensions";
import type { MentionUser, RichTextDoc } from "@/lib/rich-text-types";
import RichTextToolbar from "./RichTextToolbar";

/**
 * Client-only Tiptap editor. ProseMirror JSON is the only output format; no
 * HTML is accepted from or emitted to the server.
 */
export default function RichTextEditor({
  initialDoc,
  legacy,
  mentionUsers = [],
  placeholder = "",
  ariaLabel,
  dataAttributes,
  autoFocus = false,
  compact = false,
  minHeightClass = "min-h-[120px]",
  toolbar = true,
  borderless = false,
  onChange,
  onSubmit,
  onReady,
  className = "",
  children,
}: {
  initialDoc?: RichTextDoc | null;
  legacy?: string;
  mentionUsers?: MentionUser[];
  placeholder?: string;
  ariaLabel: string;
  dataAttributes?: Record<string, string>;
  autoFocus?: boolean;
  compact?: boolean;
  minHeightClass?: string;
  toolbar?: boolean;
  borderless?: boolean;
  onChange?: (doc: RichTextDoc, text: string) => void;
  onSubmit?: () => void | Promise<void>;
  onReady?: (editor: Editor) => void;
  className?: string;
  children?: ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  const [hasContent, setHasContent] = useState(() => {
    const initial = initialDoc ?? markdownToDoc(legacy ?? "", mentionUsers);
    return docToText(initial).length > 0;
  });
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSubmitRef.current = onSubmit;
  }, [onChange, onSubmit]);

  const mentionKey = mentionUsers.map((user) => `${user.id}:${user.name}`).join("|");
  const extensions = useMemo(
    () => richTextExtensions({ placeholder, mentionUsers }),
    // User names and placeholder are stable while an editor is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placeholder, mentionKey],
  );
  const initialContent = useMemo(
    () => initialDoc ?? markdownToDoc(legacy ?? "", mentionUsers),
    // Initial content is intentionally captured when the editor mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const editor = useEditor(
    {
      extensions,
      content: initialContent,
      immediatelyRender: false,
      autofocus: autoFocus ? "end" : false,
      editorProps: {
        attributes: {
          class: `atlas-rich-text atlas-rich-editor-content ${minHeightClass} px-3 py-2 outline-none`,
          role: "textbox",
          "aria-label": ariaLabel,
          "aria-multiline": "true",
          spellcheck: "true",
          ...dataAttributes,
        },
        handleKeyDown: (_view, event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void onSubmitRef.current?.();
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor: current }) => {
        const doc = current.getJSON() as RichTextDoc;
        const text = docToText(doc);
        setHasContent(text.length > 0);
        onChangeRef.current?.(doc, text);
      },
      onCreate: ({ editor: current }) => {
        const text = docToText(current.getJSON() as RichTextDoc);
        setHasContent(text.length > 0);
      },
    },
    [extensions],
  );

  const onBlurCapture = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
  };

  useEffect(() => {
    if (editor) onReady?.(editor);
  }, [editor, onReady]);

  if (!editor) {
    return (
      <div className={`rounded-lg border border-neutral-300 bg-white ${className}`}>
        <div className={`${minHeightClass} animate-pulse bg-neutral-50`} />
      </div>
    );
  }

  return (
    <div
      className={`atlas-rich-editor rounded-lg bg-white transition-shadow ${
        borderless
          ? "border-0"
          : focused
            ? "border border-[#4075cf] shadow-[0_0_0_2px_rgba(64,117,207,0.12)]"
            : "border border-neutral-300"
      } ${className}`}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={onBlurCapture}
    >
      {toolbar && (focused || hasContent) && (
        <RichTextToolbar editor={editor} compact={compact} ariaLabel={`${ariaLabel}の書式`} />
      )}
      <EditorContent editor={editor} />
      {children}
    </div>
  );
}
