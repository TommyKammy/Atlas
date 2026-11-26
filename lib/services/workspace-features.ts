/**
 * Workspace-level feature switches (docs/dev-projects-phase0.md §9, §12).
 * Development projects are allowed per workspace by an administrator; a
 * missing row means the feature is off.
 */
import { badRequest } from "../api/errors";
import { audit } from "../audit";
import { db, withTransaction, type Queryable } from "../db";

export type WorkspaceFeatures = { dev_projects: boolean };

export async function getWorkspaceFeatures(workspaceId: number, q: Queryable = db): Promise<WorkspaceFeatures> {
  const result = await q.query(
    "SELECT dev_projects FROM workspace_features WHERE workspace_id = $1::bigint",
    [workspaceId],
  );
  return { dev_projects: result.rows[0]?.dev_projects === true };
}

/** Whether the workspace that owns a project allows development projects. */
export async function devProjectsAllowedForProject(projectId: number, q: Queryable = db): Promise<boolean> {
  const result = await q.query(
    `SELECT COALESCE(f.dev_projects, false) AS allowed
       FROM projects p LEFT JOIN workspace_features f ON f.workspace_id = p.workspace_id
      WHERE p.id = $1::bigint`,
    [projectId],
  );
  return result.rows[0]?.allowed === true;
}

/**
 * Change the switches given in `patch`. The caller authorizes the
 * administrator. Each change is audited; an unchanged value records nothing.
 */
export async function updateWorkspaceFeatures(
  uid: number,
  workspaceId: number,
  patch: unknown,
): Promise<WorkspaceFeatures> {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw badRequest("invalid features patch");
  const value = (patch as Record<string, unknown>).dev_projects;
  if (typeof value !== "boolean") throw badRequest("dev_projects must be a boolean");
  return withTransaction(async (q) => {
    const before = await q.query(
      `INSERT INTO workspace_features (workspace_id) VALUES ($1::bigint)
       ON CONFLICT (workspace_id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id
       RETURNING dev_projects`,
      [workspaceId],
    );
    if (before.rows[0].dev_projects !== value) {
      await q.query(
        `UPDATE workspace_features SET dev_projects = $2, updated_at = now(), updated_by = $3
          WHERE workspace_id = $1::bigint`,
        [workspaceId, value, uid],
      );
      await audit(uid, value ? "workspace.feature_enable" : "workspace.feature_disable", {
        entity: "workspace",
        entityId: workspaceId,
        workspaceId,
        summary: "dev_projects",
      }, q);
    }
    return getWorkspaceFeatures(workspaceId, q);
  });
}
