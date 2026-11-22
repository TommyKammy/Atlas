import { db } from "../db";
import type { CommentRow } from "../data";

export async function getComments(taskId: number): Promise<CommentRow[]> {
  const r = await db.query(
    `SELECT c.id, c.author_id, u.name AS author_name, c.body, c.body_doc, c.created_at::text,
       c.edited_at::text AS edited_at
     FROM comments c LEFT JOIN users u ON u.id = c.author_id
     WHERE c.task_id = $1 ORDER BY c.id`,
    [taskId],
  );
  return r.rows;
}

/** Ordered comment page. Callers must authorize the task before reading. */
export async function getCommentsPage(
  taskId: number,
  limit: number,
  offset: number,
): Promise<CommentRow[]> {
  const r = await db.query(
    `SELECT c.id, c.author_id, u.name AS author_name, c.body, c.body_doc, c.created_at::text,
       c.edited_at::text AS edited_at
     FROM comments c LEFT JOIN users u ON u.id = c.author_id
     WHERE c.task_id = $1 ORDER BY c.id LIMIT $2 OFFSET $3`,
    [taskId, limit, offset],
  );
  return r.rows;
}

export type CommentReactions = Record<number, { emoji: string; n: number; mine: boolean }[]>;

export async function getCommentReactions(
  taskId: number,
  userId: number | null,
): Promise<CommentReactions> {
  const r = await db.query(
    `SELECT r.comment_id, r.emoji, COUNT(*)::int AS n,
       BOOL_OR(r.user_id = $2) AS mine
     FROM comment_reactions r JOIN comments c ON c.id = r.comment_id
     WHERE c.task_id = $1 GROUP BY r.comment_id, r.emoji ORDER BY n DESC, r.emoji`,
    [taskId, userId],
  );
  const out: CommentReactions = {};
  for (const row of r.rows) {
    if (!out[row.comment_id]) out[row.comment_id] = [];
    out[row.comment_id].push({ emoji: row.emoji, n: row.n, mine: row.mine });
  }
  return out;
}
