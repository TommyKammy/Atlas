import assert from "node:assert/strict";
import test from "node:test";
import { knowledgeMarkdown, validateKnowledgeDoc } from "./knowledge-document";
import type { RichTextNode } from "./rich-text-types";

test("knowledge documents retain tables, checklists and safe images while removing arbitrary attributes", () => {
  const doc = validateKnowledgeDoc({ type: "doc", content: [
    { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "担当" }] }] }] }] },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true, onclick: "evil" }, content: [{ type: "paragraph", content: [{ type: "text", text: "完了" }] }] }] },
    { type: "image", attrs: { src: "https://example.com/image.png", alt: "図", onerror: "evil" } },
  ] });
  assert.equal(JSON.stringify(doc).includes("evil"), false);
  const markdown = knowledgeMarkdown(doc);
  assert.match(markdown, /\| 担当 \|/); assert.match(markdown, /- \[x\] 完了/); assert.match(markdown, /!\[図\]\(https:/);
});

test("knowledge validation rejects malformed structure, active URLs and nested documents", () => {
  for (const node of [
    { type: "doc", content: [{ type: "paragraph" }] },
    { type: "tableCell", content: [{ type: "paragraph" }] },
    { type: "image", attrs: { src: "data:image/svg+xml;base64,test" } },
    { type: "image", attrs: { src: "https://user:password@example.com/a.png" } },
    { type: "paragraph", content: [{ type: "text", text: "link", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
  ]) assert.throws(() => validateKnowledgeDoc({ type: "doc", content: [node] }));
});

test("knowledge document limits constrain bytes, text and nesting", () => {
  const textDoc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
  assert.throws(() => validateKnowledgeDoc(textDoc("あ".repeat(200_000))), /512KB/);
  assert.throws(() => validateKnowledgeDoc(textDoc("a".repeat(100_001))), /10万文字/);
  let node: RichTextNode = { type: "paragraph" };
  for (let i = 0; i < 30; i++) node = { type: "blockquote", content: [node] };
  assert.throws(() => validateKnowledgeDoc({ type: "doc", content: [node] }), /階層/);
});
