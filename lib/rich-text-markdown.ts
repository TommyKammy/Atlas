import type { MentionUser, RichTextDoc, RichTextMark, RichTextNode } from "./rich-text-types";
import { isSafeHref } from "./rich-text-url";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inlineText(text: string, marks: RichTextMark[] | undefined): RichTextNode {
  return marks && marks.length > 0 ? { type: "text", text, marks } : { type: "text", text };
}

function pushTextWithMentions(
  nodes: RichTextNode[],
  text: string,
  marks: RichTextMark[] | undefined,
  mentionUsers: MentionUser[],
) {
  if (text === "") return;
  const names = mentionUsers
    .map((user) => ({ user, name: user.name }))
    .filter((entry) => entry.name.trim() !== "")
    .sort((a, b) => b.name.length - a.name.length);
  if (names.length === 0) {
    nodes.push(inlineText(text, marks));
    return;
  }
  const pattern = new RegExp(`@(${names.map((entry) => escapeRegExp(entry.name)).join("|")})`, "g");
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(inlineText(text.slice(last, match.index), marks));
    const user = names.find((entry) => entry.name === match?.[1])?.user;
    if (user) {
      nodes.push({
        type: "mention",
        attrs: { id: String(user.id), label: user.name },
      });
    } else {
      nodes.push(inlineText(match[0], marks));
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(inlineText(text.slice(last), marks));
}

function parseInline(text: string, mentionUsers: MentionUser[], marks?: RichTextMark[]): RichTextNode[] {
  const nodes: RichTextNode[] = [];
  let rest = text;
  const tokenPattern =
    /(\*\*[^*]+\*\*|~~[^~]+~~|`[^`\n]+`|\*[^*\n]+\*|\[[^\]\n]+\]\((?:https?:\/\/|mailto:|\/|#)[^\s)]+\))/;
  while (rest.length > 0) {
    const match = tokenPattern.exec(rest);
    if (!match) {
      pushTextWithMentions(nodes, rest, marks, mentionUsers);
      break;
    }
    if (match.index > 0) {
      pushTextWithMentions(nodes, rest.slice(0, match.index), marks, mentionUsers);
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(...parseInline(token.slice(2, -2), mentionUsers, [...(marks ?? []), { type: "bold" }]));
    } else if (token.startsWith("~~") && token.endsWith("~~")) {
      nodes.push(...parseInline(token.slice(2, -2), mentionUsers, [...(marks ?? []), { type: "strike" }]));
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(...parseInline(token.slice(1, -1), mentionUsers, [...(marks ?? []), { type: "code" }]));
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(...parseInline(token.slice(1, -1), mentionUsers, [...(marks ?? []), { type: "italic" }]));
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/);
      if (link && isSafeHref(link[2])) {
        const href = link[2];
        nodes.push(
          ...parseInline(link[1], mentionUsers, [
            ...(marks ?? []),
            { type: "link", attrs: { href } },
          ]),
        );
      } else {
        pushTextWithMentions(nodes, token, marks, mentionUsers);
      }
    }
    rest = rest.slice(match.index + token.length);
  }
  return nodes;
}

function paragraph(content: RichTextNode[]): RichTextNode {
  return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };
}

function listItem(content: RichTextNode[]): RichTextNode {
  return { type: "listItem", content: [paragraph(content)] };
}

/** Convert the app's legacy Markdown subset into a ProseMirror doc. */
export function markdownToDoc(markdown: string, mentionUsers: MentionUser[] = []): RichTextDoc {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const content: RichTextNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([A-Za-z0-9_-]*)\s*$/);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      content.push({
        type: "codeBlock",
        attrs: { language: fence[1] || null },
        content: code.length > 0 ? [{ type: "text", text: code.join("\n") }] : undefined,
      });
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      content.push({
        type: "heading",
        attrs: { level: heading[1].length },
        content: parseInline(heading[2], mentionUsers),
      });
      index += 1;
      continue;
    }

    if (/^---+\s*$/.test(line)) {
      content.push({ type: "horizontalRule" });
      index += 1;
      continue;
    }

    const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (task) {
      const items: RichTextNode[] = [];
      while (index < lines.length) {
        const next = lines[index].match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
        if (!next) break;
        items.push({
          type: "taskItem",
          attrs: { checked: next[1].toLowerCase() === "x" },
          content: [paragraph(parseInline(next[2], mentionUsers))],
        });
        index += 1;
      }
      content.push({ type: "taskList", content: items });
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      const items: RichTextNode[] = [];
      while (index < lines.length) {
        const next = lines[index].match(/^\s*[-*]\s+(.+)$/);
        if (!next || /^\s*[-*]\s+\[[ xX]\]\s+/.test(lines[index])) break;
        items.push(listItem(parseInline(next[1], mentionUsers)));
        index += 1;
      }
      content.push({ type: "bulletList", content: items });
      continue;
    }

    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ordered) {
      const items: RichTextNode[] = [];
      while (index < lines.length) {
        const next = lines[index].match(/^\s*\d+\.\s+(.+)$/);
        if (!next) break;
        items.push(listItem(parseInline(next[1], mentionUsers)));
        index += 1;
      }
      content.push({ type: "orderedList", content: items });
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      content.push({
        type: "blockquote",
        content: quoteLines.map((quoteLine) => paragraph(parseInline(quoteLine, mentionUsers))),
      });
      continue;
    }

    content.push(paragraph(parseInline(line, mentionUsers)));
    index += 1;
  }

  return content.length > 0 ? { type: "doc", content } : { type: "doc", content: [{ type: "paragraph" }] };
}

function inlineMarkdown(node: RichTextNode): string {
  if (node.type === "mention") return `@${String(node.attrs?.label ?? node.attrs?.id ?? "")}`;
  if (node.type === "hardBreak") return "  \n";
  if (node.type !== "text" || typeof node.text !== "string") return "";
  let text = node.text;
  const marks = node.marks ?? [];
  for (const mark of marks) {
    if (mark.type === "code") text = `\`${text}\``;
  }
  for (const mark of marks) {
    if (mark.type === "bold") text = `**${text}**`;
    if (mark.type === "italic") text = `*${text}*`;
    if (mark.type === "strike") text = `~~${text}~~`;
    if (mark.type === "link") {
      const href = mark.attrs?.href;
      if (isSafeHref(href)) text = `[${text}](${href})`;
    }
  }
  return text;
}

function blockMarkdown(node: RichTextNode, depth = 0): string {
  const children = () => (node.content ?? []).map((child) => blockMarkdown(child, depth + 1)).join("");
  const inline = () => (node.content ?? []).map(inlineMarkdown).join("");
  switch (node.type) {
    case "doc":
      return children();
    case "paragraph":
      return `${inline()}\n\n`;
    case "heading": {
      const level = Math.max(1, Math.min(3, Number(node.attrs?.level) || 1));
      return `${"#".repeat(level)} ${inline()}\n\n`;
    }
    case "bulletList":
      return `${(node.content ?? [])
        .map((item) => `- ${(item.content ?? []).map((child) => blockMarkdown(child, depth + 1).trim()).join(" ")}`)
        .join("\n")}\n\n`;
    case "orderedList":
      return `${(node.content ?? [])
        .map(
          (item, index) =>
            `${index + 1}. ${(item.content ?? []).map((child) => blockMarkdown(child, depth + 1).trim()).join(" ")}`,
        )
        .join("\n")}\n\n`;
    case "taskList":
      return `${(node.content ?? [])
        .map((item) => {
          const checked = item.attrs?.checked === true;
          const body = (item.content ?? []).map((child) => blockMarkdown(child, depth + 1).trim()).join(" ");
          return `- [${checked ? "x" : " "}] ${body}`;
        })
        .join("\n")}\n\n`;
    case "blockquote":
      return `${(node.content ?? [])
        .map((child) => blockMarkdown(child, depth + 1).trim())
        .join("\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n\n`;
    case "codeBlock": {
      const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      return `\`\`\`${language}\n${inline()}\n\`\`\`\n\n`;
    }
    case "horizontalRule":
      return "---\n\n";
    case "bulletList.item":
      return inline();
    default:
      return node.content ? children() : inline();
  }
}

/** Serialize a doc to the legacy Markdown column for search/export fallback. */
export function docToMarkdown(doc: RichTextDoc): string {
  return blockMarkdown(doc).replace(/\n{3,}/g, "\n\n").trim();
}

export function docToText(doc: RichTextDoc): string {
  const parts: string[] = [];
  const walk = (node: RichTextNode) => {
    if (node.type === "mention") {
      parts.push(`@${String(node.attrs?.label ?? node.attrs?.id ?? "")}`);
      return;
    }
    if (node.type === "text") {
      parts.push(node.text ?? "");
      return;
    }
    if (node.type === "hardBreak") {
      parts.push("\n");
      return;
    }
    for (const child of node.content ?? []) walk(child);
    if (
      node.type === "paragraph" ||
      node.type === "heading" ||
      node.type === "listItem" ||
      node.type === "taskItem" ||
      node.type === "blockquote" ||
      node.type === "codeBlock"
    ) {
      parts.push("\n");
    }
  };
  walk(doc);
  return parts.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function docTextLength(doc: RichTextDoc): number {
  return docToText(doc).length;
}
