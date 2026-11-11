import { db, type Queryable } from "./db";
import { encodeInboxCursor, type InboxCursor, type InboxFilter } from "./inbox-pagination";

export type InboxItem = {
  entry: "comment" | "event"; id: number; body: string; created_at: string;
  author_name: string | null; author_id: number | null; task_id: number; task_name: string;
  project_id: number; project_name: string; is_read: boolean;
};
export type InboxPage = {
  items: InboxItem[]; total: number; unread: number; read: number; all: number; nextCursor: string | null;
};

// $1=user, $2=workspace (NULL only for a single-item read authorization).
// Both list, badge and read mutations use exactly this current visibility scope.
export const NOTIFICATION_FEED_SQL = `
  SELECT 'comment'::text AS entry,c.id,c.body,c.created_at,u.name AS author_name,c.author_id,
    t.id AS task_id,t.name AS task_name,p.project_id,p.project_name,(r.comment_id IS NOT NULL) AS is_read
  FROM comments c JOIN tasks t ON t.id=c.task_id AND t.deleted_at IS NULL
  JOIN users viewer ON viewer.id=$1 AND viewer.deactivated_at IS NULL
  JOIN LATERAL (
    SELECT home.* FROM atlas_notification_projects(t.id,'in_app') home
    WHERE ($2::bigint IS NULL OR home.workspace_id=$2) AND (viewer.is_admin OR EXISTS (
      SELECT 1 FROM project_members pm WHERE pm.project_id=home.project_id AND pm.user_id=$1
        AND pm.role IN ('admin','editor','commenter','viewer','member')
    )) ORDER BY (home.project_id=t.project_id) DESC NULLS LAST,home.project_id LIMIT 1
  ) p ON TRUE
  LEFT JOIN users u ON u.id=c.author_id
  LEFT JOIN inbox_reads r ON r.comment_id=c.id AND r.user_id=$1
  UNION ALL
  SELECT 'event'::text,e.id,e.summary,e.created_at,u.name,e.actor_id,
    t.id,t.name,p.project_id,p.project_name,(r.event_id IS NOT NULL)
  FROM task_events e JOIN tasks t ON t.id=e.task_id AND t.deleted_at IS NULL
  JOIN users viewer ON viewer.id=$1 AND viewer.deactivated_at IS NULL
  JOIN LATERAL (
    SELECT home.* FROM atlas_notification_projects(t.id,'in_app') home
    WHERE ($2::bigint IS NULL OR home.workspace_id=$2) AND (viewer.is_admin OR EXISTS (
      SELECT 1 FROM project_members pm WHERE pm.project_id=home.project_id AND pm.user_id=$1
        AND pm.role IN ('admin','editor','commenter','viewer','member')
    )) ORDER BY (home.project_id=t.project_id) DESC NULLS LAST,home.project_id LIMIT 1
  ) p ON TRUE
  LEFT JOIN users u ON u.id=e.actor_id
  LEFT JOIN inbox_reads r ON r.event_id=e.id AND r.user_id=$1
  WHERE e.kind NOT LIKE 'approval_%' OR EXISTS (
    SELECT 1 FROM task_event_recipients recipient WHERE recipient.event_id=e.id AND recipient.user_id=$1
  )`;

const unread = "NOT is_read AND (author_id IS NULL OR author_id<>$1)";

export async function getInboxPage(userId: number, workspaceId: number, options: {
  filter?: InboxFilter; cursor?: InboxCursor | null; limit?: number;
} = {}, q: Queryable = db): Promise<InboxPage> {
  const limit = Math.min(100, Math.max(1, Math.trunc(options.limit ?? 50)));
  const cursor = options.cursor;
  const result = await q.query(`WITH feed AS MATERIALIZED (${NOTIFICATION_FEED_SQL}),
    filtered AS (SELECT * FROM feed WHERE $3='all' OR
      ($3='unread' AND (${unread})) OR ($3='read' AND NOT (${unread}))),
    page AS (SELECT entry,id,body,
      to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
      author_name,author_id,task_id,task_name,project_id,project_name,is_read
      FROM filtered WHERE $4::timestamptz IS NULL OR (created_at,id,entry)<($4::timestamptz,$5::bigint,$6::text)
      ORDER BY created_at DESC,id DESC,entry DESC LIMIT $7)
    SELECT (SELECT count(*) FROM filtered) AS total,
      count(*) FILTER(WHERE ${unread}) AS unread,
      count(*) FILTER(WHERE NOT (${unread})) AS read,count(*) AS all,
      (SELECT coalesce(jsonb_agg(page ORDER BY created_at DESC,id DESC,entry DESC),'[]'::jsonb) FROM page) AS items
    FROM feed`, [userId, workspaceId, options.filter ?? "unread", cursor?.at ?? null, cursor?.id ?? null, cursor?.entry ?? null, limit + 1]);
  const row = result.rows[0];
  const items = (row.items as InboxItem[]).slice(0, limit);
  const last = items.at(-1);
  return { items, total: Number(row.total), unread: Number(row.unread), read: Number(row.read), all: Number(row.all),
    nextCursor: row.items.length > limit && last ? encodeInboxCursor({ at: last.created_at, id: Number(last.id), entry: last.entry }) : null };
}

/** Compatibility helper; new screens use explicit SQL-filtered cursor pages. */
export async function getInbox(userId: number, workspaceId: number): Promise<InboxItem[]> {
  return (await getInboxPage(userId, workspaceId, { filter: "all", limit: 100 })).items;
}

export async function getUnreadCount(userId: number, workspaceId: number): Promise<number> {
  const result = await db.query(`SELECT count(*)::int AS n FROM (${NOTIFICATION_FEED_SQL}) feed WHERE ${unread}`, [userId, workspaceId]);
  return Number(result.rows[0].n);
}

export async function markInboxRead(userId: number, target: { workspaceId?: number; commentId?: number; eventId?: number }) {
  const entry = target.commentId === undefined ? "event" : "comment";
  const id = target.commentId ?? target.eventId ?? null;
  const result = await db.query(`WITH feed AS MATERIALIZED (${NOTIFICATION_FEED_SQL}),
    selected AS (SELECT * FROM feed WHERE ($3::bigint IS NULL AND (${unread})) OR (entry=$4 AND id=$3)),
    comments AS (INSERT INTO inbox_reads(comment_id,user_id) SELECT id,$1 FROM selected WHERE entry='comment' ON CONFLICT DO NOTHING RETURNING 1),
    events AS (INSERT INTO inbox_reads(event_id,user_id) SELECT id,$1 FROM selected WHERE entry='event' ON CONFLICT DO NOTHING RETURNING 1)
    SELECT (SELECT count(*) FROM selected) AS visible,(SELECT count(*) FROM comments)+(SELECT count(*) FROM events) AS marked`,
  [userId, target.workspaceId ?? null, id, entry]);
  return { visible: Number(result.rows[0].visible), marked: Number(result.rows[0].marked) };
}
