// Custom production server: Next.js + WebSocket live channel.
// Run with `node server.js` (see Dockerfile). Single-instance only.
const { createServer } = require("http");
const next = require("next");
const { WebSocketServer } = require("ws");

function splitUrl(raw) {
  const u = new URL(raw, "http://internal");
  return { pathname: u.pathname, query: Object.fromEntries(u.searchParams) };
}

const port = Number(process.env.APP_PORT || 3000);
const app = next({ dev: false, dir: "./" });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  const bus = await import("./lib/bus.mjs");

  const server = createServer((req, res) => {
    const u = new URL(req.url, "http://internal");
    handle(req, res, { pathname: u.pathname, query: Object.fromEntries(u.searchParams) });
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname, query } = splitUrl(req.url);
    if (pathname !== "/api/ws") {
      socket.destroy();
      return;
    }
    const cookie = String(req.headers.cookie || "");
    const m = cookie.match(/(?:^|;\s*)atlas_uid=(\d+)/);
    if (!m) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const projectId = Number(query.project);
    if (!Number.isInteger(projectId)) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, projectId);
    });
  });

  wss.on("connection", (ws, _req, projectId) => {
    bus.subscribe(projectId, ws);
    ws.on("error", () => undefined);
  });

  // Cross-instance fan-out: every replica (including this one) receives its
  // own and others' publishes and relays them to local sockets.
  try {
    const { createClient } = require("redis");
    const sub = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
    sub.on("error", (err) => console.error("live subscriber error:", err?.message || err));
    await sub.connect();
    await sub.subscribe("atlas:live", (text) => {
      try {
        const { projectId, message } = JSON.parse(text);
        if (Number.isInteger(projectId)) bus.broadcast(projectId, message ?? { type: "invalidate" });
      } catch {
        // ignore malformed publishes
      }
    });
    console.log("live subscriber on atlas:live");
  } catch (err) {
    console.error("live subscriber unavailable (single-instance degradation):", err?.message || err);
  }

  // Daily janitor for derived logs (same windows as scripts/janitor.sh).
  const auditDays = Number(process.env.RETENTION_DAYS_AUDIT || 90);
  const eventDays = Number(process.env.RETENTION_DAYS_EVENTS || 90);
  const trashDays = Number(process.env.RETENTION_DAYS_TRASH || 30);
  const janitor = async () => {
    try {
      const { Pool } = require("pg");
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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
           WHERE processed_at IS NOT NULL AND occurred_at < NOW() - make_interval(days => $1)
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
      await pool.end();
      if (Number(a.rows[0].n) + Number(e.rows[0].n) + Number(de.rows[0].n) + Number(rr.rows[0].n) > 0) {
        console.log(
          `janitor: purged audit=${a.rows[0].n} events=${e.rows[0].n} domain_events=${de.rows[0].n} rule_runs=${rr.rows[0].n}`,
        );
      }
    } catch (err) {
      console.error("janitor failed:", err?.message || err);
    }
  };
  setInterval(janitor, 24 * 3600 * 1000).unref();
  janitor();

  server.listen(port, () => {
    console.log(`Atlas ready on :${port} (http + ws /api/ws)`);
  });
});
