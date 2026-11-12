import { db, type Queryable } from "../db";

export type SidebarProject = { id: number; name: string; color: string | null; icon: string | null };

/** Sidebar-only order, independent of search, favorites and recent navigation. */
export async function getSidebarProjects(workspaceId: number, userId: number, q: Queryable = db): Promise<SidebarProject[]> {
  const result = await q.query(`SELECT p.id, p.name, p.color, p.icon
    FROM projects p
    LEFT JOIN user_sidebar_project_order o ON o.project_id = p.id AND o.user_id = $2
    WHERE p.workspace_id = $1 AND p.archived_at IS NULL AND p.deleted_at IS NULL
      AND (EXISTS (SELECT 1 FROM users u WHERE u.id = $2 AND u.is_admin)
        OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $2))
    ORDER BY o.position NULLS LAST, p.id`, [workspaceId, userId]);
  return result.rows;
}
