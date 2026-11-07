import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { richTextSchemaExtensions } from "./rich-text-extensions";
import { docToText } from "./rich-text-markdown";
import type { MentionUser, RichTextDoc, RichTextMark, RichTextNode } from "./rich-text-types";
import { isSafeHref } from "./rich-text-url";

const schema = getSchema(richTextSchemaExtensions());

export type RichTextLimits = {
  maxBytes: number;
  maxChars: number;
  maxNodes: number;
  maxDepth: number;
};

const DEFAULT_LIMITS: RichTextLimits = {
  maxBytes: 256_000,
  maxChars: 50_000,
  maxNodes: 4_000,
  maxDepth: 20,
};

export type RichTextValidationResult =
  | { ok: true; doc: RichTextDoc; text: string }
  | { ok: false; error: string };

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sanitizeMark(value: unknown): RichTextMark | null {
  const raw = objectValue(value);
  if (!raw || typeof raw.type !== "string") return null;
  if (!schema.marks[raw.type]) return null;
  if (raw.type === "link") {
    const attrs = objectValue(raw.attrs);
    const href = attrs?.href;
    if (!isSafeHref(href)) return null;
    return { type: "link", attrs: { href } };
  }
  return { type: raw.type };
}

function sanitizeNode(
  value: unknown,
  depth: number,
  limits: RichTextLimits,
  state: { nodes: number; chars: number },
): RichTextNode | null {
  if (depth > limits.maxDepth) throw new Error("rich text is nested too deeply");
  const raw = objectValue(value);
  if (!raw || typeof raw.type !== "string") throw new Error("invalid rich text node");
  if (!schema.nodes[raw.type]) throw new Error(`unsupported rich text node: ${raw.type}`);
  if (raw.type === "doc") throw new Error("nested document nodes are not allowed");

  state.nodes += 1;
  if (state.nodes > limits.maxNodes) throw new Error("rich text has too many nodes");

  const marks = Array.isArray(raw.marks)
    ? raw.marks.map(sanitizeMark).filter((mark): mark is RichTextMark => mark !== null)
    : undefined;

  if (raw.type === "text") {
    if (typeof raw.text !== "string") throw new Error("invalid rich text text node");
    state.chars += raw.text.length;
    if (state.chars > limits.maxChars) throw new Error("rich text is too long");
    return marks && marks.length > 0
      ? { type: "text", text: raw.text, marks }
      : { type: "text", text: raw.text };
  }

  if (raw.type === "mention") {
    const attrs = objectValue(raw.attrs);
    const id = attrs?.id;
    const label = attrs?.label;
    const idText = typeof id === "number" ? String(id) : typeof id === "string" ? id : "";
    if (!/^\d+$/.test(idText)) throw new Error("invalid mention user");
    if (typeof label !== "string" || label.trim() === "" || label.length > 128) {
      throw new Error("invalid mention label");
    }
    state.chars += label.length;
    if (state.chars > limits.maxChars) throw new Error("rich text is too long");
    return { type: "mention", attrs: { id: idText, label: label.trim() } };
  }

  const content = Array.isArray(raw.content)
    ? raw.content
        .map((child) => sanitizeNode(child, depth + 1, limits, state))
        .filter((child): child is RichTextNode => child !== null)
    : undefined;

  if (raw.type === "heading") {
    const level = Number(objectValue(raw.attrs)?.level);
    if (![1, 2, 3].includes(level)) throw new Error("invalid heading level");
    return { type: "heading", attrs: { level }, content };
  }
  if (raw.type === "codeBlock") {
    const language = objectValue(raw.attrs)?.language;
    return {
      type: "codeBlock",
      attrs: { language: typeof language === "string" && /^[A-Za-z0-9_-]{0,32}$/.test(language) ? language : null },
      content,
    };
  }
  if (raw.type === "taskItem") {
    return { type: "taskItem", attrs: { checked: objectValue(raw.attrs)?.checked === true }, content };
  }
  return content && content.length > 0 ? { type: raw.type, content } : { type: raw.type };
}

/**
 * Validate untrusted ProseMirror JSON against the same schema the editor uses.
 * The returned document contains only allowlisted nodes, marks and attrs.
 */
export function validateRichTextDoc(
  value: unknown,
  options: Partial<RichTextLimits> = {},
): RichTextValidationResult {
  const limits = { ...DEFAULT_LIMITS, ...options };
  const raw = objectValue(value);
  if (!raw || raw.type !== "doc") return { ok: false, error: "rich text document is required" };

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { ok: false, error: "invalid rich text document" };
  }
  if (Buffer.byteLength(serialized, "utf8") > limits.maxBytes) {
    return { ok: false, error: "rich text document is too large" };
  }

  let node: Node;
  try {
    node = Node.fromJSON(schema, value);
  } catch {
    return { ok: false, error: "invalid rich text document" };
  }
  if (node.type.name !== "doc") return { ok: false, error: "rich text document is required" };

  try {
    const state = { nodes: 0, chars: 0 };
    const content = (Array.isArray(raw.content) ? raw.content : [])
      .map((child) => sanitizeNode(child, 1, limits, state))
      .filter((child): child is RichTextNode => child !== null);
    const doc: RichTextDoc = { type: "doc", content };
    const text = docToText(doc);
    if (text.length > limits.maxChars) {
      return { ok: false, error: "rich text is too long" };
    }
    return { ok: true, doc, text };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "invalid rich text document" };
  }
}

/** Extract structured mention IDs from an already validated document. */
export function mentionIdsFromDoc(doc: RichTextDoc): number[] {
  const ids = new Set<number>();
  const walk = (node: RichTextNode) => {
    if (node.type === "mention") {
      const id = Number(node.attrs?.id);
      if (Number.isInteger(id) && id > 0) ids.add(id);
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return [...ids];
}

/** Convenience for tests and diagnostics. */
export function richTextMentionUsers(doc: RichTextDoc): MentionUser[] {
  const users: MentionUser[] = [];
  const walk = (node: RichTextNode) => {
    if (node.type === "mention") {
      const id = Number(node.attrs?.id);
      const name = node.attrs?.label;
      if (Number.isInteger(id) && typeof name === "string") users.push({ id, name });
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return users;
}
