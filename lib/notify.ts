import { createClient, type RedisClientType } from "redis";

// Live fan-out through Redis pub/sub (works across app replicas; a lone
// instance receives its own publishes back). Best-effort: failures never
// fail the mutation itself.
const CHANNEL = "atlas:live";
let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType> | null = null;

async function getClient(): Promise<RedisClientType | null> {
  if (client?.isOpen) return client;
  if (!connecting) {
    connecting = (async () => {
      const c = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
      c.on("error", () => undefined);
      await c.connect();
      client = c as RedisClientType;
      return client;
    })().catch(() => {
      connecting = null;
      return null as unknown as RedisClientType;
    });
  }
  return connecting;
}

export async function notifyProject(
  projectId: number | string | null | undefined,
  message?: unknown,
) {
  if (projectId === null || projectId === undefined) return;
  try {
    const c = await getClient();
    if (!c) return;
    await c.publish(
      CHANNEL,
      JSON.stringify({ projectId: Number(projectId), message: message ?? { type: "invalidate" } }),
    );
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
