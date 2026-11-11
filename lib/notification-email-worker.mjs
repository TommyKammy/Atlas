import { randomUUID } from "node:crypto";
import { notificationMailConfig, notificationMessageId, sendNotificationMail } from "./notification-mail.mjs";

const ROLE_ACCESS = `u.is_admin OR EXISTS (SELECT 1 FROM project_members pm
  WHERE pm.project_id=home.project_id AND pm.user_id=u.id
    AND pm.role IN ('admin','editor','commenter','viewer','member'))`;
const SOURCE_JOIN = `FROM notification_email_sources s
  JOIN tasks t ON t.id=s.task_id AND t.deleted_at IS NULL
  LEFT JOIN comments c ON c.id=s.comment_id
  LEFT JOIN task_events e ON e.id=s.event_id`;
const RECIPIENT_GATE = `(s.comment_id IS NOT NULL OR e.kind NOT LIKE 'approval_%' OR EXISTS (
  SELECT 1 FROM task_event_recipients recipient WHERE recipient.event_id=e.id AND recipient.user_id=u.id))`;

async function expandSource(pool, sourceIds) {
  const client = await pool.connect();
  let sourceId = null;
  try {
    await client.query("BEGIN");
    // Match automation workers: project deletion takes this gate exclusively
    // before project/task/source row locks. Always acquire it before source locks.
    await client.query("SELECT pg_advisory_xact_lock_shared(1096043603, 2)");
    const claim = await client.query(`SELECT id FROM notification_email_sources WHERE status='pending'
      AND ($1::bigint[] IS NULL OR id=ANY($1)) ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`, [sourceIds]);
    if (!claim.rows.length) { await client.query("COMMIT"); return false; }
    sourceId = claim.rows[0].id;
    const recipients = await client.query(`SELECT u.id AS user_id,p.project_id
      ${SOURCE_JOIN}
      JOIN users u ON u.deactivated_at IS NULL AND u.email IS NOT NULL AND btrim(u.email)<>''
        AND u.id IS DISTINCT FROM COALESCE(c.author_id,e.actor_id)
      JOIN LATERAL (SELECT home.project_id FROM atlas_notification_projects(t.id,'email') home
        WHERE (${ROLE_ACCESS}) ORDER BY (home.project_id=t.project_id) DESC NULLS LAST,home.project_id LIMIT 1) p ON TRUE
      WHERE s.id=$1 AND ${RECIPIENT_GATE}`, [sourceId]);
    if (recipients.rows.length) {
      await client.query(`INSERT INTO notification_email_deliveries(source_id,user_id,project_id,message_id)
        SELECT $1::bigint,input.user_id,input.project_id,'<atlas-notification-'||($1::bigint)::text||'-'||input.user_id::text||'@atlas.local>'
        FROM unnest($2::bigint[],$3::bigint[]) input(user_id,project_id) ON CONFLICT DO NOTHING`,
      [sourceId, recipients.rows.map((r) => r.user_id), recipients.rows.map((r) => r.project_id)]);
    }
    await client.query("UPDATE notification_email_sources SET status='expanded',last_error=NULL WHERE id=$1", [sourceId]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (sourceId !== null) await pool.query(`UPDATE notification_email_sources
      SET attempts=attempts+1,status=CASE WHEN attempts+1>=3 THEN 'failed' ELSE 'pending' END,
        last_error='SOURCE_EXPANSION_FAILED' WHERE id=$1 AND status='pending'`, [sourceId]);
    throw error;
  } finally { client.release(); }
}

async function claimDelivery(pool, sourceIds) {
  const token = randomUUID();
  await pool.query(`UPDATE notification_email_deliveries SET status='failed',claim_token=NULL,lease_expires_at=NULL,
    last_error='DELIVERY_STATUS_UNKNOWN' WHERE status='processing' AND lease_expires_at<=clock_timestamp()
      AND ($1::bigint[] IS NULL OR source_id=ANY($1))`, [sourceIds]);
  const result = await pool.query(`WITH candidate AS (
    SELECT id FROM notification_email_deliveries WHERE attempts<3 AND ($2::bigint[] IS NULL OR source_id=ANY($2))
      AND status IN ('pending','retry') AND (retry_at IS NULL OR retry_at<=clock_timestamp())
    ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
    UPDATE notification_email_deliveries d SET status='processing',attempts=attempts+1,
      claim_token=$1::uuid,lease_expires_at=clock_timestamp()+interval '1 minute',retry_at=NULL
    FROM candidate c WHERE d.id=c.id RETURNING d.*`, [token, sourceIds]);
  return result.rows[0] ?? null;
}

async function deliveryPayload(pool, delivery) {
  const result = await pool.query(`SELECT u.email,t.name AS task_name,t.id AS task_id,
      p.project_name,COALESCE(c.body,e.summary) AS body
    ${SOURCE_JOIN}
    JOIN users u ON u.id=$2 AND u.deactivated_at IS NULL
      AND u.id IS DISTINCT FROM COALESCE(c.author_id,e.actor_id)
    JOIN LATERAL (SELECT home.* FROM atlas_notification_projects(t.id,'email') home
      WHERE home.project_id=$3 AND (${ROLE_ACCESS})) p ON TRUE
    WHERE s.id=$1 AND ${RECIPIENT_GATE}`, [delivery.source_id, delivery.user_id, delivery.project_id]);
  const payload = result.rows[0];
  return payload && typeof payload.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) ? payload : null;
}

async function finish(pool, delivery, status, error = null, retrySeconds = null) {
  return pool.query(`UPDATE notification_email_deliveries SET status=$3,last_error=$4,
    claim_token=NULL,lease_expires_at=NULL,retry_at=CASE WHEN $5::int IS NULL THEN NULL ELSE clock_timestamp()+make_interval(secs=>$5) END,
    sent_at=CASE WHEN $3='sent' THEN clock_timestamp() ELSE sent_at END,
    attempts=CASE WHEN $3='unconfigured' OR $4='WORKER_STOPPED' THEN greatest(0,attempts-1) ELSE attempts END
    WHERE id=$1 AND claim_token=$2::uuid`, [delivery.id, delivery.claim_token, status, error, retrySeconds]);
}

/** Pool and transport injection are internal test seams, never HTTP inputs. */
export async function processNotificationEmails(pool, options = {}) {
  const limit = Number.isFinite(options.limit) ? Math.min(20, Math.max(1, Math.trunc(options.limit))) : 10;
  const config = options.config ?? notificationMailConfig();
  const send = options.sendMail ?? ((mail) => sendNotificationMail(config, mail));
  const stopping = options.shouldStop ?? (() => false);
  const sourceIds = options.sourceIds ?? null;
  const result = { expanded: 0, sent: 0, failed: 0, cancelled: 0, unconfigured: 0 };
  for (let i = 0; i < limit && !stopping(); i++) {
    if (!await expandSource(pool, sourceIds)) break;
    result.expanded++;
  }
  for (let i = 0; i < limit && !stopping(); i++) {
    const delivery = await claimDelivery(pool, sourceIds);
    if (!delivery) break;
    if (stopping()) { await finish(pool, delivery, "retry", "WORKER_STOPPED", 1); break; }
    // Re-read current roles, settings, deletion and approval recipients just
    // before sending. Revoked/muted pending messages are cancelled, not sent.
    const payload = await deliveryPayload(pool, delivery);
    if (!payload) { await finish(pool, delivery, "cancelled", "RECIPIENT_NO_LONGER_ELIGIBLE"); result.cancelled++; continue; }
    if (!config.configured) { await finish(pool, delivery, "unconfigured", config.reason); result.unconfigured++; continue; }
    if (stopping()) { await finish(pool, delivery, "retry", "WORKER_STOPPED", 1); break; }
    // Never automatically reclaim an expired SMTP attempt: acceptance may have
    // happened before the connection/worker was lost. Stale workers cannot send.
    const lease = await pool.query(`SELECT 1 FROM notification_email_deliveries
      WHERE id=$1 AND claim_token=$2::uuid AND status='processing' AND lease_expires_at>clock_timestamp()`,
    [delivery.id, delivery.claim_token]);
    if (!lease.rows.length) continue;
    const url = new URL(`/projects/${delivery.project_id}?view=list&task=${payload.task_id}`, config.appUrl).href;
    let smtpAccepted = false;
    try {
      const mail = { to: payload.email, subject: `${payload.project_name}: ${payload.task_name}`,
        text: `${payload.task_name}\n\n${String(payload.body ?? "").slice(0, 4000)}\n\n${url}`,
        messageId: notificationMessageId(delivery.source_id, delivery.user_id) };
      const accepted = await send(mail);
      if (!Array.isArray(accepted?.accepted) || !accepted.accepted.some((address) => String(address).toLowerCase() === payload.email.toLowerCase())) {
        throw new Error("SMTP did not accept the recipient");
      }
      smtpAccepted = true;
      const saved = await finish(pool, delivery, "sent");
      if (saved.rowCount) result.sent++;
    } catch {
      const terminal = smtpAccepted || Number(delivery.attempts) >= 3;
      await finish(pool, delivery, terminal ? "failed" : "retry", smtpAccepted ? "DELIVERY_STATUS_UNKNOWN" : "SMTP_SEND_FAILED",
        terminal ? null : Number(delivery.attempts) === 1 ? 5 : 30);
      result.failed++;
    }
  }
  return result;
}

/** Explicit administrative retry; sent/cancelled entries are never re-sent. */
export async function requeueNotificationEmails(pool, projectId) {
  const result = await pool.query(`WITH eligible AS (
    SELECT d.id ${SOURCE_JOIN}
    JOIN notification_email_deliveries d ON d.source_id=s.id AND d.project_id=$1
    JOIN users u ON u.id=d.user_id AND u.deactivated_at IS NULL
    JOIN LATERAL (SELECT home.project_id FROM atlas_notification_projects(t.id,'email') home
      WHERE home.project_id=$1 AND (${ROLE_ACCESS})) p ON TRUE
    WHERE d.status IN ('unconfigured','failed') AND ${RECIPIENT_GATE}
    ORDER BY d.id LIMIT 100 FOR UPDATE OF d SKIP LOCKED)
    UPDATE notification_email_deliveries d SET status='pending',attempts=0,last_error=NULL,
      retry_at=NULL,claim_token=NULL,lease_expires_at=NULL FROM eligible e WHERE d.id=e.id RETURNING d.id`, [projectId]);
  const sources = await pool.query(`WITH eligible AS (
    SELECT s.id FROM notification_email_sources s WHERE s.status='failed' AND EXISTS (
      SELECT 1 FROM atlas_notification_projects(s.task_id,'email') home WHERE home.project_id=$1)
    ORDER BY s.id LIMIT $2 FOR UPDATE SKIP LOCKED)
    UPDATE notification_email_sources s SET status='pending',attempts=0,last_error=NULL FROM eligible e WHERE s.id=e.id`,
  [projectId, Math.max(0, 100 - (result.rowCount ?? 0))]);
  return (result.rowCount ?? 0) + (sources.rowCount ?? 0);
}

/** Start only from the custom server; next dev has no worker heartbeat. */
export function startNotificationEmailWorker(pool, options = {}) {
  if (process.env.NOTIFICATION_WORKER_DISABLED === "1") return { stop: async () => {} };
  const instanceId = randomUUID();
  let stopped = false;
  let inFlight = null;
  const heartbeat = () => pool.query(`INSERT INTO notification_worker_heartbeats(instance_id,state,smtp_configured)
    VALUES($1,'running',$2) ON CONFLICT(instance_id) DO UPDATE SET state='running',smtp_configured=EXCLUDED.smtp_configured,last_seen_at=clock_timestamp()`,
  [instanceId, (options.config ?? notificationMailConfig()).configured]).catch(() => undefined);
  const tick = () => {
    if (stopped || inFlight) return;
    inFlight = processNotificationEmails(pool, { ...options, shouldStop: () => stopped })
      .catch(() => console.error("notification email worker failed"))
      .finally(() => { inFlight = null; });
  };
  const timer = setInterval(tick, 2000);
  const beat = setInterval(() => void heartbeat(), 5000);
  timer.unref?.(); beat.unref?.();
  void heartbeat(); tick();
  return { stop: async () => {
    stopped = true; clearInterval(timer); clearInterval(beat);
    await inFlight;
    await pool.query("UPDATE notification_worker_heartbeats SET state='stopping',last_seen_at=clock_timestamp() WHERE instance_id=$1", [instanceId]).catch(() => undefined);
  } };
}
