import { withTransaction } from "../db";
import { ApiError, badRequest, notFound } from "../api/errors";
import { getSidebarProjects } from "../repositories/sidebar-projects";
import { moveListItem } from "../list-order";

export async function reorderSidebarProjects(userId: number, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw badRequest("並べ替え先が無効です");
  const input = value as Record<string, unknown>;
  const { workspace_id: workspaceId, project_id: projectId, target_id: targetId, placement } = input;
  if (![workspaceId, projectId, targetId].every(id => typeof id === "number" && Number.isSafeInteger(id) && id > 0) ||
    (placement !== "before" && placement !== "after")) throw badRequest("並べ替え先が無効です");
  return withTransaction(async q => {
    // Serialize this user's relative moves across tabs. FK key-share locks from
    // unrelated project operations remain compatible with NO KEY UPDATE.
    const user = await q.query("SELECT id FROM users WHERE id = $1 AND deactivated_at IS NULL FOR NO KEY UPDATE", [userId]);
    if (!user.rowCount) throw new ApiError(403, "ユーザーを確認できません", "forbidden");
    const projects = await getSidebarProjects(workspaceId as number, userId, q);
    const before = projects.map(project => project.id);
    if (!before.includes(projectId as number) || !before.includes(targetId as number)) throw notFound("プロジェクトが見つかりません");
    const order = moveListItem(before, projectId as number, targetId as number, placement);
    if (order.some((id, index) => id !== before[index])) {
      await q.query(`INSERT INTO user_sidebar_project_order (user_id, project_id, position)
        SELECT $1, item.id, item.position FROM unnest($2::bigint[]) WITH ORDINALITY AS item(id, position)
        ON CONFLICT (user_id, project_id) DO UPDATE SET position = EXCLUDED.position
        WHERE user_sidebar_project_order.position IS DISTINCT FROM EXCLUDED.position`, [userId, order]);
    }
    return { order };
  });
}
