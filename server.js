// Custom server: Next.js + WebSocket live channel. Single-instance only.
// Development (Fast Refresh): NODE_ENV=development node server.js.
const { createServer } = require("http");
const { createHash, randomBytes } = require("crypto");
const next = require("next");
const { WebSocketServer } = require("ws");
const { Pool } = require("pg");

// Per-process proof key; never accept a client-supplied peer identity directly.
process.env.ATLAS_INTERNAL_AUTH_IP_KEY = randomBytes(32).toString("hex");

const dbPool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3_000 });
const SESSION_COOKIE_RE = /(?:^|;\s*)atlas_session=([A-Za-z0-9_-]{43})(?:;|$)/;
const hashSessionToken = (token) => createHash("sha256").update(token).digest("hex");

const port = Number(process.env.APP_PORT || 3000);
const dev = process.env.NODE_ENV === "development";
const app = next({ dev, dir: "./", port });
const handle = app.getRequestHandler();
const wsOrigins = new Set((process.env.WS_ALLOWED_ORIGINS ?? process.env.APP_ORIGIN ?? process.env.APP_URL ??
  `http://127.0.0.1:${port},http://localhost:${port},http://[::1]:${port}`).split(",").flatMap((value) => {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? [url.origin] : [];
  } catch {
    return [];
  }
}));

async function loadLiveAccess(subscriptions) {
  const { rows } = await dbPool.query({
    // Match the HTTP project role policy, including the legacy member role.
    text: `SELECT u.id IS NOT NULL AS active_session,
                  (u.id IS NOT NULL AND p.id IS NOT NULL AND
                   (u.is_admin OR COALESCE(m.role IN ('admin','editor','commenter','viewer','member'), false))) AS can_view
           FROM unnest($1::text[], $2::bigint[]) WITH ORDINALITY AS target(token_hash, project_id, ord)
           LEFT JOIN user_sessions s ON s.token_hash = target.token_hash
             AND s.expires_at > now() AND NOT s.mfa_enrollment_only
           LEFT JOIN users u ON u.id = s.user_id AND u.deactivated_at IS NULL
             AND (s.auth_method = 'saml' OR u.is_admin OR NOT EXISTS (
               SELECT 1 FROM workspace_security sw
               WHERE sw.workspace_id = (SELECT id FROM workspaces ORDER BY id LIMIT 1)
                 AND (sw.saml_mode = 'required' OR (sw.saml_mode = 'members_only' AND NOT u.is_guest))
             ))
             AND ((u.totp_enabled AND s.created_at >= COALESCE(u.totp_enrolled_at, '-infinity'::timestamptz))
               OR NOT EXISTS (SELECT 1 FROM workspace_security
                 WHERE workspace_id = (SELECT id FROM workspaces ORDER BY id LIMIT 1) AND two_factor_policy = 'required'))
           LEFT JOIN projects p ON p.id = target.project_id AND p.deleted_at IS NULL
           LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = u.id
           ORDER BY target.ord`,
    values: [subscriptions.map(({ tokenHash }) => tokenHash), subscriptions.map(({ projectId }) => projectId)],
    query_timeout: 3_000,
  });
  return rows;
}

function rejectUpgrade(socket, status) {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => socket.destroy());
}

function startLiveSubscriber(bus) {
  // Cross-instance fan-out runs independently of HTTP readiness.
  try {
    const { createClient } = require("redis");
    const sub = createClient({
      url: process.env.REDIS_URL || "redis://localhost:6379",
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 1000,
        socketTimeout: 10000,
        // Keep retrying even after an established socket stops responding.
        reconnectStrategy: (retries) => Math.min(50 * 2 ** retries, 2000) + Math.floor(Math.random() * 200),
      },
      pingInterval: 5000,
    });
    const logError = (err) => console.error("live subscriber error:", err?.message || err);
    const onMessage = (text) => {
      try {
        const { projectId, message } = JSON.parse(text);
        if (Number.isSafeInteger(projectId)) {
          void bus.broadcast(projectId, message ?? { type: "invalidate" }).catch(logError);
        }
      } catch {
        // ignore malformed publishes
      }
    };
    sub.on("error", logError);
    sub.on("ready", () => {
      // Redis restores acknowledged subscriptions on reconnect. Calling subscribe
      // again also covers a connection lost before the first acknowledgement.
      void sub.subscribe("atlas:live", onMessage)
        .then(() => console.log("live subscriber on atlas:live"))
        .catch(logError);
    });
    void sub.connect().catch(logError);
  } catch (err) {
    console.error("live subscriber unavailable:", err?.message || err);
  }
}

app.prepare().then(async () => {
  const { createLiveRooms } = await import("./lib/bus.mjs");
  const { reconcileAttachmentFiles } = await import("./lib/attachment-files.mjs");
  const { startNotificationEmailWorker } = await import("./lib/notification-email-worker.mjs");
  const { installServerShutdown } = await import("./lib/server-shutdown.mjs");
  const { stampAuthClientIp } = await import("./lib/auth-client-ip.mjs");
  const bus = createLiveRooms(loadLiveAccess);
  const notificationWorker = startNotificationEmailWorker(dbPool);

  const server = createServer((req, res) => {
    stampAuthClientIp(req, process.env.ATLAS_INTERNAL_AUTH_IP_KEY);
    const u = new URL(req.url, "http://internal");
    handle(req, res, { pathname: u.pathname, query: Object.fromEntries(u.searchParams) });
  });
  server.on("close", () => { void notificationWorker.stop(); });

  const wss = new WebSocketServer({ noServer: true });
  installServerShutdown({ server, sockets: wss, worker: notificationWorker, pool: dbPool });

  server.on("upgrade", async (req, socket, head) => {
    const onSocketError = () => socket.destroy();
    socket.on("error", onSocketError);
    let url;
    try {
      url = new URL(req.url, "http://internal");
    } catch {
      rejectUpgrade(socket, "400 Bad Request");
      return;
    }
    if (dev && (url.pathname === "/_next/hmr" || url.pathname.startsWith("/_next/hmr/"))) {
      if (!wsOrigins.has(req.headers.origin)) {
        rejectUpgrade(socket, "403 Forbidden");
        return;
      }
      // Next installs its own upgrade listener through getRequestHandler().
      // Leave this socket to that listener; destroying it breaks Fast Refresh.
      socket.off("error", onSocketError);
      return;
    }
    if (url.pathname !== "/api/ws") {
      socket.destroy();
      return;
    }
    const cookie = String(req.headers.cookie || "");
    const match = cookie.match(SESSION_COOKIE_RE);
    const projectId = Number(url.searchParams.get("project"));
    if (!match) {
      rejectUpgrade(socket, "401 Unauthorized");
      return;
    }
    if (!wsOrigins.has(req.headers.origin)) {
      rejectUpgrade(socket, "403 Forbidden");
      return;
    }
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      rejectUpgrade(socket, "400 Bad Request");
      return;
    }
    const tokenHash = hashSessionToken(match[1]);
    let access;
    try {
      [access] = await loadLiveAccess([{ tokenHash, projectId }]);
    } catch {
      rejectUpgrade(socket, "503 Service Unavailable");
      return;
    }
    if (socket.destroyed) return;
    if (!access?.active_session) {
      rejectUpgrade(socket, "401 Unauthorized");
      return;
    }
    if (!access.can_view) {
      rejectUpgrade(socket, "403 Forbidden");
      return;
    }
    socket.off("error", onSocketError);
    wss.handleUpgrade(req, socket, head, (ws) => {
      bus.subscribe(projectId, ws, tokenHash);
      ws.on("error", () => undefined);
    });
  });

  // A socket with no traffic must still be closed after revocation or expiry.
  setInterval(() => {
    void bus.revalidate().catch((error) => console.error("live authorization failed:", error?.message || error));
  }, 5_000).unref();

  // Daily janitor for derived logs (same windows as scripts/janitor.sh).
  const auditDays = Number(process.env.RETENTION_DAYS_AUDIT || 90);
  const eventDays = Number(process.env.RETENTION_DAYS_EVENTS || 90);
  const trashDays = Number(process.env.RETENTION_DAYS_TRASH || 30);
  const janitor = async () => {
    try {
      const pool = dbPool;
      const a = await pool.query(
        "WITH del AS (DELETE FROM audit_log WHERE created_at < NOW() - make_interval(days => $1) RETURNING 1) SELECT COUNT(*) AS n FROM del",
        [auditDays],
      );
      const e = await pool.query(
        "WITH del AS (DELETE FROM task_events WHERE created_at < NOW() - make_interval(days => $1) RETURNING 1) SELECT COUNT(*) AS n FROM del",
        [eventDays],
      );
      const de = await pool.query(
        `WITH del AS (
           DELETE FROM domain_events
           WHERE (processed_at IS NOT NULL OR failed_at IS NOT NULL)
             AND occurred_at < NOW() - make_interval(days => $1)
           RETURNING 1
         ) SELECT COUNT(*) AS n FROM del`,
        [eventDays],
      );
      const rr = await pool.query(
        `WITH del AS (
           DELETE FROM rule_runs
           WHERE started_at < NOW() - make_interval(days => $1)
           RETURNING 1
         ) SELECT COUNT(*) AS n FROM del`,
        [eventDays],
      );
      await pool.query(
        "WITH del AS (DELETE FROM project_share_tokens WHERE expires_at IS NOT NULL AND expires_at <= NOW() RETURNING 1) SELECT COUNT(*) AS n FROM del",
      ).then((r) => {
        if (Number(r.rows[0].n) > 0) console.log(`janitor: purged share tokens=${r.rows[0].n}`);
      });
      const t = await pool.query(
        "WITH del AS (DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - make_interval(days => $1) RETURNING 1) SELECT COUNT(*) AS n FROM del",
        [trashDays],
      );
      if (Number(t.rows[0].n) > 0) console.log(`janitor: purged trash=${t.rows[0].n}`);
      const s = await pool.query(
        "WITH del AS (DELETE FROM user_sessions WHERE expires_at <= NOW() RETURNING 1) SELECT COUNT(*) AS n FROM del",
      );
      if (Number(s.rows[0].n) > 0) console.log(`janitor: purged sessions=${s.rows[0].n}`);
      if (Number(a.rows[0].n) + Number(e.rows[0].n) + Number(de.rows[0].n) + Number(rr.rows[0].n) > 0) {
        console.log(
          `janitor: purged audit=${a.rows[0].n} events=${e.rows[0].n} domain_events=${de.rows[0].n} rule_runs=${rr.rows[0].n}`,
        );
      }
    } catch (err) {
      console.error("janitor failed:", err?.message || err);
    }
    try {
      const removed = await reconcileAttachmentFiles(dbPool);
      if (removed > 0) console.log(`janitor: purged orphan attachment files=${removed}`);
    } catch (err) {
      console.error("attachment reconciliation failed:", err?.message || err);
    }
  };
  setInterval(janitor, 24 * 3600 * 1000).unref();
  janitor();

  server.listen(port, () => {
    console.log(`Atlas ready on :${port} (${dev ? "development / Fast Refresh" : "production"}, http + ws /api/ws)`);
    startLiveSubscriber(bus);
  });
});
