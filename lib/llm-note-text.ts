import type { RichTextDoc, RichTextNode } from "./rich-text-types";

// URLs and image sources are never sent or fetched; link labels remain useful.
export function withoutUrls(text: string) {
  return text.replace(/!?\[([^\]]*)\]\([^\n)]*\)/g, "$1")
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, "")
    .replace(/<[^>]*>/g, "")
    .replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, "[URL省略]");
}
export function llmNoteText(note: { title: string; body: string; body_doc: RichTextDoc | null }) {
  function block(node: RichTextNode): string {
    if (node.type === "text") return node.text ?? "";
    if (node.type === "image") return "[画像省略]";
    if (node.type === "mention") return String(node.attrs?.label ?? "");
    if (node.type === "hardBreak") return "\n";
    const children = (node.content ?? []).map(block);
    if (node.type === "heading") return `${"#".repeat(Number(node.attrs?.level) || 1)} ${children.join("")}`;
    if (node.type === "paragraph") return children.join("");
    if (node.type === "tableRow") return children.join(" | ");
    if (node.type === "listItem" || node.type === "taskItem") return `- ${children.join("\n")}`;
    return children.join("\n");
  }
  return withoutUrls(`${note.title}\n\n${note.body_doc ? block(note.body_doc) : note.body}`).trim();
}
export function literalResultDoc(text: string): RichTextDoc {
  // Literal text: generated Markdown/HTML cannot introduce active images or links.
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}
