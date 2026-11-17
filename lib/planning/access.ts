import type { Queryable } from "../db";
import { ApiError, badRequest, forbidden, notFound } from "../api/errors";
import type { PlanningAccess } from "./types";

export type PlanningAccessRecord = PlanningAccess & {
  portfolioId: number;
  portfolioName: string;
  workspaceId: number;
  ownerId: number | null;
};

export async function loadPlanningAccess(
  q: Queryable,
  portfolioId: number,
  workspaceId: number,
  userId: number,
): Promise<PlanningAccessRecord | null> {
  const result = await q.query(
    `SELECT p.id, p.name, p.workspace_id, p.owner_id,
       (EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = $3 AND u.is_admin AND u.deactivated_at IS NULL
        ) OR p.owner_id = $3) AS can_edit,
       EXISTS (
         SELECT 1 FROM portfolio_plan_viewers v
         WHERE v.portfolio_id = p.id AND v.user_id = $3
       ) AS explicit_viewer
     FROM portfolios p
     WHERE p.id = $1::bigint AND p.workspace_id = $2::bigint`,
    [portfolioId, workspaceId, userId],
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  const canEdit = row.can_edit === true;
  return {
    portfolioId: Number(row.id),
    portfolioName: String(row.name),
    workspaceId: Number(row.workspace_id),
    ownerId: row.owner_id === null || row.owner_id === undefined ? null : Number(row.owner_id),
    canView: canEdit || row.explicit_viewer === true,
    canEdit,
    canManageViewers: canEdit,
    canEditData: canEdit,
  };
}

export async function requirePlanningAccess(
  q: Queryable,
  portfolioId: number,
  workspaceId: number,
  userId: number,
): Promise<PlanningAccessRecord> {
  const access = await loadPlanningAccess(q, portfolioId, workspaceId, userId);
  if (!access) throw notFound("ポートフォリオが見つかりません");
  if (!access.canView) throw forbidden("この投資計画を表示する権限がありません");
  return access;
}

export async function requirePlanningEditor(
  q: Queryable,
  portfolioId: number,
  workspaceId: number,
  userId: number,
): Promise<PlanningAccessRecord> {
  const access = await requirePlanningAccess(q, portfolioId, workspaceId, userId);
  if (!access.canEdit) throw forbidden("この投資計画を編集する権限がありません");
  return access;
}

/** Serialize plan mutations for one portfolio before reading or changing revisions. */
export async function lockPlanningPortfolio(
  q: Queryable,
  portfolioId: number,
  workspaceId: number,
): Promise<void> {
  const result = await q.query(
    `SELECT id FROM portfolios
     WHERE id = $1::bigint AND workspace_id = $2::bigint
     FOR NO KEY UPDATE`,
    [portfolioId, workspaceId],
  );
  if (result.rowCount === 0) throw notFound("ポートフォリオが見つかりません");
}

export type LockedPeriod = {
  id: number;
  year: number;
  quarter: 1 | 2 | 3 | 4;
  budgetYen: number;
  revision: number;
};

export async function lockPlanningPeriod(
  q: Queryable,
  periodId: number,
  portfolioId: number,
  workspaceId: number,
): Promise<LockedPeriod> {
  const result = await q.query(
    `SELECT id, year, quarter, budget_yen, revision
     FROM portfolio_plan_periods
     WHERE id = $1::bigint AND portfolio_id = $2::bigint AND workspace_id = $3::bigint
     FOR UPDATE`,
    [periodId, portfolioId, workspaceId],
  );
  if (result.rowCount === 0) throw notFound("対象四半期が見つかりません");
  const row = result.rows[0];
  return {
    id: Number(row.id),
    year: Number(row.year),
    quarter: Number(row.quarter) as 1 | 2 | 3 | 4,
    budgetYen: Number(row.budget_yen),
    revision: Number(row.revision),
  };
}

export function staleRevisionError(currentRevision: number): ApiError {
  return new ApiError(
    409,
    "他の担当者が内容を更新しました。最新の内容を確認してください",
    "stale_revision",
    { currentRevision },
  );
}

export function planRestrictedError(): ApiError {
  return forbidden(
    "閲覧権限のない元プロジェクトがあるため、合計・需給の編集や採用はできません。全案件の元プロジェクトの閲覧権限が必要です",
  );
}

export async function assertRevision(current: number, requested: number): Promise<void> {
  if (current !== requested) throw staleRevisionError(current);
}

/** Projects visible under the existing Atlas project-membership convention. */
export async function visibleProjectIds(
  q: Queryable,
  userId: number,
  workspaceId: number,
  projectIds: readonly number[],
): Promise<Set<number>> {
  const ids = [...new Set(projectIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return new Set();
  const result = await q.query(
    `SELECT p.id
     FROM projects p
     WHERE p.workspace_id = $3::bigint
       AND p.deleted_at IS NULL
       AND p.id = ANY($2::bigint[])
       AND (
         EXISTS (
           SELECT 1 FROM users u
           WHERE u.id = $1 AND u.is_admin AND u.deactivated_at IS NULL
         )
         OR EXISTS (
           SELECT 1 FROM project_members m
           WHERE m.project_id = p.id AND m.user_id = $1
         )
       )`,
    [userId, ids, workspaceId],
  );
  return new Set(result.rows.map((row) => Number(row.id)));
}

export async function assertPeriodFullyVisible(
  q: Queryable,
  periodId: number,
  portfolioId: number,
  workspaceId: number,
  userId: number,
): Promise<void> {
  const result = await q.query(
    `SELECT DISTINCT i.linked_project_id
     FROM portfolio_initiative_estimates e
     JOIN portfolio_initiatives i
       ON i.id = e.initiative_id AND i.portfolio_id = e.portfolio_id
     WHERE e.period_id = $1::bigint
       AND e.portfolio_id = $2::bigint
       AND i.linked_project_id IS NOT NULL`,
    [periodId, portfolioId],
  );
  const linked = result.rows.map((row) => Number(row.linked_project_id));
  const visible = await visibleProjectIds(q, userId, workspaceId, linked);
  if (linked.some((id) => !visible.has(id))) throw planRestrictedError();
}

export async function assertPortfolioFullyVisible(
  q: Queryable,
  portfolioId: number,
  workspaceId: number,
  userId: number,
): Promise<void> {
  const result = await q.query(
    `SELECT DISTINCT i.linked_project_id
     FROM portfolio_initiatives i
     JOIN portfolio_initiative_estimates e
       ON e.initiative_id = i.id AND e.portfolio_id = i.portfolio_id
     WHERE i.portfolio_id = $1::bigint AND i.linked_project_id IS NOT NULL`,
    [portfolioId],
  );
  const linked = result.rows.map((row) => Number(row.linked_project_id));
  const visible = await visibleProjectIds(q, userId, workspaceId, linked);
  if (linked.some((id) => !visible.has(id))) throw planRestrictedError();
}

/**
 * A linked initiative may only point at a live project that is already a member
 * of this portfolio and visible to the editor under project-member rules.
 */
export async function resolveLinkableProject(
  q: Queryable,
  portfolioId: number,
  workspaceId: number,
  userId: number,
  projectId: number,
): Promise<{ id: number; name: string }> {
  const result = await q.query(
    `SELECT p.id, p.name,
       (
         EXISTS (
           SELECT 1 FROM users u
           WHERE u.id = $3 AND u.is_admin AND u.deactivated_at IS NULL
         )
         OR EXISTS (
           SELECT 1 FROM project_members m
           WHERE m.project_id = p.id AND m.user_id = $3
         )
       ) AS visible
     FROM projects p
     JOIN portfolio_items i ON i.project_id = p.id
     WHERE i.portfolio_id = $1::bigint
       AND p.workspace_id = $2::bigint
       AND p.id = $4::bigint
       AND p.deleted_at IS NULL`,
    [portfolioId, workspaceId, userId, projectId],
  );
  if (result.rowCount === 0) {
    throw badRequest("選択した元プロジェクトはこの共有ポートフォリオのメンバーではありません");
  }
  if (result.rows[0].visible !== true) {
    throw forbidden("元プロジェクトの閲覧権限がありません");
  }
  return { id: Number(result.rows[0].id), name: String(result.rows[0].name) };
}
