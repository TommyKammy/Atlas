import { db } from "./db";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Resolve @mentions in a comment to project members (workspace admins included). */
export async function mentionedUserIds(
  projectId: number | null,
  text: string,
): Promise<number[]> {
  const r = await db.query(
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
): Promise<void> {
  await db.query("DELETE FROM comment_mentions WHERE comment_id = $1::bigint", [commentId]);
  if (userIds.length === 0) return;
  await db.query(
    `INSERT INTO comment_mentions (comment_id, user_id)
     SELECT $1::bigint, unnest($2::bigint[]) ON CONFLICT DO NOTHING`,
    [commentId, userIds],
  );
}
