import { db, type Queryable } from "./db";
import { mentionIdsFromDoc } from "./rich-text-validation";
import type { RichTextDoc, RichTextNode } from "./rich-text-types";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Resolve @mentions in a comment to project members (workspace admins included). */
export async function mentionedUserIds(
  projectId: number | null,
  text: string,
  q: Queryable = db,
): Promise<number[]> {
  const r = await q.query(
    `SELECT u.id, u.name FROM users u
     WHERE u.deactivated_at IS NULL
       AND ($1::bigint IS NULL
         OR EXISTS (SELECT 1 FROM users ux WHERE ux.id = u.id AND ux.is_admin)
         OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $1::bigint AND pm.user_id = u.id))`,
    [projectId],
  );
  const ids: number[] = [];
  for (const row of r.rows as { id: number; name: string }[]) {
    const re = new RegExp(
      `@${escapeRegExp(row.name)}(?=$|[\\s.,!?、。:：;；()（）\\[\\]【】])`,
    );
    if (re.test(text)) ids.push(row.id);
  }
  return ids;
}

/** Replace the stored mention list for a comment. */
export async function replaceCommentMentions(
  commentId: number,
  userIds: number[],
  q: Queryable = db,
): Promise<void> {
  await q.query("DELETE FROM comment_mentions WHERE comment_id = $1::bigint", [commentId]);
  if (userIds.length === 0) return;
  await q.query(
    `INSERT INTO comment_mentions (comment_id, user_id)
     SELECT $1::bigint, unnest($2::bigint[]) ON CONFLICT DO NOTHING`,
    [commentId, userIds],
  );
}


/** Resolve structured mention nodes against project membership. */
export async function mentionedUserIdsFromDoc(
  projectId: number | null,
  doc: RichTextDoc,
  q: Queryable = db,
): Promise<number[]> {
  const ids = mentionIdsFromDoc(doc);
  if (ids.length === 0) return [];
  const r = await q.query(
    `SELECT u.id FROM users u
     WHERE u.deactivated_at IS NULL
       AND u.id = ANY($2::bigint[])
       AND ($1::bigint IS NULL
         OR EXISTS (SELECT 1 FROM users ux WHERE ux.id = u.id AND ux.is_admin)
         OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $1::bigint AND pm.user_id = u.id))`,
    [projectId, ids],
  );
  return (r.rows as { id: number }[]).map((row) => Number(row.id));
}

/** Replace client-supplied mention labels with canonical project-member names. */
export async function normalizeMentionLabels(
  doc: RichTextDoc,
  projectId: number | null,
  q: Queryable = db,
): Promise<RichTextDoc> {
  const ids = mentionIdsFromDoc(doc);
  if (ids.length === 0) return doc;
  const r = await q.query(
    `SELECT u.id, u.name FROM users u
     WHERE u.deactivated_at IS NULL
       AND u.id = ANY($2::bigint[])
       AND ($1::bigint IS NULL
         OR EXISTS (SELECT 1 FROM users ux WHERE ux.id = u.id AND ux.is_admin)
         OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $1::bigint AND pm.user_id = u.id))`,
    [projectId, ids],
  );
  const names = new Map<number, string>();
  for (const row of r.rows as { id: number; name: string }[]) names.set(Number(row.id), row.name);

  const walk = (node: RichTextNode): RichTextNode => {
    if (node.type === "mention") {
      const id = Number(node.attrs?.id);
      const fallback = String(node.attrs?.label ?? node.attrs?.id ?? "");
      const name = names.get(id);
      return name
        ? { type: "mention", attrs: { id: String(id), label: name } }
        : { type: "text", text: `@${fallback}` };
    }
    if (!node.content) return node;
    return { ...node, content: node.content.map((child) => walk(child)) };
  };

  return {
    type: "doc",
    content: (doc.content ?? []).map((child) => walk(child)),
  };
}
