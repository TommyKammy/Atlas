import { NextResponse } from "next/server";
import { withTask } from "@/lib/api/route";
import { validateRichTextDoc } from "@/lib/rich-text-validation";
import type { RichTextDoc } from "@/lib/rich-text-types";
import {
  deleteCommentDraft,
  getCommentDraft,
  saveCommentDraft,
} from "@/lib/repositories/home";

export const GET = withTask("comment", async (_req, { uid, taskId }) => {
  return NextResponse.json({ draft: await getCommentDraft(uid, taskId) });
});

export const PUT = withTask(
  "comment",
  async (_req, { uid, taskId, body }) => {
    const payload = (body ?? {}) as { body?: unknown; body_doc?: unknown };
    const text = typeof payload.body === "string" ? payload.body : "";
    if (text.length > 10_000) {
      return NextResponse.json({ error: "body is too long" }, { status: 400 });
    }
    if (text.trim() === "") {
      await deleteCommentDraft(uid, taskId);
      return NextResponse.json({ draft: null });
    }
    let doc: RichTextDoc | null = null;
    if (payload.body_doc !== undefined && payload.body_doc !== null) {
      const parsed = validateRichTextDoc(payload.body_doc, {
        maxBytes: 64_000,
        maxChars: 10_000,
        maxNodes: 1_000,
        maxDepth: 15,
      });
      if (!parsed.ok) {
        return NextResponse.json({ error: `invalid body_doc: ${parsed.error}` }, { status: 400 });
      }
      doc = parsed.doc;
    }
    await saveCommentDraft(uid, taskId, text, doc);
    return NextResponse.json({ draft: await getCommentDraft(uid, taskId) });
  },
  { body: true },
);

export const DELETE = withTask("comment", async (_req, { uid, taskId }) => {
  await deleteCommentDraft(uid, taskId);
  return NextResponse.json({ draft: null });
});
