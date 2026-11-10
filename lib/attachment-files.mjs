import { opendir, stat, unlink } from "node:fs/promises";
import path from "node:path";

export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "/app/uploads";
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
const uuid = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const storedPattern = new RegExp(`^${uuid}(?:\\.[a-z0-9]{0,9})?$`);
const partialPattern = new RegExp(`^\\.upload-${uuid}\\.part$`);

/** @param {import('pg').PoolClient} client @param {string} name */
export async function lockAttachmentFile(client, name) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 18473392))", [name]);
}

/** @param {string} file */
export async function unlinkIfPresent(file) {
  try {
    await unlink(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

/** @param {import('pg').PoolClient} client @param {string} name @param {string} [dir] */
export async function pruneUnreferencedAttachment(client, name, dir = UPLOAD_DIR) {
  if (path.basename(name) !== name || !name) return false;
  await lockAttachmentFile(client, name);
  const referenced = await client.query("SELECT 1 FROM task_attachments WHERE stored_name = $1 LIMIT 1", [name]);
  return referenced.rowCount === 0 && unlinkIfPresent(path.join(dir, name));
}

/** @param {string} file @param {number} cutoff */
async function isOld(file, cutoff) {
  try {
    const info = await stat(file);
    return info.mtimeMs <= cutoff;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Clean aged files from failed writes and DB cascades. Recheck each orphan under
 * the same lock the uploader uses before making its final file visible.
 * @param {import('pg').Pool} pool
 * @param {{dir?: string, olderThan?: number}} [options]
 */
export async function reconcileAttachmentFiles(pool, { dir = UPLOAD_DIR, olderThan = Date.now() - ORPHAN_GRACE_MS } = {}) {
  let files;
  try {
    files = await opendir(dir);
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
  let removed = 0;
  /** @type {string[]} */
  const names = [];
  const pruneBatch = async () => {
    if (!names.length) return;
    const { rows } = await pool.query("SELECT stored_name FROM task_attachments WHERE stored_name = ANY($1::text[])", [names]);
    const referenced = new Set(rows.map((row) => row.stored_name));
    for (const name of names) {
      if (referenced.has(name) || !(await isOld(path.join(dir, name), olderThan))) continue;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (await pruneUnreferencedAttachment(client, name, dir)) removed++;
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
    names.length = 0;
  };

  for await (const entry of files) {
    if (!entry.isFile()) continue;
    if (storedPattern.test(entry.name)) {
      names.push(entry.name);
      if (names.length === 100) await pruneBatch();
    } else if (partialPattern.test(entry.name)) {
      const file = path.join(dir, entry.name);
      if (await isOld(file, olderThan) && await unlinkIfPresent(file)) removed++;
    }
  }
  await pruneBatch();
  return removed;
}
