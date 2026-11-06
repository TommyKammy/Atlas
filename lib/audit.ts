import { db } from "./db";

// Workspace audit trail (best-effort; never fails the mutation itself).
export async function audit(
  actorId: number,
  action: string,
  opts: { entity: string; entityId?: number | string | null; projectId?: number | string | null; summary?: string },
) {
  try {
    let workspaceId: number | null = null;
    let projectId: number | null =
      opts.projectId === undefined || opts.projectId === null ? null : Number(opts.projectId);
    if (projectId === null && opts.entity === "task" && opts.entityId != null) {
      const r = await db.query("SELECT project_id FROM tasks WHERE id = $1::bigint", [opts.entityId]);
      projectId = r.rows[0]?.project_id ?? null;
    }
    if (projectId !== null) {
      const r = await db.query("SELECT workspace_id FROM projects WHERE id = $1", [projectId]);
      workspaceId = r.rows[0]?.workspace_id ?? null;
    }
    await db.query(
      `INSERT INTO audit_log (workspace_id, actor_id, action, entity, entity_id, project_id, summary)
       VALUES ($1, $2, $3, $4, $5::bigint, $6, $7)`,
      [workspaceId, actorId, action, opts.entity, opts.entityId ?? null, projectId, opts.summary ?? ""],
    );
  } catch {
    // advisory only
  }
}

export type AuditRow = {
  id: number;
  actor_name: string | null;
  action: string;
  entity: string;
  entity_id: number | null;
  project_id: number | null;
  project_name: string | null;
  summary: string;
  created_at: string;
};

export async function getAuditLog(workspaceId: number, limit = 200): Promise<AuditRow[]> {
  const r = await db.query(
    `SELECT a.id, u.name AS actor_name, a.action, a.entity, a.entity_id,
       a.project_id, p.name AS project_name, a.summary, a.created_at::text AS created_at
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.actor_id
     LEFT JOIN projects p ON p.id = a.project_id
     WHERE a.workspace_id = $1
     ORDER BY a.id DESC LIMIT $2`,
    [workspaceId, limit],
  );
  return r.rows;
}
