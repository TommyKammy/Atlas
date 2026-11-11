import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, test } from "node:test";
import { inflateRawSync } from "node:zlib";
import { parseCsv, toCsv } from "../lib/csv.ts";
import { db, fixtures, http, request, session, task, waitForHttp } from "./regression-fixtures.mjs";

before(waitForHttp);

const HEADER = ["セクション", "種別", "名前", "完了", "担当者", "開始日", "期日", "進捗", "Status", "繰返し", "コメント"];
const csvRow = (name, section = "CSV limit section") => [section, "タスク", name, "未完了", "", "", "", "0", "inbox", "", ""];

function upload(cookie, projectId, text) {
  const body = new FormData();
  body.set("file", new Blob([text], { type: "text/csv" }), "boundary.csv");
  return http(`/api/projects/${projectId}/import`, { cookie, method: "POST", body, timeout: 20_000 });
}

async function projectState(projectId) {
  const { rows: [row] } = await db.query(`SELECT jsonb_build_object(
    'project', (SELECT to_jsonb(p) FROM projects p WHERE id=$1),
    'tasks', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM tasks t WHERE project_id=$1),
    'sections', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb) FROM sections s WHERE project_id=$1),
    'fields', (SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.id),'[]'::jsonb) FROM custom_fields f WHERE project_id=$1),
    'values', (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.task_id,v.field_id),'[]'::jsonb) FROM task_custom_values v JOIN tasks t ON t.id=v.task_id WHERE t.project_id=$1),
    'memberships', (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.task_id,m.project_id),'[]'::jsonb) FROM task_project_memberships m JOIN tasks t ON t.id=m.task_id WHERE t.project_id=$1 OR m.project_id=$1),
    'comments', (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb) FROM comments c JOIN tasks t ON t.id=c.task_id WHERE t.project_id=$1),
    'events', (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb) FROM task_events e JOIN tasks t ON t.id=e.task_id WHERE t.project_id=$1),
    'domain', (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb) FROM domain_events e WHERE project_id=$1),
    'audit', (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) FROM audit_log a WHERE project_id=$1)
  ) AS snapshot`, [projectId]);
  return row.snapshot;
}

test("EV04 more than 1000 logical CSV rows are rejected before any project mutation", { timeout: 30_000 }, async () => {
  const f = await fixtures("EV04 reject");
  const existing = await task(f.a, "Existing row must remain unchanged");
  const { rows: [field] } = await db.query("INSERT INTO custom_fields(project_id,name,field_type) VALUES($1,'Existing import field','text') RETURNING id", [f.a]);
  await db.query("INSERT INTO task_custom_values(task_id,field_id,value_text) VALUES($1,$2,'Original import value')", [existing, field.id]);
  const before = await projectState(f.a);
  const rows = Array.from({ length: 1001 }, (_, i) => [...csvRow(i === 1000 ? "Quoted\nlogical row" : `Oversize ${i}`), "Attempted imported value"]);
  const response = await upload(f.owner, f.a, toCsv([[...HEADER, "Existing import field"], ...rows]));
  assert.equal(response.status, 400, await response.clone().text());
  const result = await response.json();
  assert.equal(result.max_rows, 1000);
  assert.equal(result.received_rows, 1001);
  assert.match(result.error, /1000/);
  assert.deepEqual(await projectState(f.a), before);
});

test("EV04 exactly 1000 rows survive surrounding blank lines; empty and malformed headers do not mutate", { timeout: 30_000 }, async () => {
  const f = await fixtures("EV04 boundary");
  const empty = await projectState(f.a);
  for (const text of [toCsv([HEADER, ["", " ", ""]]), toCsv([["Wrong header", ...HEADER.slice(1)], csvRow("Invalid header")])]) {
    const response = await upload(f.owner, f.a, text);
    assert.equal(response.status, 400);
    await response.body?.cancel();
    assert.deepEqual(await projectState(f.a), empty);
  }
  const rows = Array.from({ length: 1000 }, (_, i) => csvRow(`Boundary ${i}`));
  const text = `\uFEFF\n\r\n${toCsv([HEADER, ...rows], { bom: false })}\n , , \n\r\n`;
  const response = await upload(f.owner, f.a, text);
  assert.equal(response.status, 201, await response.clone().text());
  assert.deepEqual(await response.json(), { created: 1000, skipped: 0, errors: [] });
  const count = await db.query("SELECT count(*)::int AS n FROM tasks WHERE project_id=$1", [f.a]);
  assert.equal(count.rows[0].n, 1000);
});

test("EV04 imports retain task editing while new section/unknown header configuration requires permission", async () => {
  const f = await fixtures("EV04 configuration");
  await db.query("UPDATE projects SET settings=jsonb_build_object('who_can_edit','admins') WHERE id=$1", [f.a]);
  await db.query("INSERT INTO sections(project_id,name) VALUES($1,'Existing section')", [f.a]);
  const { rows: [field] } = await db.query("INSERT INTO custom_fields(project_id,name,field_type) VALUES($1,'Existing field','text') RETURNING id", [f.a]);
  const allowed = await upload(f.editor, f.a, toCsv([[...HEADER, "Existing field"], [...csvRow("Allowed row", "Existing section"), "Allowed value"]]));
  assert.equal(allowed.status, 201, await allowed.clone().text());
  assert.equal((await allowed.json()).created, 1);
  assert.equal((await db.query("SELECT value_text FROM task_custom_values WHERE field_id=$1", [field.id])).rows[0].value_text, "Allowed value");
  const before = await projectState(f.a);
  for (const csv of [
    toCsv([HEADER, csvRow("Must also roll back", "Existing section"), csvRow("Forbidden new section", "Unknown section")]),
    toCsv([[...HEADER, "Unknown field"], [...csvRow("Forbidden new field", "Existing section"), "Not silently discarded"]]),
  ]) {
    const denied = await upload(f.editor, f.a, csv);
    assert.equal(denied.status, 403, await denied.clone().text());
    await denied.body?.cancel();
    assert.deepEqual(await projectState(f.a), before);
  }
  const admin = await upload(f.owner, f.a, toCsv([HEADER, csvRow("Admin new section", "Unknown section")]));
  assert.equal(admin.status, 201, await admin.clone().text());
  assert.equal((await admin.json()).created, 1);
});

async function legacyChild(projectId, parentId, name) {
  const connection = await db.connect();
  try {
    await connection.query("BEGIN");
    // Reproduce pre-0002 rows only in the guarded disposable regression DB.
    // The production hierarchy guard remains installed and enabled.
    await connection.query("SET LOCAL session_replication_role = replica");
    const { rows: [row] } = await connection.query(
      "INSERT INTO tasks(project_id,parent_task_id,name) VALUES($1,$2,$3) RETURNING id",
      [projectId, parentId, name],
    );
    await connection.query("SET LOCAL session_replication_role = origin");
    await connection.query("COMMIT");
    return Number(row.id);
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}

async function multiHomeFixture() {
  const prefix = `EV05-${randomUUID()}`;
  const f = await fixtures(prefix);
  const { rows: [primarySection, memberSection] } = await db.query(
    "INSERT INTO sections(project_id,name) VALUES($1,$3),($2,$4) RETURNING id,name", [f.a, f.b, `${prefix} primary section`, `${prefix} member section`]);
  const shared = await task(f.a, `${prefix} shared`);
  const sharedNull = await task(f.a, `${prefix} unsectioned shared`);
  const privateTask = await task(f.a, `${prefix} private primary`);
  const local = await task(f.b, `${prefix} local member`);
  const compatibleChild = await task(f.a, `${prefix} compatible child`, shared);
  await db.query("UPDATE tasks SET section_id=$2 WHERE project_id=$1", [f.a, primarySection.id]);
  await db.query("UPDATE tasks SET section_id=$2 WHERE id=$1", [local, memberSection.id]);
  await db.query("UPDATE tasks SET status='EV05_ACTIVE' WHERE id=$1", [shared]);
  await db.query(`INSERT INTO task_project_memberships(task_id,project_id,section_id)
    VALUES($1,$3,$4),($1,$5,$6),($2,$5,NULL)`, [shared, sharedNull, f.a, primarySection.id, f.b, memberSection.id]);
  const { rows: [foreign, deleted] } = await db.query(
    "INSERT INTO projects(workspace_id,name) VALUES(1,$1),(1,$2) RETURNING id", [`${prefix} foreign`, `${prefix} deleted`]);
  const legacyChildId = await legacyChild(foreign.id, shared, `${prefix} foreign legacy child`);
  const explicitChild = await legacyChild(foreign.id, shared, `${prefix} explicit foreign child`);
  await db.query("INSERT INTO task_project_memberships(task_id,project_id,section_id) VALUES($1,$2,$3)", [explicitChild, f.b, memberSection.id]);
  const deletedTask = await task(deleted.id, `${prefix} deleted home`);
  await db.query("UPDATE projects SET deleted_at=now() WHERE id=$1", [deleted.id]);
  const { rows: [privateField, visibleField, restrictedField] } = await db.query(
    `INSERT INTO custom_fields(project_id,name,field_type,access_level)
     VALUES($1,$3,'text','admins'),($2,$4,'text','everyone'),($2,$5,'text','admins') RETURNING id,name`,
    [f.a, f.b, `${prefix} private field`, `${prefix} visible field`, `${prefix} edit restricted field`]);
  const privateValue = `${prefix} PRIVATE_VALUE`;
  const visibleValue = `${prefix} MEMBER_VALUE`;
  await db.query(`INSERT INTO task_custom_values(task_id,field_id,value_text)
    VALUES($1,$2,$3),($1,$4,$5),($1,$6,'Restricted readable value'),($7,$4,$5),($8,$4,$5)`,
  [shared, privateField.id, privateValue, visibleField.id, visibleValue, restrictedField.id, privateTask, legacyChildId]);
  const { rows: [viewer, commenter, editor] } = await db.query(
    "INSERT INTO users(name) VALUES($1),($2),($3) RETURNING id", [`${prefix} viewer`, `${prefix} commenter`, `${prefix} B editor`]);
  await db.query(`INSERT INTO project_members(project_id,user_id,role)
    VALUES($1,$2,'viewer'),($1,$3,'commenter'),($1,$4,'editor'),($5,$2,'viewer')`,
  [f.b, viewer.id, commenter.id, editor.id, deleted.id]);
  const { rows: [attachment, childAttachment] } = await db.query(`INSERT INTO task_attachments(task_id,file_name,stored_name,uploaded_by)
    VALUES($1,$2,$3,$4),($5,$6,$7,$4) RETURNING id`, [shared, `${prefix} shared.txt`, `${prefix}.txt`, f.ownerId, compatibleChild, `${prefix} child.txt`, `${prefix}-child.txt`]);
  await db.query(`INSERT INTO task_attachments(task_id,file_name,stored_name,uploaded_by)
    VALUES($1,$3,$4,$5),($2,$6,$7,$5)`, [legacyChildId, deletedTask, `${prefix} foreign.txt`, `${prefix}-foreign.txt`, f.ownerId, `${prefix} deleted.txt`, `${prefix}-deleted.txt`]);
  return { ...f, prefix, shared, sharedNull, privateTask, local, compatibleChild, legacyChild: legacyChildId, explicitChild, deletedTask,
    privateField, visibleField, restrictedField, privateValue, visibleValue, primarySection, memberSection, attachment, childAttachment,
    viewer: await session(viewer.id), viewerId: viewer.id, commenter: await session(commenter.id), bEditor: await session(editor.id) };
}

function taskLinks(html) {
  const start = html.indexOf('data-search-section="tasks"');
  if (start < 0) return [];
  const end = html.indexOf('data-search-section="', start + 1);
  const section = html.slice(start, end < 0 ? undefined : end);
  return [...section.matchAll(/href="\/projects\/(\d+)\?view=list(?:&amp;|&)task=(\d+)"/g)]
    .map((match) => ({ project: Number(match[1]), id: Number(match[2]) }));
}

async function searchPage(cookie, query) {
  const response = await http(`/search?${new URLSearchParams(query)}`, { cookie });
  assert.equal(response.status, 200, await response.clone().text());
  return taskLinks(await response.text());
}

test("EV05 B-only viewers/commenters find shared tasks through B, global search and autosuggest without duplicates", async () => {
  const f = await multiHomeFixture();
  for (const cookie of [f.viewer, f.commenter]) {
    const matches = await searchPage(cookie, { q: f.prefix, project: String(f.b), status: "EV05_ACTIVE", completed: "open", assignee: "none" });
    assert.deepEqual(matches, [{ project: f.b, id: f.shared }]);
    const global = await searchPage(cookie, { q: `${f.prefix} shared` });
    assert.deepEqual(global, [{ project: f.b, id: f.shared }]);
    assert.deepEqual(await searchPage(cookie, { q: `${f.prefix} compatible child`, project: String(f.b) }),
      [{ project: f.b, id: f.compatibleChild }]);
    assert.deepEqual(await searchPage(cookie, { q: `${f.prefix} explicit foreign child` }),
      [{ project: f.b, id: f.explicitChild }]);
    const suggest = await request(cookie, "GET", `/api/search/suggest?q=${encodeURIComponent(f.prefix)}`, 200);
    assert.equal(suggest.groups.tasks.filter((hit) => Number(hit.id) === f.shared).length, 1);
    assert.ok(suggest.groups.tasks.every((hit) => Number(hit.project_id) === f.b));
    assert.ok(suggest.groups.tasks.some((hit) => Number(hit.id) === f.compatibleChild));
    assert.ok(suggest.groups.tasks.some((hit) => Number(hit.id) === f.explicitChild));
    assert.ok(suggest.groups.tasks.every((hit) => ![f.privateTask, f.legacyChild, f.deletedTask].includes(Number(hit.id))));
    assert.deepEqual(suggest.groups.files.map((file) => ({ id: Number(file.id), project: Number(file.project_id) })).sort((a, b) => a.id - b.id),
      [f.attachment, f.childAttachment].map((file) => ({ id: Number(file.id), project: f.b })).sort((a, b) => a.id - b.id));
  }
  const owner = await request(f.owner, "GET", `/api/search/suggest?q=${encodeURIComponent(`${f.prefix} shared`)}`, 200);
  assert.equal(owner.groups.tasks.filter((hit) => Number(hit.id) === f.shared).length, 1);
  assert.equal(Number(owner.groups.tasks.find((hit) => Number(hit.id) === f.shared).project_id), f.a);
});

test("EV05 advanced custom filters use the selected home and reject legacy cross-project values", async () => {
  const f = await multiHomeFixture();
  assert.deepEqual(await searchPage(f.viewer, { q: f.prefix, project: String(f.b), [`cf_${f.visibleField.id}`]: f.visibleValue }),
    [{ project: f.b, id: f.shared }]);
  assert.deepEqual(await searchPage(f.owner, { q: f.prefix, [`cf_${f.visibleField.id}`]: f.visibleValue }),
    [{ project: f.b, id: f.shared }]);
  assert.deepEqual(await searchPage(f.owner, { q: f.prefix, [`cf_${f.privateField.id}`]: f.privateValue }),
    [{ project: f.a, id: f.shared }]);
  // The owner may see A's field, but it cannot act as a B column merely
  // because an A-owned shared task stores that value.
  assert.deepEqual(await searchPage(f.owner, { q: f.prefix, project: String(f.b), [`cf_${f.privateField.id}`]: f.privateValue }), []);
  await request(f.bEditor, "POST", "/api/task-values", 403, { task_id: f.shared, field_id: Number(f.restrictedField.id), value: "Unauthorized overwrite" });
});

function unzipEntry(archive, expectedName) {
  let offset = 0;
  while (offset + 30 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8);
    const compressed = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 30, offset + 30 + nameLength).toString();
    const dataStart = offset + 30 + nameLength + extraLength;
    if (name === expectedName) return (method === 8 ? inflateRawSync(archive.subarray(dataStart, dataStart + compressed)) : archive.subarray(dataStart, dataStart + compressed)).toString();
    offset = dataStart + compressed;
  }
  assert.fail(`Missing XLSX entry ${expectedName}`);
}

function xlsxRows(archive) {
  const xml = unzipEntry(archive, "xl/worksheets/sheet1.xml");
  const decode = (text) => text.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" })[entity]);
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) =>
    [...row[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((cell) => decode(cell[1])));
}

test("EV05 B JSON export includes visible homes and compatible children, only B sections/fields and values", async () => {
  const f = await multiHomeFixture();
  for (const cookie of [f.viewer, f.commenter, f.bEditor]) {
    const result = await request(cookie, "GET", `/api/projects/${f.b}/export?format=json`, 200);
    assert.deepEqual(result.tasks.map((row) => Number(row.id)).sort((a, b) => a - b),
      [f.shared, f.sharedNull, f.local, f.compatibleChild, f.explicitChild].sort((a, b) => a - b));
    const shared = result.tasks.find((row) => Number(row.id) === f.shared);
    assert.equal(Number(shared.section_id), Number(f.memberSection.id));
    assert.equal(result.tasks.find((row) => Number(row.id) === f.sharedNull).section_id, null);
    assert.equal(Number(result.tasks.find((row) => Number(row.id) === f.compatibleChild).section_id), Number(f.memberSection.id));
    assert.deepEqual(Object.keys(shared.custom_values_by_field).sort(), [String(f.visibleField.id), String(f.restrictedField.id)].sort());
    assert.equal(shared.custom_values_by_field[f.visibleField.id], f.visibleValue);
    assert.equal(shared.custom_values_by_field[f.restrictedField.id], "Restricted readable value");
    assert.ok(result.custom_fields.every((field) => Number(field.id) !== Number(f.privateField.id)));
    assert.equal(JSON.stringify(result).includes(f.privateValue), false);
    assert.equal(JSON.stringify(result).includes(f.privateField.name), false);
    assert.equal(JSON.stringify(result).includes(f.primarySection.name), false);
  }
});

test("EV05 B CSV and XLSX exports share the same effective section and public-column projection", async () => {
  const f = await multiHomeFixture();
  for (const format of ["csv", "xlsx"]) {
    const response = await http(`/api/projects/${f.b}/export?format=${format}`, { cookie: f.viewer });
    assert.equal(response.status, 200);
    const rows = format === "csv" ? parseCsv(await response.text()) : xlsxRows(Buffer.from(await response.arrayBuffer()));
    const [header, ...data] = rows;
    assert.ok(header.includes(f.visibleField.name));
    assert.ok(header.includes(f.restrictedField.name));
    assert.equal(header.includes(f.privateField.name), false);
    const names = data.map((row) => row[2]);
    assert.deepEqual([...names].sort(), ["shared", "unsectioned shared", "local member", "compatible child", "explicit foreign child"].map((name) => `${f.prefix} ${name}`).sort());
    const shared = data.find((row) => row[2] === `${f.prefix} shared`);
    assert.equal(shared[0], f.memberSection.name);
    assert.equal(shared[header.indexOf(f.visibleField.name)], f.visibleValue);
    assert.equal(data.find((row) => row[2] === `${f.prefix} unsectioned shared`)[0], "");
    assert.equal(JSON.stringify(rows).includes(f.privateValue), false);
    assert.equal(JSON.stringify(rows).includes(f.primarySection.name), false);
  }
});
