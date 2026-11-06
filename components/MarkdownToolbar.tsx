"use client";

import type { RefObject } from "react";

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
  const btn = "rounded border px-1.5 py-0.5 text-xs hover:bg-neutral-100";
  return (
    <span className="flex gap-1">
      <button type="button" className={btn} title="太字" onClick={() => wrap("**", "**")}>
        B
      </button>
      <button type="button" className={btn} title="斜体" onClick={() => wrap("*", "*")}>
        I
      </button>
      <button type="button" className={btn} title="コード" onClick={() => wrap("`", "`")}>
        {"<>"}
      </button>
      <button type="button" className={btn} title="箇条書き" onClick={() => wrap("- ", "")}>
        •
      </button>
      <button
        type="button"
        className={btn}
        title="リンク"
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
