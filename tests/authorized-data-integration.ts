/** Run only inside the labeled disposable app, after the host E2E guard succeeds. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import {
  readKnowledge, readKnowledgeHistory, listKnowledge, listKnowledgeTrash, getProjectKnowledge,
  searchTasksAdvanced, searchProjectsGlobal, searchMessagesGlobal, searchKnowledgeGlobal, searchFilesGlobal,
} from "../lib/services/authorized-data";
import type { AdvancedSearchFilters } from "../lib/repositories/search";

async function main() {
  assert.equal(process.env.DATABASE_URL, "postgres://atlas:atlas@db:5432/atlas_e2e");
  assert.match(process.env.ATLAS_E2E_MARKER ?? "", /^[a-f0-9]{32}$/);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    assert.equal((await pool.query("SELECT marker FROM atlas_e2e_identity")).rows[0]?.marker, process.env.ATLAS_E2E_MARKER);
    // Bind the real SQL to this disposable pool without a Next request context.
    db.query = (sql, params) => pool.query(sql, params);
    const token = `Gateway-${randomUUID()}`;
    const users = (await pool.query(`INSERT INTO users(name, is_admin) VALUES ($1, false), ($2, false), ($3, true), ($4, true) RETURNING id`,
      [`${token} viewer`, `${token} outsider`, `${token} admin`, `${token} inactive`])).rows;
    const [viewer, outsider, admin, inactive] = users.map(u => ({ userId: Number(u.id) }));
    await pool.query("UPDATE users SET deactivated_at = now() WHERE id = $1", [inactive.userId]);
    const projects = (await pool.query("INSERT INTO projects(workspace_id,name) VALUES(1,$1),(1,$2),(1,$3) RETURNING id", [token, `${token} private`, `${token} deleted`])).rows;
    const [visible, hidden, removed] = projects.map(p => Number(p.id));
    await pool.query("INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'viewer'),($3,$2,'viewer')", [visible, viewer.userId, removed]);
    await pool.query("UPDATE projects SET deleted_at = now() WHERE id = $1", [removed]);
    const notes = (await pool.query(`INSERT INTO project_knowledge(project_id,title,body,deleted_at)
      VALUES($1,$4,'public',NULL),($2,$4,'private',NULL),($3,$4,'removed project',NULL),($1,$4,'trash',now()) RETURNING id`,
    [visible, hidden, removed, token])).rows;
    const [noteId, privateId, removedId, trashId] = notes.map(n => Number(n.id));
    await pool.query(`INSERT INTO knowledge_revisions(knowledge_id,revision,title,body,saved_at) VALUES($1,0,$2,'history',now())`, [noteId, token]);
    const task = (await pool.query("INSERT INTO tasks(project_id,name) VALUES($1,$2) RETURNING id", [hidden, token])).rows[0];
    await pool.query("INSERT INTO task_project_memberships(task_id,project_id) VALUES($1,$2)", [task.id, visible]);
    await pool.query("INSERT INTO project_messages(project_id,title,body) VALUES($1,$3,'public'),($2,$3,'private')", [visible, hidden, token]);
    await pool.query("INSERT INTO task_attachments(task_id,file_name,stored_name,mime_type,size_bytes) VALUES($1,$2,$3,'text/plain',1)", [task.id, token, `${token}.txt`]);
    const filters: AdvancedSearchFilters = { q: token, projectId: null, assigneeId: null, completed: "all", status: null,
      dueFrom: null, dueTo: null, createdFrom: null, createdTo: null, completedFrom: null, completedTo: null, custom: [] };
    assert.equal((await readKnowledge(noteId, viewer)).body, "public");
    assert.equal((await readKnowledgeHistory(noteId, viewer)).length, 1);
    assert.deepEqual((await listKnowledge(visible, viewer)).map(n => n.id), [noteId]);
    assert.deepEqual((await getProjectKnowledge(visible, viewer, privateId)).map(n => n.id), [noteId]);
    for (const id of [privateId, removedId, trashId]) await assert.rejects(readKnowledge(id, viewer), { status: 404 });
    assert.deepEqual(await listKnowledgeTrash(visible, viewer), []);
    assert.deepEqual((await listKnowledgeTrash(visible, admin)).map(n => n.id), [trashId]);
    assert.deepEqual((await searchKnowledgeGlobal(1, token, viewer)).map(n => n.id), [noteId]);
    assert.deepEqual((await searchKnowledgeGlobal(999999, token, admin)), []);
    assert.equal((await searchKnowledgeGlobal(1, token, admin)).length, 2);
    const paginated = await searchKnowledgeGlobal(1, token, viewer, { page: 1, pageSize: 20 });
    assert.equal(paginated.total, 1); assert.deepEqual(paginated.items.map(n => n.id), [noteId]);
    assert.equal((await searchProjectsGlobal(1, token, viewer)).length, 1);
    assert.equal((await searchMessagesGlobal(1, token, viewer)).length, 1);
    const tasks = await searchTasksAdvanced(1, filters, viewer);
    assert.equal(tasks.length, 1); assert.equal(tasks[0].project_id, visible);
    const files = await searchFilesGlobal(1, token, viewer);
    assert.equal(files.length, 1); assert.equal(files[0].project_id, visible);
    for (const actor of [outsider, inactive]) {
      await assert.rejects(readKnowledge(noteId, actor), { status: 404 });
      await assert.rejects(readKnowledgeHistory(noteId, actor), { status: 404 });
      assert.deepEqual(await listKnowledge(visible, actor), []);
      assert.deepEqual(await listKnowledgeTrash(visible, actor), []);
      assert.deepEqual(await searchKnowledgeGlobal(1, token, actor), []);
      assert.deepEqual(await searchProjectsGlobal(1, token, actor), []);
      assert.deepEqual(await searchMessagesGlobal(1, token, actor), []);
      assert.deepEqual(await searchTasksAdvanced(1, filters, actor), []);
      assert.deepEqual(await searchFilesGlobal(1, token, actor), []);
    }
    await pool.query(`INSERT INTO project_knowledge(project_id,title,body,deleted_at)
      SELECT $1,$2 || n,'retained',now() FROM generate_series(1,101) n`, [visible, token]);
    const firstPage = await listKnowledgeTrash(visible, admin);
    const lastPage = await listKnowledgeTrash(visible, admin, 100);
    assert.equal(firstPage.length, 100); assert.equal(lastPage.length, 2);
    assert.equal(new Set([...firstPage, ...lastPage].map(n => n.id)).size, 102);
    assert.deepEqual(await listKnowledgeTrash(visible, admin, 200), []);
    assert.deepEqual((await listKnowledge(visible, viewer)).map(n => n.id), [noteId]);
    await pool.query("DELETE FROM project_members WHERE user_id = $1", [viewer.userId]);
    await assert.rejects(readKnowledge(noteId, viewer), { status: 404 });
    await assert.rejects(readKnowledgeHistory(noteId, viewer), { status: 404 });
    assert.deepEqual(await searchKnowledgeGlobal(1, token, viewer), []);
    assert.deepEqual(await searchTasksAdvanced(1, filters, viewer), []);
    assert.deepEqual(await searchFilesGlobal(1, token, viewer), []);
    console.log("PASS authorized gateway: active actors, private projects, multi-home, history, trash, deactivation, workspace scope and live revocation");
    // Fixtures live only in the disposable stack; remove the whole project-owned graph.
    await pool.query("DELETE FROM projects WHERE id = ANY($1::bigint[])", [[visible, hidden, removed]]);
    await pool.query("DELETE FROM users WHERE id = ANY($1::bigint[])", [users.map(u => u.id)]);
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
