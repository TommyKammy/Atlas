import { createClient } from "redis";

// Live fan-out through Redis pub/sub (works across app replicas; a lone
// instance receives its own publishes back). Best-effort: failures never
// fail the mutation itself.
const CHANNEL = "atlas:live";
const REDIS_WAIT_MS = 500;
let publisher: ReturnType<typeof startPublisher> | null = null;

async function waitForRedis(operation: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, REDIS_WAIT_MS);
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function startPublisher() {
  const client = createClient({
    url: process.env.REDIS_URL || "redis://localhost:6379",
    disableOfflineQueue: true,
    commandsQueueMaxLength: 256,
    socket: {
      connectTimeout: 1000,
      socketTimeout: 10000,
      // Keep retrying even after an established socket stops responding.
      reconnectStrategy: (retries) => Math.min(50 * 2 ** retries, 2000) + Math.floor(Math.random() * 200),
    },
    pingInterval: 5000,
  });
  client.on("error", () => undefined);
  // Give a healthy cold connection a chance to publish the first notification.
  // During an outage the shared wait expires while the client keeps retrying.
  const initialConnection = waitForRedis(client.connect().catch(() => {
    publisher = null;
    client.destroy();
  }));
  return { client, initialConnection };
}

export async function notifyProject(
  projectId: number | string | null | undefined,
  message?: unknown,
) {
  if (projectId === null || projectId === undefined) return;
  try {
    const { client, initialConnection } = (publisher ??= startPublisher());
    if (!client.isReady) await initialConnection;
    if (!client.isReady) return;
    // A sent command can stall even while the socket is marked ready.
    await waitForRedis(client.publish(
      CHANNEL,
      JSON.stringify({ projectId: Number(projectId), message: message ?? { type: "invalidate" } }),
    ));
  } catch {
    // advisory only
  }
}

export async function notifyTask(taskId: number | string | null | undefined, message?: unknown) {
  if (taskId === null || taskId === undefined) return;
  try {
    const { db } = await import("./db");
    const r = await db.query("SELECT project_id FROM tasks WHERE id = $1::bigint", [taskId]);
    await notifyProject(r.rows[0]?.project_id ?? null, message);
  } catch {
    // advisory only
  }
}

export async function notifyField(fieldId: number | string, message?: unknown) {
  try {
    const { db } = await import("./db");
    const r = await db.query("SELECT project_id FROM custom_fields WHERE id = $1::bigint", [fieldId]);
    await notifyProject(r.rows[0]?.project_id ?? null, message);
  } catch {
    // advisory only
  }
}

export async function notifySection(sectionId: number | string, message?: unknown) {
  try {
    const { db } = await import("./db");
    const r = await db.query("SELECT project_id FROM sections WHERE id = $1::bigint", [sectionId]);
    await notifyProject(r.rows[0]?.project_id ?? null, message);
  } catch {
    // advisory only
  }
}
