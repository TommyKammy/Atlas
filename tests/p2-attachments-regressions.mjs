import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { request as rawRequest } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { reconcileAttachmentFiles, UPLOAD_DIR } from "../lib/attachment-files.mjs";
import { base, db, fixtures, http, request, session, task, waitForHttp } from "./regression-fixtures.mjs";

const MiB = 1024 * 1024;
const boundary = "atlas-r22-multipart-regression";
const contentType = `multipart/form-data; boundary=${boundary}`;
let fx;

before(async () => {
  await waitForHttp();
  fx = await fixtures("R22 attachment");
});

function startForm(taskId, filename = "test.txt") {
  const taskField = taskId == null ? "" :
    `--${boundary}\r\nContent-Disposition: form-data; name="task_id"\r\n\r\n${taskId}\r\n`;
  return `${taskField}--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n`;
}

function chunked(pathname, taskId, fileBytes, epilogueBytes = 0) {
  async function* chunks() {
    const fill = async function* (bytes) {
      const block = Buffer.alloc(64 * 1024, 97);
      for (let left = bytes; left > 0; left -= block.length) yield block.subarray(0, left);
    };
    yield Buffer.from(startForm(taskId));
    yield* fill(fileBytes);
    yield Buffer.from(`\r\n--${boundary}--\r\n`);
    yield* fill(epilogueBytes);
  }
  return fetch(`${base}${pathname}`, {
    method: "POST", duplex: "half", body: Readable.from(chunks()),
    headers: { cookie: fx.owner, "content-type": contentType }, signal: AbortSignal.timeout(10_000),
  });
}

async function expectStatus(response, expected) {
  const body = await response.text();
  assert.equal(response.status, expected, body);
  return JSON.parse(body);
}

function upload(taskId, name, content) {
  const form = new FormData();
  form.set("task_id", String(taskId));
  form.set("file", new Blob([content], { type: "text/plain" }), name);
  return http("/api/attachments", { cookie: fx.owner, method: "POST", body: form });
}

async function fileNames() {
  const files = await readdir(UPLOAD_DIR).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return files.sort();
}

async function waitFor(check, message) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await check()) return;
    await delay(50);
  }
  assert.fail(message);
}

function openUpload(cookie) {
  const req = rawRequest(`${base}/api/attachments`, { method: "POST", headers: {
    Cookie: cookie, "Content-Type": contentType, "Transfer-Encoding": "chunked",
  } });
  const response = new Promise((resolve, reject) => {
    req.once("response", async (res) => {
      let body = "";
      try {
        for await (const chunk of res.setEncoding("utf8")) body += chunk;
        resolve({ status: res.statusCode, body: JSON.parse(body) });
      } catch (error) {
        reject(error);
      }
    });
    req.once("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("upload response timed out")));
  });
  // A caller may wait for a filesystem event before awaiting the response.
  void response.catch(() => undefined);
  return { req, response };
}

test("R22 rejected partial uploads never open a staged file", async () => {
  const taskId = await task(fx.a, "R22 viewer cannot stage uploads");
  const { rows: [viewer] } = await db.query("INSERT INTO users (name) VALUES ('R22 viewer') RETURNING id");
  await db.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'viewer')", [fx.a, viewer.id]);
  const viewerCookie = await session(viewer.id);
  const previous = await fileNames();
  const staged = [];
  const watcher = watch(UPLOAD_DIR, (_event, name) => {
    if (name?.endsWith(".part")) staged.push(name);
  });
  try {
    for (const attempt of [
      { cookie: viewerCookie, taskId, status: 403 },
      { cookie: fx.editor, taskId: null, status: 400, error: /task_id must precede file/ },
      { cookie: fx.editor, taskId: "not-an-id", status: 400, error: /invalid task_id/ },
    ]) {
      const { req, response } = openUpload(attempt.cookie);
      try {
        req.write(startForm(attempt.taskId));
        req.write(Buffer.alloc(128 * 1024));
        // Leave the body open. An early rejection must precede the last part.
        const { status, body } = await response;
        assert.equal(status, attempt.status, JSON.stringify(body));
        if (attempt.error) assert.match(body.error, attempt.error);
      } finally {
        req.destroy();
      }
    }
    assert.deepEqual(staged, []);
    assert.deepEqual(await fileNames(), previous);
  } finally {
    watcher.close();
  }
});

test("R22 a second task_id after the authorized file cleans up without changing targets", async () => {
  const taskId = await task(fx.a, "R22 authorized upload target");
  const foreignId = await task(fx.b, "R22 unauthorized duplicate target");
  const previous = await fileNames();
  const { req, response } = openUpload(fx.editor);
  try {
    req.write(startForm(taskId));
    req.write(Buffer.alloc(128 * 1024));
    await waitFor(async () => (await fileNames()).some((name) => !previous.includes(name) && name.endsWith(".part")),
      "authorized upload never opened the staged file");
    req.end(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="task_id"\r\n\r\n${foreignId}\r\n--${boundary}--\r\n`);
    const { status, body } = await response;
    assert.equal(status, 400, JSON.stringify(body));
    assert.match(body.error, /invalid multipart field/);
  } finally {
    req.destroy();
  }
  assert.deepEqual(await fileNames(), previous);
  assert.equal((await db.query("SELECT 1 FROM task_attachments WHERE task_id = ANY($1::bigint[])", [[taskId, foreignId]])).rowCount, 0);
});

test("R22 an upload is not published after losing task edit permission", async () => {
  const { a, editor, editorId } = await fixtures("R22 upload revocation");
  const taskId = await task(a, "R22 upload pending permission change");
  const previous = await fileNames();
  const { req, response } = openUpload(editor);
  try {
    req.write(startForm(taskId));
    req.write(Buffer.alloc(128 * 1024));
    await waitFor(async () => (await fileNames()).some((name) => !previous.includes(name) && name.endsWith(".part")),
      "authorized upload never opened the staged file");
    await db.query("UPDATE project_members SET role = 'viewer' WHERE project_id = $1 AND user_id = $2", [a, editorId]);
    req.end(`\r\n--${boundary}--\r\n`);
    const { status, body } = await response;
    assert.equal(status, 403, JSON.stringify(body));
  } finally {
    req.destroy();
  }
  assert.deepEqual(await fileNames(), previous);
  assert.equal((await db.query("SELECT 1 FROM task_attachments WHERE task_id = $1", [taskId])).rowCount, 0);
});

test("R22 upload and import cap chunked files and the entire multipart envelope", async () => {
  const taskId = await task(fx.a, "R22 size caps");
  const previous = await fileNames();
  const attachmentLimit = await chunked("/api/attachments", taskId, 25 * MiB + 1);
  assert.equal(attachmentLimit.headers.get("x-content-type-options"), "nosniff");
  await expectStatus(attachmentLimit, 413);
  const importPath = `/api/projects/${fx.a}/import`;
  const importLimit = await chunked(importPath, null, 5 * MiB + 1);
  assert.equal(importLimit.headers.get("x-content-type-options"), "nosniff");
  await expectStatus(importLimit, 413);
  await expectStatus(await chunked(importPath, null, 1, 5 * MiB + 64 * 1024), 413);

  // An over-limit declared length is rejected without requiring body bytes.
  const declared = await new Promise((resolve, reject) => {
    const req = rawRequest(`${base}${importPath}`, { method: "POST", headers: {
      Cookie: fx.owner, "Content-Type": contentType, "Content-Length": String(6 * MiB),
    } }, (res) => {
      res.resume();
      res.on("end", () => { resolve(res.statusCode); req.destroy(); });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("request length was not checked before body")));
    req.flushHeaders();
  });
  assert.equal(declared, 413);
  assert.deepEqual(await fileNames(), previous);
});

test("R22 interrupted uploads remove the staged partial file", async () => {
  const taskId = await task(fx.a, "R22 interrupted upload");
  const previous = await fileNames();
  const req = rawRequest(`${base}/api/attachments`, { method: "POST", headers: {
    Cookie: fx.owner, "Content-Type": contentType, "Transfer-Encoding": "chunked",
  } });
  req.on("error", () => undefined);
  try {
    req.write(startForm(taskId));
    req.write(Buffer.alloc(128 * 1024));
    await waitFor(async () => (await fileNames()).some((name) => !previous.includes(name) && name.endsWith(".part")),
      "upload was not written incrementally before the request completed");
  } finally {
    req.destroy();
  }
  await waitFor(async () => JSON.stringify(await fileNames()) === JSON.stringify(previous), "partial file was not removed");
  const { rowCount } = await db.query("SELECT 1 FROM task_attachments WHERE task_id = $1", [taskId]);
  assert.equal(rowCount, 0);
});

test("R22 DB insert and deferred commit failures do not leave files", async () => {
  const taskId = await task(fx.a, "R22 database failures");
  const previous = await fileNames();
  await db.query(`
    CREATE FUNCTION r22_reject_attachment() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'R22 forced attachment DB failure'; END $$;
    CREATE TRIGGER r22_reject_insert BEFORE INSERT ON task_attachments
      FOR EACH ROW WHEN (NEW.file_name = 'r22-insert-failure.txt') EXECUTE FUNCTION r22_reject_attachment();
    CREATE CONSTRAINT TRIGGER r22_reject_commit AFTER INSERT ON task_attachments
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      WHEN (NEW.file_name = 'r22-commit-failure.txt') EXECUTE FUNCTION r22_reject_attachment();
  `);
  try {
    await expectStatus(await upload(taskId, "r22-insert-failure.txt", "insert"), 500);
    await expectStatus(await upload(taskId, "r22-commit-failure.txt", "commit"), 500);
    assert.deepEqual(await fileNames(), previous);
    assert.equal((await db.query("SELECT 1 FROM task_attachments WHERE task_id = $1", [taskId])).rowCount, 0);
  } finally {
    await db.query("DROP FUNCTION r22_reject_attachment() CASCADE");
  }
});

test("R22 exact-limit files are readable from another replica and reconciled after task purge", async () => {
  const replica = process.env.ATLAS_ATTACHMENT_REPLICA;
  assert.equal(replica, "http://attachment-replica:3000", "Run with the disposable shared-volume replica");
  const taskId = await task(fx.a, "R22 shared attachment volume");
  const { id } = await expectStatus(await chunked("/api/attachments", taskId, 25 * MiB), 201);
  const { rows: [attachment] } = await db.query("SELECT stored_name FROM task_attachments WHERE id = $1", [id]);
  const fullPath = path.join(UPLOAD_DIR, attachment.stored_name);
  assert.equal((await stat(fullPath)).size, 25 * MiB);

  await waitFor(async () => {
    try {
      const response = await fetch(`${replica}/api/me`, { headers: { cookie: fx.owner }, signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    }
  }, "second replica did not start");
  const download = await fetch(`${replica}/api/attachments/${id}`, {
    headers: { cookie: fx.owner, "Accept-Encoding": "identity" }, signal: AbortSignal.timeout(10_000),
  });
  assert.equal(download.status, 200);
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of download.body) {
    bytes += chunk.byteLength;
    hash.update(chunk);
  }
  assert.equal(bytes, 25 * MiB);
  assert.equal(hash.digest("hex"), createHash("sha256").update(Buffer.alloc(25 * MiB, 97)).digest("hex"));

  const partial = path.join(UPLOAD_DIR, `.upload-${randomUUID()}.part`);
  await writeFile(partial, "abandoned upload");
  assert.equal(await reconcileAttachmentFiles(db, { olderThan: 0 }), 0);
  assert.equal(await reconcileAttachmentFiles(db, { olderThan: Date.now() }), 1);
  assert.equal((await stat(fullPath)).size, 25 * MiB);
  await assert.rejects(stat(partial), { code: "ENOENT" });

  await request(fx.owner, "DELETE", `/api/tasks/${taskId}`, 200);
  await request(fx.owner, "DELETE", `/api/tasks/${taskId}?force=1`, 200);
  assert.equal((await db.query("SELECT 1 FROM task_attachments WHERE id = $1", [id])).rowCount, 0);
  assert.equal(await reconcileAttachmentFiles(db, { olderThan: Date.now() }), 1);
  await assert.rejects(stat(fullPath), { code: "ENOENT" });
});
