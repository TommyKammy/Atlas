"use client";

import type { MouseEvent, RefObject } from "react";

export function insertWrap(ref: RefObject<HTMLTextAreaElement | null>, before: string, after = "") {
  const el = ref.current;
  if (!el) return;
  const { selectionStart: s, selectionEnd: e, value } = el;
  const sel = value.slice(s, e) || "テキスト";
  el.value = value.slice(0, s) + before + sel + after + value.slice(e);
  el.focus();
  const pos = s + before.length + sel.length + after.length;
  el.setSelectionRange(pos, pos);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export default function MarkdownToolbar({
  target,
  onChange,
}: {
  target: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
}) {
  const wrap = (b: string, a = "") => {
    insertWrap(target, b, a);
    if (target.current) onChange(target.current.value);
  };
  const btn = "rounded px-1.5 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100";
  const keepFocus = (event: MouseEvent) => event.preventDefault();
  return (
    <span className="flex items-center gap-0.5">
      <span className="mr-1 flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-neutral-500">
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M3 4h10M3 8h7M3 12h10" />
        </svg>
        ノーマルテキスト
      </span>
      <button type="button" className={btn} title="太字" onMouseDown={keepFocus} onClick={() => wrap("**", "**")}>
        <strong>B</strong>
      </button>
      <button type="button" className={btn} title="斜体" onMouseDown={keepFocus} onClick={() => wrap("*", "*")}>
        <em>I</em>
      </button>
      <button type="button" className={btn} title="コード" onMouseDown={keepFocus} onClick={() => wrap("`", "`")}>
        {"<>"}
      </button>
      <button type="button" className={btn} title="箇条書き" onMouseDown={keepFocus} onClick={() => wrap("- ", "")}>
        •
      </button>
      <button
        type="button"
        className={btn}
        title="リンク"
        onMouseDown={keepFocus}
        onClick={() => {
          const url = prompt("URL (https://…):", "https://");
          if (url) wrap("[", `](${url})`);
        }}
      >
        🔗
      </button>
    </span>
  );
}
