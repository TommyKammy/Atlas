import { docToMarkdown, docToText } from "./rich-text-markdown";
import type { RichTextDoc } from "./rich-text-types";
import { validateRichTextDoc } from "./rich-text-validation";
import { normalizeMentionLabels, mentionedUserIds, mentionedUserIdsFromDoc } from "./mentions";

export type ParsedCommentPayload = {
  ok: true;
  text: string;
  markdown: string;
  doc: RichTextDoc | null;
  mentionIds: number[];
};

export type CommentPayloadError = { ok: false; error: string };

/** Validate either a rich-text doc or a legacy plain/markdown comment body. */
export async function parseCommentPayload(
  projectId: number | null,
  payload: unknown,
): Promise<ParsedCommentPayload | CommentPayloadError> {
  const body = (payload ?? null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return { ok: false, error: "body is required" };

  if (body.body_doc !== undefined && body.body_doc !== null) {
    const parsed = validateRichTextDoc(body.body_doc, {
      maxBytes: 64_000,
      maxChars: 10_000,
      maxNodes: 1_000,
      maxDepth: 15,
    });
    if (!parsed.ok) return { ok: false, error: `invalid body_doc: ${parsed.error}` };
    if (parsed.text.trim() === "") return { ok: false, error: "body is required" };
    const doc = await normalizeMentionLabels(parsed.doc, projectId);
    return {
      ok: true,
      text: docToText(doc),
      markdown: docToMarkdown(doc),
      doc,
      mentionIds: await mentionedUserIdsFromDoc(projectId, doc),
    };
  }

  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (text === "") return { ok: false, error: "body is required" };
  if (text.length > 10_000) return { ok: false, error: "body is too long" };
  const mentionIds = await mentionedUserIds(projectId, text);
  return { ok: true, text, markdown: text, doc: null, mentionIds };
}
