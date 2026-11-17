import { cache } from "react";
import { db } from "../db";
import type { User } from "../data";

export function directoryAccess(userAlias: string, viewer: string, workspace: string) {
  return `EXISTS (SELECT 1 FROM users viewer
    WHERE viewer.id = ${viewer} AND viewer.deactivated_at IS NULL
      AND (NOT viewer.is_guest OR viewer.id = ${userAlias}.id OR EXISTS (
        SELECT 1 FROM project_members mine
        JOIN projects p ON p.id = mine.project_id AND p.workspace_id = ${workspace}
          AND p.deleted_at IS NULL
        JOIN project_members peer ON peer.project_id = mine.project_id AND peer.user_id = ${userAlias}.id
        WHERE mine.user_id = viewer.id
      )))`;
}

export const getDirectoryUsers = cache(async (workspaceId: number, viewerId: number): Promise<User[]> => {
  const r = await db.query(
    `SELECT u.id, u.name, u.email, u.title, u.avatar_url, u.is_guest, u.is_admin,
       u.role_id, u.totp_enabled, u.deactivated_at::text AS deactivated_at,
       r.key AS role_key, r.name AS role_name
     FROM users u LEFT JOIN workspace_roles r ON r.id = u.role_id
     WHERE u.deactivated_at IS NULL AND ${directoryAccess("u", "$2", "$1")}
     ORDER BY u.id`,
    [workspaceId, viewerId],
  );
  return r.rows;
});
