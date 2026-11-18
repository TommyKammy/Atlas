"use client";

import { useState } from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { isKnowledgeImageUrl, moveKnowledgeBlock } from "@/lib/knowledge-extensions";
import ToolbarButton from "../rich-text/ToolbarButton";

export default function KnowledgeTools({ editor, links }: { editor: Editor; links: { title: string; href: string }[] }) {
  const [imageForm, setImageForm] = useState(false);
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [error, setError] = useState("");
  const state = useEditorState({ editor, selector: ({ editor: e }) => ({
    table: e.isActive("table"), up: moveKnowledgeBlock(e, -1, false), down: moveKnowledgeBlock(e, 1, false),
  }) });
  return <div className="border-b border-line py-1">
    <div role="toolbar" aria-label="ノートのブロック操作" className="flex flex-wrap items-center gap-1">
      <ToolbarButton label="ブロックを上へ (Alt+↑)" disabled={!state?.up} onClick={() => moveKnowledgeBlock(editor, -1)}>↑</ToolbarButton>
      <ToolbarButton label="ブロックを下へ (Alt+↓)" disabled={!state?.down} onClick={() => moveKnowledgeBlock(editor, 1)}>↓</ToolbarButton>
      <ToolbarButton label="表を挿入" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>表を挿入</ToolbarButton>
      <ToolbarButton label="画像を挿入" onClick={() => setImageForm(!imageForm)}>画像</ToolbarButton>
      <select aria-label="ノートへのリンクを挿入" value="" onChange={event => {
        const item = links.find(link => link.href === event.target.value);
        if (item) editor.chain().focus().insertContent({ type: "text", text: item.title, marks: [{ type: "link", attrs: { href: item.href } }] }).run();
      }} className="h-8 max-w-48 rounded px-2 text-xs text-neutral-700 hover:bg-hover">
        <option value="">ノートへのリンク</option>
        {links.map(link => <option key={link.href} value={link.href}>{link.title}</option>)}
      </select>
      {state?.table && <>
        <ToolbarButton label="表の行を追加" onClick={() => editor.chain().focus().addRowAfter().run()}>＋ 行</ToolbarButton>
        <ToolbarButton label="表の列を追加" onClick={() => editor.chain().focus().addColumnAfter().run()}>＋ 列</ToolbarButton>
        <ToolbarButton label="表の行を削除" onClick={() => editor.chain().focus().deleteRow().run()}>− 行</ToolbarButton>
        <ToolbarButton label="表の列を削除" onClick={() => editor.chain().focus().deleteColumn().run()}>− 列</ToolbarButton>
        <ToolbarButton label="表を削除" onClick={() => editor.chain().focus().deleteTable().run()}>表を削除</ToolbarButton>
      </>}
    </div>
    {imageForm && <form className="my-2 flex flex-wrap items-end gap-2 rounded-md bg-surface-subtle p-3" onSubmit={event => {
      event.preventDefault();
      if (!isKnowledgeImageUrl(url)) { setError("HTTPSの画像URLを入力してください"); return; }
      editor.chain().focus().setImage({ src: url, alt }).run();
      setImageForm(false); setUrl(""); setAlt(""); setError("");
    }}>
      <label className="min-w-0 flex-1 text-xs">画像URL<input autoFocus aria-label="画像URL" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" className="mt-1 w-full rounded border border-line-strong bg-white p-2 placeholder:text-neutral-600" /></label>
      <label className="min-w-0 flex-1 text-xs">画像の説明<input aria-label="画像の説明" value={alt} onChange={e => setAlt(e.target.value)} className="mt-1 w-full rounded border border-line-strong bg-white p-2" /></label>
      <button className="rounded bg-accent px-3 py-2 text-xs text-on-accent">画像を挿入</button>
      <button type="button" className="p-2 text-xs" onClick={() => setImageForm(false)}>キャンセル</button>
      <p className="w-full text-xs text-secondary">閲覧時に外部サイトから画像を読み込みます。</p>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </form>}
  </div>;
}
