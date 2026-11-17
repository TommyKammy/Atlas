import { withTransaction, type Queryable } from "../db";
import { ApiError, badRequest, conflict, notFound } from "../api/errors";
import {
  assertPeriodFullyVisible,
  assertPortfolioFullyVisible,
  assertRevision,
  loadEligiblePlanParticipants,
  lockPlanningPeriod,
  lockPlanningPortfolio,
  requirePlanningEditor,
  resolveLinkableProject,
  visibleProjectIds,
} from "./access";
import { approvalSettingsChanged, proposalSubmissionBlock } from "./approvals";
import { buildDecisionSnapshot, type CalculationInitiative } from "./calculations";
import { hashPlanningSnapshot } from "./decision-snapshot";
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
import type { PlanningInitiativeKind, PlanningQuarter } from "./types";
import {
  parseName,
  parseRoleEdits,
  parseRoleNames,
  type ParsedCapacityInput,
  type ParsedDemandInput,
  type ParsedRoleEdit,
} from "./validation";

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
       AND status IN ('submitted', 'under_review')
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
    return { revision };
  });
}

export async function updateApprovalSettings(input: {
  workspaceId: number;
  portfolioId: number;
  userId: number;
  enabled: boolean;
  finalApproverUserId: number | null;
  reviewerUserId: number | null;
}): Promise<{
  enabled: boolean;
  finalApproverUserId: number | null;
  reviewerUserId: number | null;
}> {
  return withTransaction(async (q) => {
    await lockPlanningPortfolio(q, input.portfolioId, input.workspaceId);
    await requirePlanningEditor(q, input.portfolioId, input.workspaceId, input.userId);

    const current = await loadApprovalSettings(q, input.portfolioId);
    const next = input.enabled
      ? {
          enabled: true,
          finalApproverUserId: input.finalApproverUserId,
          reviewerUserId: input.reviewerUserId,
        }
      : { enabled: false, finalApproverUserId: null, reviewerUserId: null };
    const changed = approvalSettingsChanged(
      {
        enabled: current.enabled,
        finalApproverUserId: current.finalApprover?.id ?? null,
        reviewerUserId: current.reviewer?.id ?? null,
      },
      next,
    );
    if (!changed) {
      return {
        enabled: current.enabled,
        finalApproverUserId: current.finalApprover?.id ?? null,
        reviewerUserId: current.reviewer?.id ?? null,
      };
    }

    const openProposalCount = await countOpenProposals(q, input.portfolioId, null);
    if (openProposalCount > 0) {
      throw new ApiError(
        409,
        `未解決の投資提案が${openProposalCount}件あるため、承認の有効・無効や担当者は変更できません。先に提案を承認または差し戻してください`,
        "approval_settings_locked",
        { openProposalCount },
      );
    }

    if (next.enabled) {
      if (next.finalApproverUserId === null) {
        throw badRequest("最終承認者を選択してください");
      }
      const candidates = await loadEligiblePlanParticipants(
        q,
        input.portfolioId,
        input.workspaceId,
      );
      const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      const approver = byId.get(next.finalApproverUserId);
      if (!approver) {
        throw badRequest(
          "最終承認者として選択できるのは、この投資計画を完全に閲覧できる有効なメンバーだけです",
        );
      }
      if (next.reviewerUserId !== null) {
        const reviewer = byId.get(next.reviewerUserId);
        if (!reviewer) {
          throw badRequest(
            "レビュー担当として選択できるのは、この投資計画を完全に閲覧できる有効なメンバーだけです",
          );
        }
      }
    }

    await q.query(
      `INSERT INTO portfolio_plan_approval_settings
         (portfolio_id, workspace_id, approvals_enabled, final_approver_user_id,
          default_reviewer_user_id, updated_by, updated_at)
       VALUES ($1::bigint, $2::bigint, $3, $4::bigint, $5::bigint, $6::bigint, now())
       ON CONFLICT (portfolio_id) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         approvals_enabled = EXCLUDED.approvals_enabled,
         final_approver_user_id = EXCLUDED.final_approver_user_id,
         default_reviewer_user_id = EXCLUDED.default_reviewer_user_id,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()`,
      [
        input.portfolioId,
        input.workspaceId,
        next.enabled,
        next.enabled ? next.finalApproverUserId : null,
        next.enabled ? next.reviewerUserId : null,
        input.userId,
      ],
    );

    return {
      enabled: next.enabled,
      finalApproverUserId: next.enabled ? next.finalApproverUserId : null,
      reviewerUserId: next.enabled ? next.reviewerUserId : null,
    };
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
}): Promise<{ id: number; version: number; idempotent: boolean; submittedAt: string }> {
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
        `SELECT id, version, submitted_by, recommended_slot, reason, reviewer_user_id,
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
      const inserted = await q.query(
        `INSERT INTO portfolio_plan_proposals
           (workspace_id, portfolio_id, period_id, version, status, recommended_slot,
            reason, request_id, submitted_by, submitted_by_name, submitted_at,
            final_approver_user_id, final_approver_name, reviewer_user_id, reviewer_name,
            period_revision, budget_yen, snapshot, snapshot_sha256)
         VALUES ($1::bigint, $2::bigint, $3::bigint, $4::int, 'submitted', $5::smallint,
                 $6, $7, $8::bigint, $9, now(),
                 $10::bigint, $11, $12::bigint, $13,
                 $14::int, $15::bigint, $16::jsonb, $17)
         RETURNING id, submitted_at::text AS submitted_at`,
        [
          input.workspaceId,
          input.portfolioId,
          input.periodId,
          version,
          input.chosenSlot,
          input.reason,
          input.requestId,
          input.userId,
          String(actor.rows[0].name),
          approver.id,
          approver.name,
          reviewerId,
          reviewerName,
          period.revision,
          period.budgetYen,
          JSON.stringify(snapshot),
          snapshotHash,
        ],
      );
      return {
        id: Number(inserted.rows[0].id),
        version,
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
         AND p.status IN ('submitted', 'under_review')
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
  });
}
