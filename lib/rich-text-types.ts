export type RichTextMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type RichTextNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextNode[];
  marks?: RichTextMark[];
  text?: string;
};

export type RichTextDoc = {
  type: "doc";
  content?: RichTextNode[];
};

export type MentionUser = {
  id: number;
  name: string;
  avatar_url?: string | null;
};

export function emptyRichTextDoc(): RichTextDoc {
  return {
    type: "doc",
    content: [{ type: "paragraph" }],
  };
}

export function isRichTextDoc(value: unknown): value is RichTextDoc {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "doc" &&
    Array.isArray((value as { content?: unknown }).content ?? [])
  );
}
