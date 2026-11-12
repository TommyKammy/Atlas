import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { richTextSchemaExtensions } from "./rich-text-extensions";
import { isKnowledgeImageUrl, knowledgeExtensions } from "./knowledge-extensions";
import { docToMarkdown, docToText } from "./rich-text-markdown";
import type { RichTextDoc, RichTextNode } from "./rich-text-types";
import { isSafeHref } from "./rich-text-url";

const schema = getSchema([...richTextSchemaExtensions(), ...knowledgeExtensions]);
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

export function validateKnowledgeDoc(value: unknown): RichTextDoc {
  if (new TextEncoder().encode(JSON.stringify(value)).length > 512_000) throw new Error("ノートは512KB以内にしてください");
  let count = 0;
  const clean = (value: unknown, depth: number): RichTextNode => {
    const raw = object(value), type = String(raw.type ?? ""), attrs = object(raw.attrs);
    if (++count > 6000 || depth > 24) throw new Error("ノートのブロック数または階層が上限を超えています");
    if (!schema.nodes[type] || (type === "doc" && depth !== 0)) throw new Error("未対応のブロックです");
    const node: RichTextNode = { type };
    if (type === "text") {
      if (typeof raw.text !== "string" || !raw.text) throw new Error("テキストの形式が無効です");
      node.text = raw.text;
    }
    if (Array.isArray(raw.content)) node.content = raw.content.map(child => clean(child, depth + 1));
    if (Array.isArray(raw.marks)) node.marks = raw.marks.flatMap(value => {
      const mark = object(value), type = String(mark.type ?? "");
      if (!schema.marks[type]) throw new Error("未対応の書式です");
      if (type === "link") {
        const href = object(mark.attrs).href;
        if (!isSafeHref(href) || (typeof href === "string" && (href.startsWith("//") || /[\\\u0000-\u001f]/.test(href)))) throw new Error("リンクURLが無効です");
        return [{ type, attrs: { href } }];
      }
      return [{ type }];
    });
    if (type === "heading") {
      if (![1, 2, 3].includes(Number(attrs.level))) throw new Error("見出しの形式が無効です");
      node.attrs = { level: Number(attrs.level) };
    }
    if (type === "orderedList") node.attrs = { start: Number.isSafeInteger(attrs.start) && Number(attrs.start) > 0 ? attrs.start : 1 };
    if (type === "taskItem") node.attrs = { checked: attrs.checked === true };
    if (type === "codeBlock") node.attrs = { language: typeof attrs.language === "string" && /^[\w-]{0,32}$/.test(attrs.language) ? attrs.language : null };
    if (type === "mention") {
      if (!/^\d+$/.test(String(attrs.id)) || typeof attrs.label !== "string" || attrs.label.length > 128) throw new Error("メンションが無効です");
      node.attrs = { id: String(attrs.id), label: attrs.label };
    }
    if (type === "image") {
      if (!isKnowledgeImageUrl(attrs.src)) throw new Error("画像にはHTTPSのURLを指定してください");
      node.attrs = { src: attrs.src, alt: typeof attrs.alt === "string" ? attrs.alt.slice(0, 500) : "", title: null };
    }
    if (type === "tableCell" || type === "tableHeader") {
      const colspan = attrs.colspan ?? 1, rowspan = attrs.rowspan ?? 1;
      if (![colspan, rowspan].every(n => Number.isInteger(n) && Number(n) >= 1 && Number(n) <= 50)) throw new Error("表のセル結合が上限を超えています");
      node.attrs = { colspan, rowspan, colwidth: null };
    }
    return node;
  };
  const doc = clean(value, 0) as RichTextDoc;
  if (doc.type !== "doc") throw new Error("ノートの形式が無効です");
  Node.fromJSON(schema, doc).check();
  if (docToText(doc).length > 100_000) throw new Error("ノートは10万文字以内にしてください");
  return doc;
}

/** Markdown is an export/search projection, never the rich document's source. */
export function knowledgeMarkdown(doc: RichTextDoc): string {
  const block = (node: RichTextNode): string => {
    if (node.type === "image") return `![${String(node.attrs?.alt ?? "").replace(/[\[\]\n]/g, " ")}](${String(node.attrs?.src ?? "")})`;
    if (node.type === "table") {
      const rows = (node.content ?? []).map(row => (row.content ?? []).map(cell => (cell.content ?? []).map(block).join(" ").replace(/\|/g, "\\|").replace(/\n/g, "<br>")));
      if (!rows.length) return "";
      return [rows[0], rows[0].map(() => "---"), ...rows.slice(1)].map(row => `| ${row.join(" | ")} |`).join("\n");
    }
    return docToMarkdown({ type: "doc", content: [node] });
  };
  return (doc.content ?? []).map(block).join("\n\n");
}
