import { db } from "./db";
import { notificationMailConfig } from "./notification-mail.mjs";

export async function getNotificationDeliveryStatus(projectId: number) {
  const config = notificationMailConfig();
  const result = await db.query(`SELECT
    EXISTS(SELECT 1 FROM notification_worker_heartbeats WHERE state='running' AND last_seen_at>clock_timestamp()-interval '15 seconds') AS worker_running,
    (SELECT coalesce(jsonb_object_agg(status,n),'{}'::jsonb) FROM (
      SELECT status,count(*)::int AS n FROM notification_email_deliveries WHERE project_id=$1 GROUP BY status) counts) AS counts,
    (SELECT count(*)::int FROM notification_email_sources s WHERE status='pending'
      AND EXISTS(SELECT 1 FROM atlas_notification_projects(s.task_id,'email') p WHERE p.project_id=$1)) AS source_pending,
    (SELECT count(*)::int FROM notification_email_sources s WHERE status='failed'
      AND EXISTS(SELECT 1 FROM atlas_notification_projects(s.task_id,'email') p WHERE p.project_id=$1)) AS source_failed` , [projectId]);
  return { smtp_configured: config.configured, smtp_reason: config.reason,
    worker_running: result.rows[0].worker_running === true,
    counts: result.rows[0].counts as Record<string, number>, source_pending: Number(result.rows[0].source_pending), source_failed: Number(result.rows[0].source_failed) };
}

export type NotificationDeliveryStatus = Awaited<ReturnType<typeof getNotificationDeliveryStatus>>;
