import { withTransaction, type Queryable } from "../db";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../api/errors";
import {
  assertPeriodFullyVisible,
  assertPortfolioFullyVisible,
  assertRevision,
  loadEligiblePlanParticipants,
  lockPlanningPeriod,
  lockPlanningPortfolio,
  requirePlanningAccess,
  requirePlanningEditor,
  resolveLinkableProject,
  visibleProjectIds,
} from "./access";
import {
  invalidProposalReview,
  effectiveProposalStatus,
  isOpenProposalStatus,
  proposalInitialReviewOutcome,
  proposalInitialStatus,
  proposalStatusAfterDecision,
  proposalStatusLabel,
  proposalSubmissionBlock,
} from "./approvals";
import { buildDecisionSnapshot, type CalculationInitiative } from "./calculations";
import {
  hashPlanningSnapshot,
  isPlanningDecisionSnapshot,
  samePlanningPlanContent,
  snapshotProjectIds,
} from "./decision-snapshot";
import { recordPlanAction } from "./audit";
import {
  planInitiativeOwnerChange,
  resolveActiveInitiativeOwner,
} from "./owner";
import {
  loadApprovalSettings,
  loadCapacities,
  loadPeriodInitiatives,
  loadRoles,
  loadScenarios,
} from "./repository";
import type {
  PlanningInitiativeKind,
  PlanningProposalDecisionAction,
  PlanningProposalStatus,
  PlanningQuarter,
} from "./types";
import {
  parseName,
  parseRoleEdits,
  parseRoleNames,
  type ParsedCapacityInput,
  type ParsedDemandInput,
  type ParsedRoleEdit,
} from "./validation";

export { reviewProposal } from "./proposal-review";

async function bumpAllPeriodRevisions(q: Queryable, portfolioId: number): Promise<void> {
  await q.query(
    `UPDATE portfolio_plan_periods
     SET revision = revision + 1, updated_at = now()
     WHERE portfolio_id = $1::bigint`,
    [portfolioId],
  );
}

async function bumpPeriodRevision(q: Queryable, periodId: number, portfolioId: number): Promise<number> {
  const result = await q.query(
    `UPDATE portfolio_plan_periods
     SET revision = revision + 1, updated_at = now()
     WHERE id = $1::bigint AND portfolio_id = $2::bigint
     RETURNING revision`,
    [periodId, portfolioId],
  );
  if (result.rowCount === 0) throw notFound("対象四半期が見つかりません");
  return Number(result.rows[0].revision);
}

async function currentRevision(q: Queryable, periodId: number, portfolioId: number): Promise<number> {
  const result = await q.query(
    `SELECT revision FROM portfolio_plan_periods
     WHERE id = $1::bigint AND portfolio_id = $2::bigint`,
    [periodId, portfolioId],
  );
  if (result.rowCount === 0) throw notFound("対象四半期が見つかりません");
  return Number(result.rows[0].revision);
}

async function countOpenProposals(
  q: Queryable,
  portfolioId: number,
  periodId: number | null,
): Promise<number> {
  const result = await q.query(
    `SELECT COUNT(*)::int AS n
     FROM portfolio_plan_proposals
     WHERE portfolio_id = $1::bigint
       AND status IN ('submitted', 'under_review', 'pending_decision')
       AND ($2::bigint IS NULL OR period_id = $2::bigint)`,
    [portfolioId, periodId],
  );
  return Number(result.rows[0].n);
}

async function validateDemandRoles(
  q: Queryable,
  portfolioId: number,
  demands: readonly ParsedDemandInput[],
): Promise<Set<number>> {
  const roles = await loadRoles(q, portfolioId);
  const roleIds = new Set(roles.map((role) => role.id));
  for (const demand of demands) {
    if (!roleIds.has(demand.roleId)) {
      throw badRequest("指定された職種がこのポートフォリオに存在しません");
    }
  }
  return roleIds;
}

async function validateProjectLink(
  q: Queryable,
  input: {
    portfolioId: number;
    workspaceId: number;
    userId: number;
    linkedProjectId: number | null;
    initiativeId: number | null;
  },
): Promise<void> {
  if (input.linkedProjectId === null) return;
  await resolveLinkableProject(
    q,
    input.portfolioId,
    input.workspaceId,
    input.userId,
    input.linkedProjectId,
  );
  const duplicate = await q.query(
    `SELECT id FROM portfolio_initiatives
     WHERE portfolio_id = $1::bigint
       AND linked_project_id = $2::bigint
       AND ($3::bigint IS NULL OR id <> $3::bigint)`,
    [input.portfolioId, input.linkedProjectId, input.initiativeId],
  );
  if (duplicate.rowCount !== 0) {
    throw new ApiError(
      409,
      "この元プロジェクトは既に別の案件に紐付いています",
      "project_link_exists",
    );
  }
}

async function replaceDemands(
  q: Queryable,
  input: {
    periodId: number;
    initiativeId: number;
    workspaceId: number;
    portfolioId: number;
    demands: readonly ParsedDemandInput[];
  },
): Promise<void> {
  await q.query(
    `DELETE FROM portfolio_initiative_demands
     WHERE period_id = $1::bigint AND initiative_id = $2::bigint`,
    [input.periodId, input.initiativeId],
  );
  const rows = input.demands.filter(
    (demand): demand is ParsedDemandInput & { days: number } => demand.days !== null,
  );
  if (rows.length === 0) return;
  await q.query(
    `INSERT INTO portfolio_initiative_demands
       (period_id, initiative_id, role_id, workspace_id, portfolio_id, month_index, days)
     SELECT $1::bigint, $2::bigint, role_id, $3::bigint, $4::bigint, month_index, days
     FROM unnest($5::bigint[], $6::smallint[], $7::numeric[])
       AS input(role_id, month_index, days)`,
    [
      input.periodId,
      input.initiativeId,
      input.workspaceId,
      input.portfolioId,
      rows.map((row) => row.roleId),
      rows.map((row) => row.monthIndex),
      rows.map((row) => row.days),
    ],
  );
}

export async function createPlanningPeriod(input: {
  workspaceId: number;
  portfolioId: number;
  userId: number;
  year: number;
  quarter: PlanningQuarter;
  budgetYen: number;
  roleNames: string[];
}): Promise<{ periodId: number; revision: number; year: number; quarter: PlanningQuarter }> {
  const roleNames = parseRoleNames(input.roleNames);
  return withTransaction(async (q) => {
    await lockPlanningPortfolio(q, input.portfolioId, input.workspaceId);
    await requirePlanningEditor(q, input.portfolioId, input.workspaceId, input.userId);

    const existing = await q.query(
      `SELECT id FROM portfolio_plan_periods
       WHERE portfolio_id = $1::bigint AND year = $2::int AND quarter = $3::smallint`,
      [input.portfolioId, input.year, input.quarter],
    );
    if (existing.rowCount !== 0) {
      throw conflict("この四半期は既に作成されています");
    }

    const inserted = await q.query(
      `INSERT INTO portfolio_plan_periods
         (workspace_id, portfolio_id, year, quarter, budget_yen, created_by)
       VALUES ($1::bigint, $2::bigint, $3::int, $4::smallint, $5::bigint, $6::bigint)
       RETURNING id, revision`,
      [
        input.workspaceId,
        input.portfolioId,
        input.year,
        input.quarter,
        input.budgetYen,
        input.userId,
      ],
    );
    const periodId = Number(inserted.rows[0].id);

    let insertedRoles = 0;
    if (roleNames.length > 0) {
      const existingRoles = await loadRoles(q, input.portfolioId);
      const known = new Set(existingRoles.map((role) => role.name.toLocaleLowerCase("ja-JP")));
      let position = existingRoles.reduce((max, role) => Math.max(max, role.position), 0) + 10;
      for (const name of roleNames) {
        if (known.has(name.toLocaleLowerCase("ja-JP"))) continue;
        await q.query(
          `INSERT INTO portfolio_plan_roles
             (workspace_id, portfolio_id, name, position)
           VALUES ($1::bigint, $2::bigint, $3, $4::int)`,
          [input.workspaceId, input.portfolioId, name, position],
        );
        known.add(name.toLocaleLowerCase("ja-JP"));
        position += 10;
        insertedRoles += 1;
      }
    }

    await q.query(
      `INSERT INTO portfolio_plan_scenarios
         (workspace_id, portfolio_id, period_id, slot, name)
       VALUES
         ($1::bigint, $2::bigint, $3::bigint, 0, 'A案'),
         ($1::bigint, $2::bigint, $3::bigint, 1, 'B案')`,
      [input.workspaceId, input.portfolioId, periodId],
    );

    // New roles are portfolio-wide, so they invalidate open edits in existing
    // periods as well. The new period itself stays at revision 1.
    if (insertedRoles > 0) {
      await q.query(
        `UPDATE portfolio_plan_periods
         SET revision = revision + 1, updated_at = now()
         WHERE portfolio_id = $1::bigint AND id <> $2::bigint`,
        [input.portfolioId, periodId],
      );
    }

    await recordPlanAction(q, input, "period_create", "portfolio_plan_period", periodId, String(input.year) + "-Q" + input.quarter);
    return {
      periodId,
      revision: Number(inserted.rows[0].revision),
      year: input.year,
      quarter: input.quarter,
    };
  });
}

export async function updatePeriodBudget(input: {
  workspaceId: number;
  portfolioId: number;
  userId: number;
  periodId: number;
  revision: number;
  budgetYen: number;
}): Promise<{ revision: number }> {
  return withTransaction(async (q) => {
    await lockPlanningPortfolio(q, input.portfolioId, input.workspaceId);
    await requirePlanningEditor(q, input.portfolioId, input.workspaceId, input.userId);
    const period = await lockPlanningPeriod(q, input.periodId, input.portfolioId, input.workspaceId);
    await assertRevision(period.revision, input.revision);
    await assertPeriodFullyVisible(
      q,
      input.periodId,
      input.portfolioId,
      input.workspaceId,
      input.userId,
    );
    const revision = await bumpPeriodRevision(q, input.periodId, input.portfolioId);
    await q.query(
      `UPDATE portfolio_plan_periods SET budget_yen = $2::bigint WHERE id = $1::bigint`,
      [input.periodId, input.budgetYen],
    );
    await recordPlanAction(q, input, "budget_update", "portfolio_plan_period", input.periodId, period.budgetYen + "円 → " + input.budgetYen + "円");
    return { revision };
  });
}

export async function saveRoleEdits(input: {
  workspaceId: number;
  portfolioId: number;
  userId: number;
  periodId: number;
  revision: number;
  roles: ParsedRoleEdit[];
}): Promise<{ revision: number }> {
  const edits = parseRoleEdits(input.roles);
  return withTransaction(async (q) => {
    await lockPlanningPortfolio(q, input.portfolioId, input.workspaceId);
    await requirePlanningEditor(q, input.portfolioId, input.workspaceId, input.userId);
    const period = await lockPlanningPeriod(q, input.periodId, input.portfolioId, input.workspaceId);
    await assertRevision(period.revision, input.revision);
    await assertPortfolioFullyVisible(q, input.portfolioId, input.workspaceId, input.userId);

    const existing = await loadRoles(q, input.portfolioId);
    const existingById = new Map(existing.map((role) => [role.id, role]));
    const keptIds = new Set<number>();
    for (const edit of edits) {
      if (edit.id === null) continue;
      if (!existingById.has(edit.id)) {
        throw badRequest("編集対象の職種がこのポートフォリオに存在しません");
      }
      keptIds.add(edit.id);
    }
    const removed = existing.filter((role) => !keptIds.has(role.id)).map((role) => role.id);
    if (removed.length > 0) {
      await q.query(
        `DELETE FROM portfolio_plan_roles
         WHERE portfolio_id = $1::bigint AND id = ANY($2::bigint[])`,
        [input.portfolioId, removed],
      );
    }

    // Move retained names aside first so swapping two role names cannot hit
    // the case-insensitive unique index mid-update.
    if (keptIds.size > 0) {
      await q.query(
        `UPDATE portfolio_plan_roles
         SET name = '__tmp_plan_role_' || md5(random()::text), updated_at = now()
         WHERE portfolio_id = $1::bigint AND id = ANY($2::bigint[])`,
        [input.portfolioId, [...keptIds]],
      );
    }
    let position = 0;
    for (const edit of edits) {
      position += 10;
      if (edit.id === null) {
        await q.query(
          `INSERT INTO portfolio_plan_roles
             (workspace_id, portfolio_id, name, position)
           VALUES ($1::bigint, $2::bigint, $3, $4::int)`,
          [input.workspaceId, input.portfolioId, edit.name, position],
        );
      } else {
        await q.query(
          `UPDATE portfolio_plan_roles
           SET name = $3, position = $4::int, updated_at = now()
           WHERE id = $1::bigint AND portfolio_id = $2::bigint`,
          [edit.id, input.portfolioId, edit.name, position],
        );
      }
    }
    await bumpAllPeriodRevisions(q, input.portfolioId);
    await recordPlanAction(q, input, "roles_update", "portfolio", input.portfolioId);
    return { revision: await currentRevision(q, input.periodId, input.portfolioId) };
  });
}

export async function saveCapacities(input: {
  workspaceId: number;
  portfolioId: number;
  userId: number;
  periodId: number;
  revision: number;
  capacities: ParsedCapacityInput[];
}): Promise<{ revision: number }> {
  return withTransaction(async (q) => {
    await lockPlanningPortfolio(q, input.portfolioId, input.workspaceId);
    await requirePlanningEditor(q, input.portfolioId, input.workspaceId, input.userId);
    const period = await lockPlanningPeriod(q, input.periodId, input.portfolioId, input.workspaceId);
    await assertRevision(period.revision, input.revision);
    await assertPeriodFullyVisible(
      q,
      input.periodId,
      input.portfolioId,
      input.workspaceId,
      input.userId,
    );
    const roles = await loadRoles(q, input.portfolioId);
    const roleIds = new Set(roles.map((role) => role.id));
    for (const capacity of input.capacities) {
      if (!roleIds.has(capacity.roleId)) {
        throw badRequest("指定された職種がこのポートフォリオに存在しません");
      }
    }
    await q.query(
      "DELETE FROM portfolio_plan_capacities WHERE period_id = $1::bigint",
      [input.periodId],
    );
    const rows = input.capacities.filter(
      (capacity): capacity is ParsedCapacityInput & { days: number } => capacity.days !== null,
    );
    if (rows.length > 0) {
      await q.query(
        `INSERT INTO portfolio_plan_capacities
           (period_id, role_id, workspace_id, portfolio_id, month_index, days)
         SELECT $1::bigint, role_id, $2::bigint, $3::bigint, month_index, days
         FROM unnest($4::bigint[], $5::smallint[], $6::numeric[])
           AS input(role_id, month_index, days)`,
        [
          input.periodId,
          input.workspaceId,
          input.portfolioId,
          rows.map((row) => row.roleId),
          rows.map((row) => row.monthIndex),
          rows.map((row) => row.days),
        ],
      );
    }
    const revision = await bumpPeriodRevision(q, input.periodId, input.portfolioId);
    await recordPlanAction(q, input, "capacity_update", "portfolio_plan_period", input.periodId);
    return { revision };
  });
}

export type InitiativeMutationInput = {
  workspaceId: number;
  portfolioId: number;
  userId: number;
  periodId: number;
  revision: number;
  name: string;
  /** Omitted on update means "keep the stored owner", including an inactive one. */
  ownerMemberId?: number | null;
  /** Echoed only to retain an existing legacy free-text name on update. */
  ownerNameHint?: string | null;
  expectedEffect: string;
  kind: PlanningInitiativeKind;
  linkedProjectId: number | null;
  costYen: number | null;
  demands: ParsedDemandInput[];
};

export async function createInitiative(input: InitiativeMutationInput): Promise<{ id: number; revision: number }> {
  const name = parseName(input.name, "案件名", 160);
  if (input.ownerMemberId === null || input.ownerMemberId === undefined) {
    throw badRequest("起案責任者を選択してください");
  }
  const ownerMemberId = input.ownerMemberId;
  const expectedEffect = parseName(input.expectedEffect, "期待効果", 1000);
  return withTransaction(async (q) => {
    await lockPlanningPortfolio(q, input.portfolioId, input.workspaceId);
    await requirePlanningEditor(q, input.portfolioId, input.workspaceId, input.userId);
    const period = await lockPlanningPeriod(q, input.periodId, input.portfolioId, input.workspaceId);
    await assertRevision(period.revision, input.revision);
    await assertPeriodFullyVisible(
      q,
      input.periodId,
      input.portfolioId,
      input.workspaceId,
      input.userId,
    );
    const owner = await resolveActiveInitiativeOwner(q, input.workspaceId, ownerMemberId);
    await validateProjectLink(q, {
      portfolioId: input.portfolioId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      linkedProjectId: input.linkedProjectId,
      initiativeId: null,
    });
    await validateDemandRoles(q, input.portfolioId, input.demands);

    const inserted = await q.query(
      `INSERT INTO portfolio_initiatives
         (workspace_id, portfolio_id, name, owner_member_id, owner_name, expected_effect,
          linked_project_id, created_by)
       VALUES ($1::bigint, $2::bigint, $3, $4::bigint, $5, $6, $7::bigint, $8::bigint)
       RETURNING id`,
      [
        input.workspaceId,
        input.portfolioId,
        name,
        owner.ownerMemberId,
        owner.ownerName,
        expectedEffect,
        input.linkedProjectId,
        input.userId,
      ],
    );
    const initiativeId = Number(inserted.rows[0].id);
    await q.query(
      `INSERT INTO portfolio_initiative_estimates
         (period_id, initiative_id, workspace_id, portfolio_id, kind, cost_yen)
       VALUES ($1::bigint, $2::bigint, $3::bigint, $4::bigint, $5, $6::bigint)`,
      [
        input.periodId,
        initiativeId,
        input.workspaceId,
        input.portfolioId,
        input.kind,
        input.costYen,
      ],
    );
    await replaceDemands(q, {
      periodId: input.periodId,
      initiativeId,
      workspaceId: input.workspaceId,
      portfolioId: input.portfolioId,
      demands: input.demands,
    });
    const revision = await bumpPeriodRevision(q, input.periodId, input.portfolioId);
    await recordPlanAction(q, input, "initiative_create", "portfolio_initiative", initiativeId, name);
    return { id: initiativeId, revision };
  });
}

export async function updateInitiative(
  input: InitiativeMutationInput & { initiativeId: number },
): Promise<{ revision: number }> {
  const name = parseName(input.name, "案件名", 160);
  const expectedEffect = parseName(input.expectedEffect, "期待効果", 1000);
  return withTransaction(async (q) => {
    await lockPlanningPortfolio(q, input.portfolioId, input.workspaceId);
    await requirePlanningEditor(q, input.portfolioId, input.workspaceId, input.userId);
    const period = await lockPlanningPeriod(q, input.periodId, input.portfolioId, input.workspaceId);
    await assertRevision(period.revision, input.revision);
    await assertPeriodFullyVisible(
      q,
      input.periodId,
      input.portfolioId,
      input.workspaceId,
      input.userId,
    );
    const target = await q.query(
      `SELECT i.id, e.kind, i.linked_project_id, i.owner_member_id, i.owner_name
       FROM portfolio_initiatives i
       JOIN portfolio_initiative_estimates e
         ON e.initiative_id = i.id AND e.period_id = $2::bigint
       WHERE i.id = $1::bigint AND i.portfolio_id = $3::bigint`,
      [input.initiativeId, input.periodId, input.portfolioId],
    );
    if (target.rowCount === 0) throw notFound("案件が見つかりません");
    const previousLinkedProjectId =
      target.rows[0].linked_project_id === null || target.rows[0].linked_project_id === undefined
        ? null
        : Number(target.rows[0].linked_project_id);
    if (previousLinkedProjectId !== input.linkedProjectId) {
      await validateProjectLink(q, {
        portfolioId: input.portfolioId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        linkedProjectId: input.linkedProjectId,
        initiativeId: input.initiativeId,
      });
    }
    await validateDemandRoles(q, input.portfolioId, input.demands);

    // Retaining the same member is always allowed, even if that account is now
    // inactive. Only a deliberate change is checked against the active
    // directory. A legacy free-text owner can be kept as-is or associated with
    // a member; it is never guessed or rewritten during an unrelated save.
    const ownerChange = planInitiativeOwnerChange(
      {
        ownerMemberId:
          target.rows[0].owner_member_id === null ||
          target.rows[0].owner_member_id === undefined
            ? null
            : Number(target.rows[0].owner_member_id),
        ownerName: String(target.rows[0].owner_name),
      },
      input.ownerMemberId,
      input.ownerNameHint,
    );
    const owner =
      ownerChange.mode === "keep"
        ? {
            ownerMemberId: ownerChange.ownerMemberId,
            ownerName: ownerChange.ownerName,
          }
        : await resolveActiveInitiativeOwner(q, input.workspaceId, ownerChange.ownerMemberId);

    if (String(target.rows[0].kind) !== input.kind) {
      // Classification belongs to this period's estimate. Reset only this
      // period's scenario selections; earlier quarters keep their own kind.
      await q.query(
        `DELETE FROM portfolio_scenario_inclusions si
         USING portfolio_plan_scenarios s
         WHERE si.scenario_id = s.id
           AND s.period_id = $1::bigint
           AND si.initiative_id = $2::bigint`,
        [input.periodId, input.initiativeId],
      );
    }
    await q.query(
      `UPDATE portfolio_initiatives
       SET name = $2, owner_member_id = $3::bigint, owner_name = $4,
           expected_effect = $5, linked_project_id = $6::bigint, updated_at = now()
       WHERE id = $1::bigint AND portfolio_id = $7::bigint`,
      [
        input.initiativeId,
        name,
        owner.ownerMemberId,
        owner.ownerName,
        expectedEffect,
        input.linkedProjectId,
        input.portfolioId,
      ],
    );
    await q.query(
      `UPDATE portfolio_initiative_estimates
       SET kind = $4, cost_yen = $3::bigint, updated_at = now()
       WHERE period_id = $1::bigint AND initiative_id = $2::bigint`,
      [input.periodId, input.initiativeId, input.costYen, input.kind],
    );
    await replaceDemands(q, {
      periodId: input.periodId,
      initiativeId: input.initiativeId,
      workspaceId: input.workspaceId,
      portfolioId: input.portfolioId,
      demands: input.demands,
    });
    await bumpAllPeriodRevisions(q, input.portfolioId);
    await recordPlanAction(q, input, "initiative_update", "portfolio_initiative", input.initiativeId, name);
    return { revision: await currentRevision(q, input.periodId, input.portfolioId) };
  });
}

/**
 * Attach an existing portfolio initiative to another period without creating a
 * second entity or copying prior estimates. The new period starts unestimated.
 */
export async function attachInitiativeToPeriod(input: {
  workspaceId: number;
  portfolioId: number;
  userId: number;
  periodId: number;
  initiativeId: number;
  revision: number;
}): Promise<{ revision: number }> {
  return withTransaction(async (q) => {
    await lockPlanningPortfolio(q, input.portfolioId, input.workspaceId);
    await requirePlanningEditor(q, input.portfolioId, input.workspaceId, input.userId);
    const period = await lockPlanningPeriod(q, input.periodId, input.portfolioId, input.workspaceId);
    await assertRevision(period.revision, input.revision);
    await assertPeriodFullyVisible(
      q,
      input.periodId,
      input.portfolioId,
      input.workspaceId,
      input.userId,
    );
    const initiative = await q.query(
      `SELECT i.id, i.linked_project_id,
         COALESCE((
           SELECT previous_estimate.kind
           FROM portfolio_initiative_estimates previous_estimate
           JOIN portfolio_plan_periods previous_period
             ON previous_period.id = previous_estimate.period_id
           WHERE previous_estimate.initiative_id = i.id
             AND previous_estimate.portfolio_id = i.portfolio_id
             AND (
               previous_period.year < $3::int
               OR (previous_period.year = $3::int AND previous_period.quarter < $4::smallint)
             )
           ORDER BY previous_period.year DESC, previous_period.quarter DESC
           LIMIT 1
         ), 'candidate') AS previous_kind
       FROM portfolio_initiatives i
       WHERE i.id = $1::bigint AND i.portfolio_id = $2::bigint`,
      [input.initiativeId, input.portfolioId, period.year, period.quarter],
    );
    if (initiative.rowCount === 0) throw notFound("案件が見つかりません");
    const linkedProjectId = initiative.rows[0].linked_project_id;
    const previousKind =
      String(initiative.rows[0].previous_kind) === "fixed" ? "fixed" : "candidate";
    if (linkedProjectId !== null && linkedProjectId !== undefined) {
      const visible = await visibleProjectIds(
        q,
        input.userId,
        input.workspaceId,
        [Number(linkedProjectId)],
      );
      if (!visible.has(Number(linkedProjectId))) {
        throw new ApiError(403, "元プロジェクトの閲覧権限がありません", "forbidden");
      }
    }
    const existing = await q.query(
      `SELECT 1 FROM portfolio_initiative_estimates
       WHERE period_id = $1::bigint AND initiative_id = $2::bigint`,
      [input.periodId, input.initiativeId],
    );
    if (existing.rowCount !== 0) throw conflict("この案件は既にこの四半期に追加されています");
    await q.query(
      `INSERT INTO portfolio_initiative_estimates
         (period_id, initiative_id, workspace_id, portfolio_id, kind, cost_yen)
       VALUES ($1::bigint, $2::bigint, $3::bigint, $4::bigint, $5, NULL)`,
      [input.periodId, input.initiativeId, input.workspaceId, input.portfolioId, previousKind],
    );
    const revision = await bumpPeriodRevision(q, input.periodId, input.portfolioId);
    await recordPlanAction(q, input, "initiative_attach", "portfolio_initiative", input.initiativeId);
    return { revision };
  });
}

/** Remove an initiative from one period. The entity is deleted only when no other period uses it. */
export async function removeInitiativeFromPeriod(input: {
  workspaceId: number;
  portfolioId: number;
  userId: number;
  periodId: number;
  initiativeId: number;
  revision: number;
}): Promise<{ revision: number }> {
  return withTransaction(async (q) => {
    await lockPlanningPortfolio(q, input.portfolioId, input.workspaceId);
    await requirePlanningEditor(q, input.portfolioId, input.workspaceId, input.userId);
    const period = await lockPlanningPeriod(q, input.periodId, input.portfolioId, input.workspaceId);
    await assertRevision(period.revision, input.revision);
    await assertPeriodFullyVisible(
      q,
      input.periodId,
      input.portfolioId,
      input.workspaceId,
      input.userId,
    );
    const target = await q.query(
      `SELECT 1
       FROM portfolio_initiative_estimates
       WHERE period_id = $1::bigint AND initiative_id = $2::bigint AND portfolio_id = $3::bigint`,
      [input.periodId, input.initiativeId, input.portfolioId],
    );
    if (target.rowCount === 0) throw notFound("案件が見つかりません");
    await q.query(
      `DELETE FROM portfolio_scenario_inclusions
       WHERE initiative_id = $1::bigint
         AND scenario_id IN (
           SELECT id FROM portfolio_plan_scenarios
           WHERE period_id = $2::bigint AND portfolio_id = $3::bigint
         )`,
      [input.initiativeId, input.periodId, input.portfolioId],
    );
    await q.query(
      `DELETE FROM portfolio_initiative_estimates
       WHERE period_id = $1::bigint AND initiative_id = $2::bigint`,
      [input.periodId, input.initiativeId],
    );
    const remaining = await q.query(
      `SELECT 1 FROM portfolio_initiative_estimates
       WHERE initiative_id = $1::bigint LIMIT 1`,
      [input.initiativeId],
    );
    if (remaining.rowCount === 0) {
      await q.query(
        "DELETE FROM portfolio_initiatives WHERE id = $1::bigint AND portfolio_id = $2::bigint",
        [input.initiativeId, input.portfolioId],
      );
    }
    await bumpAllPeriodRevisions(q, input.portfolioId);
    await recordPlanAction(q, input, "initiative_remove", "portfolio_initiative", input.initiativeId);
    return { revision: await currentRevision(q, input.periodId, input.portfolioId) };
  });
}

export async function saveScenarioSelection(input: {
  workspaceId: number;
  portfolioId: number;
  userId: number;
  periodId: number;
  slot: 0 | 1;
  revision: number;
  initiativeIds: number[];
}): Promise<{ revision: number }> {
  return withTransaction(async (q) => {
    await lockPlanningPortfolio(q, input.portfolioId, input.workspaceId);
    await requirePlanningEditor(q, input.portfolioId, input.workspaceId, input.userId);
    const period = await lockPlanningPeriod(q, input.periodId, input.portfolioId, input.workspaceId);
    await assertRevision(period.revision, input.revision);
    await assertPeriodFullyVisible(
      q,
      input.periodId,
      input.portfolioId,
      input.workspaceId,
      input.userId,
    );
    const scenario = await q.query(
      `SELECT id FROM portfolio_plan_scenarios
       WHERE period_id = $1::bigint AND portfolio_id = $2::bigint AND slot = $3::smallint`,
      [input.periodId, input.portfolioId, input.slot],
    );
    if (scenario.rowCount === 0) throw notFound("比較案が見つかりません");
    const scenarioId = Number(scenario.rows[0].id);

    const ids = [...new Set(input.initiativeIds)];
    if (ids.length > 0) {
      const valid = await q.query(
        `SELECT i.id
         FROM portfolio_initiatives i
         JOIN portfolio_initiative_estimates e
           ON e.initiative_id = i.id AND e.period_id = $1::bigint
         WHERE i.portfolio_id = $2::bigint
           AND e.kind = 'candidate'
           AND i.id = ANY($3::bigint[])`,
        [input.periodId, input.portfolioId, ids],
      );
      if (valid.rowCount !== ids.length) {
        throw badRequest("選択した案件はこの四半期の比較候補ではありません");
      }
    }
    await q.query(
      "DELETE FROM portfolio_scenario_inclusions WHERE scenario_id = $1::bigint",
      [scenarioId],
    );
    if (ids.length > 0) {
      await q.query(
        `INSERT INTO portfolio_scenario_inclusions
           (scenario_id, initiative_id, workspace_id, portfolio_id)
         SELECT $1::bigint, initiative_id, $2::bigint, $3::bigint
         FROM unnest($4::bigint[]) AS input(initiative_id)`,
        [scenarioId, input.workspaceId, input.portfolioId, ids],
      );
    }
    const revision = await bumpPeriodRevision(q, input.periodId, input.portfolioId);
    await recordPlanAction(q, input, "scenario_update", "portfolio_plan_period", input.periodId, input.slot === 0 ? "A案" : "B案");
    return { revision };
  });
}

/**
 * Freeze both scenarios and hand the proposal to the configured final approver.
 * The submission itself never adopts a plan; direct adoption is refused while
 * approvals are enabled.
 */
export async function submitProposal(input: {
  workspaceId: number;
  portfolioId: number;
  userId: number;
  periodId: number;
  revision: number;
  chosenSlot: 0 | 1;
  reason: string;
  reviewerUserId?: number | null;
  requestId: string;
}): Promise<{
  id: number;
  version: number;
  status: PlanningProposalStatus;
  idempotent: boolean;
  submittedAt: string;
}> {
  try {
    return await withTransaction(async (q) => {
      await lockPlanningPortfolio(q, input.portfolioId, input.workspaceId);
      await requirePlanningEditor(q, input.portfolioId, input.workspaceId, input.userId);
      const period = await lockPlanningPeriod(
        q,
        input.periodId,
        input.portfolioId,
        input.workspaceId,
      );

      const previous = await q.query(
        `SELECT id, version, status, submitted_by, recommended_slot, reason, reviewer_user_id,
           submitted_at::text AS submitted_at
         FROM portfolio_plan_proposals
         WHERE period_id = $1::bigint AND request_id = $2`,
        [input.periodId, input.requestId],
      );
      if (previous.rowCount !== 0) {
        const row = previous.rows[0];
        const previousReviewerId =
          row.reviewer_user_id === null || row.reviewer_user_id === undefined
            ? null
            : Number(row.reviewer_user_id);
        if (
          Number(row.submitted_by) !== input.userId ||
          Number(row.recommended_slot) !== input.chosenSlot ||
          String(row.reason) !== input.reason ||
          (input.reviewerUserId !== undefined && input.reviewerUserId !== previousReviewerId)
        ) {
          throw new ApiError(
            409,
            "同じリクエストIDが別の提案内容で使用されています",
            "request_id_reused",
          );
        }
        return {
          id: Number(row.id),
          version: Number(row.version),
          status: effectiveProposalStatus(
            String(row.status) as PlanningProposalStatus,
            previousReviewerId,
          ),
          idempotent: true,
          submittedAt: String(row.submitted_at),
        };
      }

      const settings = await loadApprovalSettings(q, input.portfolioId);
      const periodOpenProposals = await countOpenProposals(
        q,
        input.portfolioId,
        input.periodId,
      );
      const block = proposalSubmissionBlock({
        approvalsEnabled: settings.enabled,
        finalApproverUserId: settings.finalApprover?.id ?? null,
        submitterUserId: input.userId,
        openProposal: periodOpenProposals > 0,
      });
      if (block === "approvals_disabled") {
        throw conflict("このポートフォリオでは承認フローが有効になっていません", "approval_disabled");
      }
      if (block === "approver_missing") {
        throw conflict(
          "最終承認者が設定されていないため、投資提案を提出できません。承認設定を確認してください",
          "approver_unavailable",
        );
      }
      if (block === "self_approval") {
        throw new ApiError(
          409,
          "申請者自身は最終承認者になれません。別の最終承認者を設定するか、別のメンバーが提案してください",
          "self_approval_forbidden",
        );
      }
      if (block === "open_proposal") {
        throw conflict(
          "この四半期には未解決の投資提案があります。承認または差し戻し後に再提出してください",
          "proposal_open",
        );
      }

      await assertRevision(period.revision, input.revision);
      await assertPeriodFullyVisible(
        q,
        input.periodId,
        input.portfolioId,
        input.workspaceId,
        input.userId,
      );

      const candidates = await loadEligiblePlanParticipants(
        q,
        input.portfolioId,
        input.workspaceId,
      );
      const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      const approverId = settings.finalApprover?.id ?? null;
      if (approverId === null) {
        throw conflict("最終承認者が設定されていません", "approver_unavailable");
      }
      const approver = byId.get(approverId);
      if (!approver) {
        throw conflict(
          "最終承認者がこの投資計画を完全に閲覧できないため、提案を提出できません。承認設定を確認してください",
          "approver_unavailable",
        );
      }
      const reviewerId =
        input.reviewerUserId === undefined
          ? (settings.reviewer?.id ?? null)
          : input.reviewerUserId;
      if (invalidProposalReview(reviewerId, input.userId, approverId, settings.reviewer?.id ?? null)) {
        throw conflict("申請者・最終承認者から独立したレビュー担当が必要です。設定済みの担当は変更できません");
      }
      let reviewerName: string | null = null;
      if (reviewerId !== null) {
        const reviewer = byId.get(reviewerId);
        if (!reviewer) {
          throw conflict(
            "指定したレビュー担当がこの投資計画を完全に閲覧できないため、提案を提出できません",
            "reviewer_unavailable",
          );
        }
        reviewerName = reviewer.name;
      }

      const roles = await loadRoles(q, input.portfolioId);
      const capacities = await loadCapacities(q, input.periodId);
      const initiatives = await loadPeriodInitiatives(q, input.periodId, input.portfolioId);
      const scenarios = await loadScenarios(q, input.periodId, input.portfolioId);
      if (!scenarios.some((scenario) => scenario.slot === input.chosenSlot)) {
        throw badRequest("提案する案が見つかりません");
      }
      const actor = await q.query("SELECT name FROM users WHERE id = $1::bigint", [input.userId]);
      if (actor.rowCount === 0) throw badRequest("実行者が見つかりません");

      const snapshot = buildDecisionSnapshot({
        period: {
          id: period.id,
          year: period.year,
          quarter: period.quarter,
          budgetYen: period.budgetYen,
          revision: period.revision,
        },
        roles,
        initiatives: initiatives as CalculationInitiative[],
        capacities,
        scenarios: scenarios.map((scenario) => ({
          slot: scenario.slot,
          name: scenario.name,
          selectedCandidateIds: scenario.selectedInitiativeIds,
        })),
        chosenSlot: input.chosenSlot,
      });
      const snapshotHash = hashPlanningSnapshot(snapshot);
      const versionResult = await q.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS version
         FROM portfolio_plan_proposals
         WHERE period_id = $1::bigint`,
        [input.periodId],
      );
      const version = Number(versionResult.rows[0].version);
      const initialStatus = proposalInitialStatus(reviewerId);
      const initialReviewOutcome = proposalInitialReviewOutcome(reviewerId);
      const inserted = await q.query(
        `INSERT INTO portfolio_plan_proposals
           (workspace_id, portfolio_id, period_id, version, status, recommended_slot,
            reason, request_id, submitted_by, submitted_by_name, submitted_at,
            final_approver_user_id, final_approver_name, reviewer_user_id, reviewer_name,
            review_outcome, period_revision, budget_yen, snapshot, snapshot_sha256)
         VALUES ($1::bigint, $2::bigint, $3::bigint, $4::int, $5, $6::smallint,
                 $7, $8, $9::bigint, $10, now(),
                 $11::bigint, $12, $13::bigint, $14,
                 $15, $16::int, $17::bigint, $18::jsonb, $19)
         RETURNING id, submitted_at::text AS submitted_at`,
        [
          input.workspaceId,
          input.portfolioId,
          input.periodId,
          version,
          initialStatus,
          input.chosenSlot,
          input.reason,
          input.requestId,
          input.userId,
          String(actor.rows[0].name),
          approver.id,
          approver.name,
          reviewerId,
          reviewerName,
          initialReviewOutcome,
          period.revision,
          period.budgetYen,
          JSON.stringify(snapshot),
          snapshotHash,
        ],
      );
      await recordPlanAction(q, input, "proposal_submit", "portfolio_plan_proposal", Number(inserted.rows[0].id),
        "v" + version + " / " + (input.chosenSlot === 0 ? "A案" : "B案"));
      return {
        id: Number(inserted.rows[0].id),
        version,
        status: initialStatus,
        idempotent: false,
        submittedAt: String(inserted.rows[0].submitted_at),
      };
    });
  } catch (error) {
    const dbError = error as { code?: string; constraint?: string } | null;
    if (
      dbError?.code === "23505" &&
      (dbError.constraint === "idx_portfolio_plan_proposals_one_open" ||
        dbError.constraint === "portfolio_plan_proposals_period_id_version_key")
    ) {
      throw conflict(
        "この四半期には未解決の投資提案があります。承認または差し戻し後に再提出してください",
        "proposal_open",
      );
    }
    throw error;
  }
}

/**
 * Final approver action. Approval copies the frozen submission snapshot into
 * the existing immutable decision table and links it back to the proposal in
 * one transaction. Returns and deferrals only close the proposal version and
 * never create an adopted decision.
 */
export async function decideProposal(input: {
  workspaceId: number;
  portfolioId: number;
  userId: number;
  proposalId: number;
  action: PlanningProposalDecisionAction;
  reason: string;
  requestId: string;
  expectedStatus: PlanningProposalStatus | null;
}): Promise<{
  id: number;
  version: number;
  status: PlanningProposalStatus;
  action: PlanningProposalDecisionAction;
  decisionId: number | null;
  decidedAt: string;
  idempotent: boolean;
}> {
  try {
    return await withTransaction(async (q) => {
      await lockPlanningPortfolio(q, input.portfolioId, input.workspaceId);
      await requirePlanningAccess(q, input.portfolioId, input.workspaceId, input.userId);

      const actor = await q.query(
        "SELECT name FROM users WHERE id = $1::bigint AND deactivated_at IS NULL",
        [input.userId],
      );
      if (actor.rowCount === 0) throw forbidden("実行者が存在しないか無効です");

      const loaded = await q.query(
        `SELECT (SELECT default_reviewer_user_id FROM portfolio_plan_approval_settings
                 WHERE portfolio_id = $2::bigint) AS required_reviewer_id, id, version, status, period_id, recommended_slot, submitted_by,
           final_approver_user_id, reviewer_user_id, review_outcome,
           decision_action, decision_note,
           decision_request_id, decision_id, decided_at::text AS decided_at,
           snapshot, snapshot_sha256
         FROM portfolio_plan_proposals
         WHERE id = $1::bigint
           AND portfolio_id = $2::bigint
           AND workspace_id = $3::bigint
         FOR UPDATE`,
        [input.proposalId, input.portfolioId, input.workspaceId],
      );
      if (loaded.rowCount === 0) throw notFound("投資提案が見つかりません");
      const row = loaded.rows[0];
      const reviewerUserId =
        row.reviewer_user_id === null || row.reviewer_user_id === undefined
          ? null
          : Number(row.reviewer_user_id);
      const rawStatus = String(row.status) as PlanningProposalStatus;
      const status = effectiveProposalStatus(rawStatus, reviewerUserId);
      const finalApproverUserId = Number(row.final_approver_user_id);
      const submitterUserId = Number(row.submitted_by);

      // Assignment and frozen-snapshot visibility are verified even when this
      // is a retry of an already-recorded action, so revoked actors are denied.
      if (finalApproverUserId !== input.userId) {
        throw forbidden(
          "この提案を決裁できるのは、割り当てられた最終承認者だけです",
        );
      }
      if (submitterUserId === input.userId) {
        throw forbidden("申請者自身はこの提案を決裁できません");
      }

      if (isOpenProposalStatus(status) && invalidProposalReview(
        reviewerUserId, Number(row.submitted_by), Number(row.final_approver_user_id),
        row.required_reviewer_id === null ? null : Number(row.required_reviewer_id),
      )) {
        throw conflict("レビュー担当の割当が不正です。提案を取り下げ、別の担当者で再提出してください");
      }
      const snapshot = row.snapshot;
      const recommendedSlot = Number(row.recommended_slot) === 1 ? (1 as const) : (0 as const);
      if (
        !isPlanningDecisionSnapshot(snapshot) ||
        snapshot.chosenSlot !== recommendedSlot ||
        hashPlanningSnapshot(snapshot) !== String(row.snapshot_sha256)
      ) {
        throw new ApiError(
          409,
          "提案の内容を確認できませんでした",
          "proposal_snapshot_invalid",
        );
      }
      const projectIds = snapshotProjectIds(snapshot);
      const visible = await visibleProjectIds(q, input.userId, input.workspaceId, projectIds);
      if (projectIds.some((projectId) => !visible.has(projectId))) {
        throw forbidden(
          "閲覧権限のない元プロジェクトが含まれるため、この提案を決裁できません。全案件の元プロジェクト閲覧権限が必要です",
        );
      }

      if (row.decision_request_id === input.requestId) {
        if (
          finalApproverUserId !== input.userId ||
          row.decision_action !== input.action ||
          String(row.decision_note ?? "") !== input.reason ||
          row.decided_at === null ||
          row.decided_at === undefined
        ) {
          throw new ApiError(
            409,
            "同じリクエストIDが別の決裁内容で使用されています",
            "request_id_reused",
          );
        }
        return {
          id: Number(row.id),
          version: Number(row.version),
          status,
          action: input.action,
          decisionId:
            row.decision_id === null || row.decision_id === undefined
              ? null
              : Number(row.decision_id),
          decidedAt: String(row.decided_at),
          idempotent: true,
        };
      }

      if (
        input.expectedStatus !== null &&
        input.expectedStatus !== status &&
        input.expectedStatus !== rawStatus
      ) {
        throw new ApiError(
          409,
          "提案の状態が変わりました。最新の内容を確認してください",
          "proposal_status_changed",
          { currentStatus: status },
        );
      }

      if (
        status === "under_review" ||
        (reviewerUserId !== null && row.review_outcome !== "passed")
      ) {
        throw new ApiError(
          409,
          "レビュー担当の確認が完了していないため、最終決裁はできません。先にレビューを完了してください",
          "review_pending",
          { currentStatus: status },
        );
      }
      if (status !== "pending_decision") {
        throw new ApiError(
          409,
          `この提案は既に「${proposalStatusLabel(status)}」です。最新の内容を確認してください`,
          "proposal_status_changed",
          { currentStatus: status },
        );
      }

      // Only approval adopts the frozen plan. A stale submission could not be
      // safely adopted, but a return/defer is still a valid closure.
      if (input.action === "approve") {
        const period = await lockPlanningPeriod(
          q,
          Number(row.period_id),
          input.portfolioId,
          input.workspaceId,
        );
        const roles = await loadRoles(q, input.portfolioId);
        const capacities = await loadCapacities(q, period.id);
        const initiatives = await loadPeriodInitiatives(
          q,
          period.id,
          input.portfolioId,
        );
        const scenarios = await loadScenarios(q, period.id, input.portfolioId);
        const currentSnapshot = buildDecisionSnapshot({
          period: {
            id: period.id,
            year: period.year,
            quarter: period.quarter,
            budgetYen: period.budgetYen,
            revision: period.revision,
          },
          roles,
          initiatives: initiatives as CalculationInitiative[],
          capacities,
          scenarios: scenarios.map((scenario) => ({
            slot: scenario.slot,
            name: scenario.name,
            selectedCandidateIds: scenario.selectedInitiativeIds,
          })),
          chosenSlot: snapshot.chosenSlot,
        });
        if (!samePlanningPlanContent(snapshot, currentSnapshot)) {
          throw new ApiError(
            409,
            "提出時点から計画（予算・配賦枠・案件構成など）が変更されています。この提案は承認できません。提案を取り下げ、現在の計画で新しい版を提出してください",
            "proposal_stale",
            { currentRevision: period.revision },
          );
        }
      }

      const decidedAtResult = await q.query("SELECT now()::text AS decided_at");
      const decidedAt = String(decidedAtResult.rows[0].decided_at);
      const nextStatus = proposalStatusAfterDecision(input.action);

      if (input.action === "approve") {
        const inserted = await q.query(
          `INSERT INTO portfolio_plan_decisions
             (workspace_id, portfolio_id, period_id, chosen_slot, reason, request_id,
              actor_id, actor_name, decided_at, period_revision, budget_yen,
              snapshot, snapshot_sha256, source_proposal_id)
           VALUES ($1::bigint, $2::bigint, $3::bigint, $4::smallint, $5, $6,
                   $7::bigint, $8, $9::timestamptz, $10::int, $11::bigint,
                   $12::jsonb, $13, $14::bigint)
           RETURNING id, decided_at::text AS decided_at`,
          [
            input.workspaceId,
            input.portfolioId,
            Number(row.period_id),
            snapshot.chosenSlot,
            input.reason,
            input.requestId,
            input.userId,
            String(actor.rows[0].name),
            decidedAt,
            snapshot.period.revision,
            snapshot.period.budgetYen,
            JSON.stringify(snapshot),
            String(row.snapshot_sha256),
            input.proposalId,
          ],
        );
        const decisionId = Number(inserted.rows[0].id);
        const decisionDecidedAt = String(inserted.rows[0].decided_at);
        const updated = await q.query(
          `UPDATE portfolio_plan_proposals
           SET status = 'approved',
               decision_action = 'approve',
               decision_note = $4,
               decided_by = $5::bigint,
               decided_by_name = $6,
               decided_at = $7::timestamptz,
               decision_id = $8::bigint,
               decision_request_id = $9
           WHERE id = $1::bigint
             AND status = $2::text
             AND final_approver_user_id = $3::bigint
           RETURNING version`,
          [
            input.proposalId,
            rawStatus,
            input.userId,
            input.reason,
            input.userId,
            String(actor.rows[0].name),
            decisionDecidedAt,
            decisionId,
            input.requestId,
          ],
        );
        if (updated.rowCount === 0) {
          throw new ApiError(
            409,
            "提案の状態が変わりました。最新の内容を確認してください",
            "proposal_status_changed",
          );
        }
        await recordPlanAction(q, input, "proposal_decide", "portfolio_plan_proposal", input.proposalId, "v" + row.version + " / " + nextStatus);
        await recordPlanAction(q, input, "adopt", "portfolio_plan_decision", decisionId, "提案 #" + input.proposalId + " から採用");
        return {
          id: input.proposalId,
          version: Number(updated.rows[0].version),
          status: nextStatus,
          action: input.action,
          decisionId,
          decidedAt: decisionDecidedAt,
          idempotent: false,
        };
      }

      const updated = await q.query(
        `UPDATE portfolio_plan_proposals
         SET status = $4::text,
             decision_action = $5,
             decision_note = $6,
             decided_by = $7::bigint,
             decided_by_name = $8,
             decided_at = now(),
             decision_request_id = $9
         WHERE id = $1::bigint
           AND status = $2::text
           AND final_approver_user_id = $3::bigint
         RETURNING version, decided_at::text AS decided_at`,
        [
          input.proposalId,
          rawStatus,
          input.userId,
          nextStatus,
          input.action,
          input.reason,
          input.userId,
          String(actor.rows[0].name),
          input.requestId,
        ],
      );
      if (updated.rowCount === 0) {
        throw new ApiError(
          409,
          "提案の状態が変わりました。最新の内容を確認してください",
          "proposal_status_changed",
        );
      }
      await recordPlanAction(q, input, "proposal_decide", "portfolio_plan_proposal", input.proposalId, "v" + row.version + " / " + nextStatus);
      return {
        id: input.proposalId,
        version: Number(updated.rows[0].version),
        status: nextStatus,
        action: input.action,
        decisionId: null,
        decidedAt: String(updated.rows[0].decided_at),
        idempotent: false,
      };
    });
  } catch (error) {
    const dbError = error as { code?: string; constraint?: string } | null;
    if (dbError?.code === "23505") {
      if (dbError.constraint?.includes("source_proposal")) {
        throw new ApiError(
          409,
          "この提案は既に決裁済みです。最新の内容を確認してください",
          "proposal_already_decided",
        );
      }
      throw new ApiError(
        409,
        "同じ操作が別の内容で送信されています。最新の内容を確認して、もう一度お試しください",
        "request_id_reused",
      );
    }
    throw error;
  }
}

/**
 * Applicant/editor recovery path for an open version. Withdrawal never reads
 * the frozen snapshot, so it still works after a reviewer or approver account
 * is deactivated or loses access, and never discloses restricted content.
 */
export async function withdrawProposal(input: {
  workspaceId: number;
  portfolioId: number;
  userId: number;
  proposalId: number;
  reason: string;
  requestId: string;
  expectedStatus: PlanningProposalStatus | null;
}): Promise<{
  id: number;
  version: number;
  status: PlanningProposalStatus;
  withdrawnAt: string;
  idempotent: boolean;
}> {
  try {
    return await withTransaction(async (q) => {
      await lockPlanningPortfolio(q, input.portfolioId, input.workspaceId);
      // Plan visibility is required for every caller, including the applicant.
      // Project visibility is intentionally not checked: losing access to a
      // linked project or to the reviewer/approver must not block recovery.
      const access = await requirePlanningAccess(
        q,
        input.portfolioId,
        input.workspaceId,
        input.userId,
      );

      const actor = await q.query(
        "SELECT name FROM users WHERE id = $1::bigint AND deactivated_at IS NULL",
        [input.userId],
      );
      if (actor.rowCount === 0) throw forbidden("実行者が存在しないか無効です");

      const loaded = await q.query(
        `SELECT id, version, status, submitted_by, reviewer_user_id,
           withdraw_request_id, withdraw_reason, withdrawn_by,
           withdrawn_at::text AS withdrawn_at
         FROM portfolio_plan_proposals
         WHERE id = $1::bigint
           AND portfolio_id = $2::bigint
           AND workspace_id = $3::bigint
         FOR UPDATE`,
        [input.proposalId, input.portfolioId, input.workspaceId],
      );
      if (loaded.rowCount === 0) throw notFound("投資提案が見つかりません");
      const row = loaded.rows[0];
      const submitterUserId = Number(row.submitted_by);
      const authorized = access.canEdit || submitterUserId === input.userId;
      if (!authorized) {
        throw forbidden("提案を取り下げできるのは申請者またはポートフォリオの編集者だけです");
      }

      const reviewerUserId =
        row.reviewer_user_id === null || row.reviewer_user_id === undefined
          ? null
          : Number(row.reviewer_user_id);
      const rawStatus = String(row.status) as PlanningProposalStatus;
      const status = effectiveProposalStatus(rawStatus, reviewerUserId);

      if (row.withdraw_request_id === input.requestId) {
        const recordedBy =
          row.withdrawn_by === null || row.withdrawn_by === undefined
            ? null
            : Number(row.withdrawn_by);
        if (
          recordedBy !== input.userId ||
          String(row.withdraw_reason ?? "") !== input.reason ||
          row.withdrawn_at === null ||
          row.withdrawn_at === undefined
        ) {
          throw new ApiError(
            409,
            "同じリクエストIDが別の取り下げ内容で使用されています",
            "request_id_reused",
          );
        }
        return {
          id: Number(row.id),
          version: Number(row.version),
          status: "withdrawn",
          withdrawnAt: String(row.withdrawn_at),
          idempotent: true,
        };
      }

      if (
        input.expectedStatus !== null &&
        input.expectedStatus !== status &&
        input.expectedStatus !== rawStatus
      ) {
        throw new ApiError(
          409,
          "提案の状態が変わりました。最新の内容を確認してください",
          "proposal_status_changed",
          { currentStatus: status },
        );
      }
      if (!isOpenProposalStatus(status)) {
        throw new ApiError(
          409,
          `この提案は既に「${proposalStatusLabel(status)}」のため取り下げできません`,
          "proposal_status_changed",
          { currentStatus: status },
        );
      }

      const updated = await q.query(
        `UPDATE portfolio_plan_proposals
         SET status = 'withdrawn',
             withdraw_reason = $4,
             withdraw_request_id = $5,
             withdrawn_by = $6::bigint,
             withdrawn_by_name = $7,
             withdrawn_at = now()
         WHERE id = $1::bigint
           AND status = $2::text
           AND submitted_by = $3::bigint
         RETURNING version, withdrawn_at::text AS withdrawn_at`,
        [
          input.proposalId,
          rawStatus,
          submitterUserId,
          input.reason,
          input.requestId,
          input.userId,
          String(actor.rows[0].name),
        ],
      );
      if (updated.rowCount === 0) {
        throw new ApiError(
          409,
          "提案の状態が変わりました。最新の内容を確認してください",
          "proposal_status_changed",
        );
      }
      await recordPlanAction(q, input, "proposal_withdraw", "portfolio_plan_proposal", input.proposalId, "v" + row.version + " / 取下げ");
      return {
        id: input.proposalId,
        version: Number(updated.rows[0].version),
        status: "withdrawn",
        withdrawnAt: String(updated.rows[0].withdrawn_at),
        idempotent: false,
      };
    });
  } catch (error) {
    const dbError = error as { code?: string; constraint?: string } | null;
    if (dbError?.code === "23505") {
      throw new ApiError(
        409,
        "同じ操作が別の内容で送信されています。最新の内容を確認して、もう一度お試しください",
        "request_id_reused",
      );
    }
    throw error;
  }
}

export async function adoptScenario(input: {
  workspaceId: number;
  portfolioId: number;
  userId: number;
  periodId: number;
  revision: number;
  chosenSlot: 0 | 1;
  reason: string;
  requestId: string;
}): Promise<{ id: number; idempotent: boolean; decidedAt?: string }> {
  return withTransaction(async (q) => {
    await lockPlanningPortfolio(q, input.portfolioId, input.workspaceId);
    await requirePlanningEditor(q, input.portfolioId, input.workspaceId, input.userId);
    const period = await lockPlanningPeriod(q, input.periodId, input.portfolioId, input.workspaceId);

    const approval = await loadApprovalSettings(q, input.portfolioId);
    const openProposalCount = await countOpenProposals(q, input.portfolioId, null);
    if (approval.enabled || openProposalCount > 0) {
      throw new ApiError(
        409,
        "承認フローが有効なため、比較画面からの直接採用はできません。投資提案を提出し、最終承認者の決定を待ってください",
        "approval_required",
        { approvalRequired: true },
      );
    }

    const previous = await q.query(
      `SELECT id, chosen_slot, reason, decided_at::text AS decided_at
       FROM portfolio_plan_decisions
       WHERE period_id = $1::bigint AND request_id = $2`,
      [input.periodId, input.requestId],
    );
    if (previous.rowCount !== 0) {
      const row = previous.rows[0];
      if (Number(row.chosen_slot) !== input.chosenSlot || String(row.reason) !== input.reason) {
        throw new ApiError(
          409,
          "同じリクエストIDが別の決定内容で使用されています",
          "request_id_reused",
        );
      }
      return {
        id: Number(row.id),
        idempotent: true,
        decidedAt: String(row.decided_at),
      };
    }

    await assertRevision(period.revision, input.revision);
    await assertPeriodFullyVisible(
      q,
      input.periodId,
      input.portfolioId,
      input.workspaceId,
      input.userId,
    );

    const roles = await loadRoles(q, input.portfolioId);
    const capacities = await loadCapacities(q, input.periodId);
    const initiatives = await loadPeriodInitiatives(q, input.periodId, input.portfolioId);
    const scenarios = await loadScenarios(q, input.periodId, input.portfolioId);
    if (!scenarios.some((scenario) => scenario.slot === input.chosenSlot)) {
      throw badRequest("採用する案が見つかりません");
    }
    const actor = await q.query("SELECT name FROM users WHERE id = $1::bigint", [input.userId]);
    if (actor.rowCount === 0) throw badRequest("実行者が見つかりません");

    const snapshot = buildDecisionSnapshot({
      period: {
        id: period.id,
        year: period.year,
        quarter: period.quarter,
        budgetYen: period.budgetYen,
        revision: period.revision,
      },
      roles,
      initiatives: initiatives as CalculationInitiative[],
      capacities,
      scenarios: scenarios.map((scenario) => ({
        slot: scenario.slot,
        name: scenario.name,
        selectedCandidateIds: scenario.selectedInitiativeIds,
      })),
      chosenSlot: input.chosenSlot,
    });
    const snapshotHash = hashPlanningSnapshot(snapshot);
    const inserted = await q.query(
      `INSERT INTO portfolio_plan_decisions
         (workspace_id, portfolio_id, period_id, chosen_slot, reason, request_id,
          actor_id, actor_name, decided_at, period_revision, budget_yen,
          snapshot, snapshot_sha256)
       VALUES ($1::bigint, $2::bigint, $3::bigint, $4::smallint, $5, $6,
               $7::bigint, $8, now(), $9::int, $10::bigint, $11::jsonb, $12)
       RETURNING id, decided_at::text AS decided_at`,
      [
        input.workspaceId,
        input.portfolioId,
        input.periodId,
        input.chosenSlot,
        input.reason,
        input.requestId,
        input.userId,
        String(actor.rows[0].name),
        period.revision,
        period.budgetYen,
        JSON.stringify(snapshot),
        snapshotHash,
      ],
    );
    await recordPlanAction(q, input, "adopt", "portfolio_plan_decision", Number(inserted.rows[0].id), "承認フロー外で採用 / " + (input.chosenSlot === 0 ? "A案" : "B案"));
    return {
      id: Number(inserted.rows[0].id),
      idempotent: false,
      decidedAt: String(inserted.rows[0].decided_at),
    };
  });
}

export async function addPlanViewer(input: {
  workspaceId: number;
  portfolioId: number;
  userId: number;
  viewerId: number;
}): Promise<void> {
  return withTransaction(async (q) => {
    await lockPlanningPortfolio(q, input.portfolioId, input.workspaceId);
    await requirePlanningEditor(q, input.portfolioId, input.workspaceId, input.userId);
    const user = await q.query(
      "SELECT id FROM users WHERE id = $1::bigint AND deactivated_at IS NULL",
      [input.viewerId],
    );
    if (user.rowCount === 0) throw badRequest("指定したユーザーは存在しないか無効です");
    await q.query(
      `INSERT INTO portfolio_plan_viewers (portfolio_id, user_id, granted_by)
       VALUES ($1::bigint, $2::bigint, $3::bigint)
       ON CONFLICT DO NOTHING`,
      [input.portfolioId, input.viewerId, input.userId],
    );
    await recordPlanAction(q, input, "viewer_add", "portfolio", input.portfolioId, "閲覧者 #" + input.viewerId);
  });
}

export async function removePlanViewer(input: {
  workspaceId: number;
  portfolioId: number;
  userId: number;
  viewerId: number;
}): Promise<void> {
  return withTransaction(async (q) => {
    await lockPlanningPortfolio(q, input.portfolioId, input.workspaceId);
    await requirePlanningEditor(q, input.portfolioId, input.workspaceId, input.userId);
    const assigned = await q.query(
      `SELECT 1
       FROM portfolio_plan_proposals p
       JOIN portfolios pf ON pf.id = p.portfolio_id
       LEFT JOIN users u ON u.id = $2::bigint
       WHERE p.portfolio_id = $1::bigint
         AND p.status IN ('submitted', 'under_review', 'pending_decision')
         AND (p.final_approver_user_id = $2::bigint OR p.reviewer_user_id = $2::bigint)
         AND NOT (COALESCE(u.is_admin, FALSE) OR pf.owner_id = $2::bigint)
       LIMIT 1`,
      [input.portfolioId, input.viewerId],
    );
    if (assigned.rowCount !== 0) {
      throw conflict(
        "このユーザーは未解決の投資提案の最終承認者またはレビュー担当です。提案を解決してから閲覧者から外してください",
        "approver_assigned",
      );
    }
    await q.query(
      `DELETE FROM portfolio_plan_viewers
       WHERE portfolio_id = $1::bigint AND user_id = $2::bigint`,
      [input.portfolioId, input.viewerId],
    );
    await recordPlanAction(q, input, "viewer_remove", "portfolio", input.portfolioId, "閲覧者 #" + input.viewerId);
  });
}
