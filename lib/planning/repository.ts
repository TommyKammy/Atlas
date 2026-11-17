import { withTransaction, type Queryable } from "../db";
import { getPortfolioProjects } from "../repositories/portfolios";
import {
  hashPlanningSnapshot,
  isPlanningDecisionSnapshot,
  snapshotProjectIds,
} from "./decision-snapshot";
import { periodLabel, quarterStartMonth } from "./format";
import {
  requirePlanningAccess,
  loadEligiblePlanParticipants,
  visibleProjectIds,
  type PlanningAccessRecord,
} from "./access";
import { buildPlanningComparison } from "./select";
import type {
  PlanningApprovalCandidate,
  PlanningApprovalSettings,
  PlanningCapacity,
  PlanningComparisonProjection,
  PlanningDecision,
  PlanningDemand,
  PlanningInitiative,
  PlanningOwnerCandidate,
  PlanningPeriodSummary,
  PlanningProposal,
  PlanningProposalStatus,
  PlanningRole,
  PlanningScenario,
  PlanningState,
  PlanningViewer,
  PlanningViewerCandidate,
} from "./types";

function number(value: unknown): number {
  return Number(value);
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function stringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export async function loadPeriods(
  q: Queryable,
  portfolioId: number,
  workspaceId: number,
): Promise<PlanningPeriodSummary[]> {
  const result = await q.query(
    `SELECT id, year, quarter, budget_yen, revision
     FROM portfolio_plan_periods
     WHERE portfolio_id = $1::bigint AND workspace_id = $2::bigint
     ORDER BY year DESC, quarter DESC, id DESC`,
    [portfolioId, workspaceId],
  );
  return result.rows.map((row) => {
    const year = number(row.year);
    const quarter = number(row.quarter) as 1 | 2 | 3 | 4;
    return {
      id: number(row.id),
      year,
      quarter,
      budgetYen: number(row.budget_yen),
      revision: number(row.revision),
      label: periodLabel(year, quarter),
      startMonth: quarterStartMonth(quarter),
    };
  });
}

export async function loadRoles(q: Queryable, portfolioId: number): Promise<PlanningRole[]> {
  const result = await q.query(
    `SELECT id, name, position
     FROM portfolio_plan_roles
     WHERE portfolio_id = $1::bigint
     ORDER BY position, id`,
    [portfolioId],
  );
  return result.rows.map((row) => ({
    id: number(row.id),
    name: String(row.name),
    position: number(row.position),
  }));
}

export async function loadCapacities(q: Queryable, periodId: number): Promise<PlanningCapacity[]> {
  const result = await q.query(
    `SELECT role_id, month_index, days
     FROM portfolio_plan_capacities
     WHERE period_id = $1::bigint
     ORDER BY role_id, month_index`,
    [periodId],
  );
  return result.rows.map((row) => ({
    roleId: number(row.role_id),
    monthIndex: number(row.month_index) as 1 | 2 | 3,
    days: number(row.days),
  }));
}

export async function loadPeriodInitiatives(
  q: Queryable,
  periodId: number,
  portfolioId: number,
): Promise<PlanningInitiative[]> {
  const result = await q.query(
    `SELECT i.id, i.name, i.owner_member_id, i.owner_name, i.expected_effect, e.kind,
       i.linked_project_id, p.name AS linked_project_name, e.cost_yen
     FROM portfolio_initiative_estimates e
     JOIN portfolio_initiatives i
       ON i.id = e.initiative_id AND i.portfolio_id = e.portfolio_id
     LEFT JOIN projects p
       ON p.id = i.linked_project_id
      AND p.workspace_id = i.workspace_id
      AND p.deleted_at IS NULL
     WHERE e.period_id = $1::bigint AND e.portfolio_id = $2::bigint
     ORDER BY CASE WHEN e.kind = 'fixed' THEN 0 ELSE 1 END, i.id`,
    [periodId, portfolioId],
  );
  const initiativeIds = result.rows.map((row) => number(row.id));
  const demandsByInitiative = new Map<number, PlanningDemand[]>();
  if (initiativeIds.length > 0) {
    const demandResult = await q.query(
      `SELECT initiative_id, role_id, month_index, days
       FROM portfolio_initiative_demands
       WHERE period_id = $1::bigint AND initiative_id = ANY($2::bigint[])
       ORDER BY initiative_id, role_id, month_index`,
      [periodId, initiativeIds],
    );
    for (const row of demandResult.rows) {
      const initiativeId = number(row.initiative_id);
      const list = demandsByInitiative.get(initiativeId) ?? [];
      list.push({
        roleId: number(row.role_id),
        monthIndex: number(row.month_index) as 1 | 2 | 3,
        days: number(row.days),
      });
      demandsByInitiative.set(initiativeId, list);
    }
  }
  return result.rows.map((row) => ({
    id: number(row.id),
    name: String(row.name),
    ownerMemberId: nullableNumber(row.owner_member_id),
    ownerName: String(row.owner_name),
    expectedEffect: String(row.expected_effect),
    kind: row.kind === "fixed" ? "fixed" : "candidate",
    linkedProjectId: nullableNumber(row.linked_project_id),
    linkedProjectName: stringOrNull(row.linked_project_name),
    costYen: nullableNumber(row.cost_yen),
    demands: demandsByInitiative.get(number(row.id)) ?? [],
  }));
}

async function loadCarryovers(
  q: Queryable,
  periodId: number,
  portfolioId: number,
  workspaceId: number,
  userId: number,
): Promise<PlanningState["carryovers"]> {
  const result = await q.query(
    `SELECT i.id, i.name, i.owner_name, i.expected_effect,
       COALESCE(previous.kind, 'candidate') AS kind,
       i.linked_project_id, p.name AS linked_project_name
     FROM portfolio_initiatives i
     JOIN portfolio_plan_periods selected ON selected.id = $2::bigint
     LEFT JOIN portfolio_initiative_estimates e
       ON e.initiative_id = i.id AND e.period_id = selected.id
     LEFT JOIN LATERAL (
       SELECT previous_estimate.kind
       FROM portfolio_initiative_estimates previous_estimate
       JOIN portfolio_plan_periods previous_period ON previous_period.id = previous_estimate.period_id
       WHERE previous_estimate.initiative_id = i.id
         AND previous_estimate.portfolio_id = i.portfolio_id
         AND (
           previous_period.year < selected.year
           OR (previous_period.year = selected.year AND previous_period.quarter < selected.quarter)
         )
       ORDER BY previous_period.year DESC, previous_period.quarter DESC
       LIMIT 1
     ) previous ON TRUE
     LEFT JOIN projects p
       ON p.id = i.linked_project_id
      AND p.workspace_id = i.workspace_id
      AND p.deleted_at IS NULL
     WHERE i.portfolio_id = $1::bigint AND e.initiative_id IS NULL
     ORDER BY CASE WHEN COALESCE(previous.kind, 'candidate') = 'fixed' THEN 0 ELSE 1 END, i.id`,
    [portfolioId, periodId],
  );
  const linked = result.rows
    .map((row) => nullableNumber(row.linked_project_id))
    .filter((id): id is number => id !== null);
  const visible = await visibleProjectIds(q, userId, workspaceId, linked);
  return result.rows
    .map((row) => ({
      id: number(row.id),
      name: String(row.name),
      ownerName: String(row.owner_name),
      expectedEffect: String(row.expected_effect),
      kind: row.kind === "fixed" ? ("fixed" as const) : ("candidate" as const),
      linkedProjectId: nullableNumber(row.linked_project_id),
      linkedProjectName: stringOrNull(row.linked_project_name),
    }))
    .filter(
      (initiative) =>
        initiative.linkedProjectId === null || visible.has(initiative.linkedProjectId),
    );
}

export async function loadScenarios(
  q: Queryable,
  periodId: number,
  portfolioId: number,
): Promise<[PlanningScenario, PlanningScenario]> {
  const scenarioResult = await q.query(
    `SELECT id, slot, name
     FROM portfolio_plan_scenarios
     WHERE period_id = $1::bigint AND portfolio_id = $2::bigint
     ORDER BY slot`,
    [periodId, portfolioId],
  );
  if (scenarioResult.rowCount !== 2) {
    throw new Error("planning scenarios are incomplete");
  }
  const scenarioIds = scenarioResult.rows.map((row) => number(row.id));
  const inclusionResult = await q.query(
    `SELECT si.scenario_id, si.initiative_id
     FROM portfolio_scenario_inclusions si
     JOIN portfolio_initiative_estimates e
       ON e.initiative_id = si.initiative_id AND e.period_id = $2::bigint
     WHERE si.scenario_id = ANY($1::bigint[])
       AND e.kind = 'candidate'
     ORDER BY si.initiative_id`,
    [scenarioIds, periodId],
  );
  const selected = new Map<number, number[]>();
  for (const row of inclusionResult.rows) {
    const scenarioId = number(row.scenario_id);
    const list = selected.get(scenarioId) ?? [];
    list.push(number(row.initiative_id));
    selected.set(scenarioId, list);
  }
  const scenarios = scenarioResult.rows.map((row) => ({
    id: number(row.id),
    slot: number(row.slot) === 1 ? (1 as const) : (0 as const),
    name: String(row.name),
    selectedInitiativeIds: selected.get(number(row.id)) ?? [],
  })) as PlanningScenario[];
  return [scenarios[0], scenarios[1]];
}

export async function loadDecisions(
  q: Queryable,
  input: {
    workspaceId: number;
    portfolioId: number;
    periodId: number;
    userId: number;
  },
): Promise<PlanningDecision[]> {
  const result = await q.query(
    `SELECT id, chosen_slot, reason, actor_name, decided_at::text AS decided_at,
       period_revision, budget_yen, snapshot, snapshot_sha256
     FROM portfolio_plan_decisions
     WHERE period_id = $1::bigint
       AND portfolio_id = $2::bigint
       AND workspace_id = $3::bigint
     ORDER BY decided_at DESC, id DESC`,
    [input.periodId, input.portfolioId, input.workspaceId],
  );

  const parsed = result.rows.map((row) => {
    const snapshot = row.snapshot;
    if (!isPlanningDecisionSnapshot(snapshot)) {
      throw new Error("adopted decision snapshot has an invalid shape");
    }
    if (hashPlanningSnapshot(snapshot) !== String(row.snapshot_sha256)) {
      throw new Error("adopted decision snapshot failed its integrity check");
    }
    return { row, snapshot };
  });

  const projectIds = parsed.flatMap(({ snapshot }) => snapshotProjectIds(snapshot));
  const visible = await visibleProjectIds(q, input.userId, input.workspaceId, projectIds);

  return parsed.map(({ row, snapshot }) => {
    const hidden = snapshotProjectIds(snapshot).some((id) => !visible.has(id));
    const chosenSlot = number(row.chosen_slot) === 1 ? (1 as const) : (0 as const);
    const base = {
      id: number(row.id),
      chosenSlot,
      chosenScenarioName: snapshot.scenarios[chosenSlot]?.name ?? (chosenSlot === 0 ? "A案" : "B案"),
      actorName: String(row.actor_name),
      decidedAt: String(row.decided_at),
      periodRevision: number(row.period_revision),
      budgetYen: number(row.budget_yen),
    };
    if (hidden) {
      return {
        ...base,
        restricted: true as const,
        reason: null,
        snapshot: null,
      };
    }
    return {
      ...base,
      restricted: false as const,
      reason: String(row.reason),
      snapshot,
    };
  });
}

export async function loadApprovalSettings(
  q: Queryable,
  portfolioId: number,
): Promise<PlanningApprovalSettings> {
  const result = await q.query(
    `SELECT s.approvals_enabled,
       s.final_approver_user_id, approver.name AS final_approver_name,
       s.default_reviewer_user_id, reviewer.name AS reviewer_name,
       (
         SELECT COUNT(*)::int
         FROM portfolio_plan_proposals p
         WHERE p.portfolio_id = portfolios.id
           AND p.status IN ('submitted', 'under_review')
       ) AS open_proposal_count
     FROM portfolios
     LEFT JOIN portfolio_plan_approval_settings s ON s.portfolio_id = portfolios.id
     LEFT JOIN users approver ON approver.id = s.final_approver_user_id
     LEFT JOIN users reviewer ON reviewer.id = s.default_reviewer_user_id
     WHERE portfolios.id = $1::bigint`,
    [portfolioId],
  );
  if (result.rowCount === 0) throw new Error("portfolio not found");
  const row = result.rows[0];
  const approverId = nullableNumber(row.final_approver_user_id);
  const reviewerId = nullableNumber(row.default_reviewer_user_id);
  return {
    enabled: row.approvals_enabled === true,
    finalApprover:
      approverId !== null && row.final_approver_name !== null
        ? { id: approverId, name: String(row.final_approver_name) }
        : null,
    reviewer:
      reviewerId !== null && row.reviewer_name !== null
        ? { id: reviewerId, name: String(row.reviewer_name) }
        : null,
    openProposalCount: number(row.open_proposal_count ?? 0),
  };
}

/**
 * Submitted proposals are redacted exactly like adopted decisions: the current
 * actor must still see every linked project stored inside the frozen snapshot.
 */
export async function loadProposals(
  q: Queryable,
  input: {
    workspaceId: number;
    portfolioId: number;
    periodId: number;
    userId: number;
  },
): Promise<PlanningProposal[]> {
  const result = await q.query(
    `SELECT id, version, status, recommended_slot, reason, submitted_by_name,
       submitted_at::text AS submitted_at, final_approver_name, reviewer_name,
       period_revision, budget_yen, snapshot, snapshot_sha256
     FROM portfolio_plan_proposals
     WHERE period_id = $1::bigint
       AND portfolio_id = $2::bigint
       AND workspace_id = $3::bigint
     ORDER BY version DESC, id DESC`,
    [input.periodId, input.portfolioId, input.workspaceId],
  );

  const parsed = result.rows.map((row) => {
    const snapshot = row.snapshot;
    const recommendedSlot: 0 | 1 = number(row.recommended_slot) === 1 ? 1 : 0;
    if (!isPlanningDecisionSnapshot(snapshot) || snapshot.chosenSlot !== recommendedSlot) {
      throw new Error("submitted proposal snapshot has an invalid shape");
    }
    if (hashPlanningSnapshot(snapshot) !== String(row.snapshot_sha256)) {
      throw new Error("submitted proposal snapshot failed its integrity check");
    }
    return { row, snapshot, recommendedSlot };
  });

  const projectIds = parsed.flatMap(({ snapshot }) => snapshotProjectIds(snapshot));
  const visible = await visibleProjectIds(q, input.userId, input.workspaceId, projectIds);

  return parsed.map(({ row, snapshot, recommendedSlot }) => {
    const hidden = snapshotProjectIds(snapshot).some((id) => !visible.has(id));
    const base = {
      id: number(row.id),
      version: number(row.version),
      status: String(row.status) as PlanningProposalStatus,
      recommendedSlot,
      recommendedScenarioName:
        snapshot.scenarios[recommendedSlot]?.name ?? (recommendedSlot === 0 ? "A案" : "B案"),
      submitterName: String(row.submitted_by_name),
      submittedAt: String(row.submitted_at),
      periodRevision: number(row.period_revision),
      budgetYen: number(row.budget_yen),
      finalApproverName: String(row.final_approver_name),
      reviewerName: stringOrNull(row.reviewer_name),
    };
    if (hidden) {
      return {
        ...base,
        restricted: true as const,
        reason: null,
        snapshot: null,
      };
    }
    return {
      ...base,
      restricted: false as const,
      reason: String(row.reason),
      snapshot,
    };
  });
}

async function loadOwnerCandidates(
  q: Queryable,
  workspaceId: number,
): Promise<PlanningOwnerCandidate[]> {
  const result = await q.query(
    `SELECT u.id, u.name, u.email
     FROM users u
     JOIN workspaces w ON w.id = $1::bigint
     WHERE u.deactivated_at IS NULL
       AND (
         u.role_id IS NULL
         OR EXISTS (
           SELECT 1 FROM workspace_roles r
           WHERE r.id = u.role_id AND r.workspace_id = w.id
         )
       )
     ORDER BY u.name, u.id`,
    [workspaceId],
  );
  return result.rows.map((row) => ({
    id: number(row.id),
    name: String(row.name),
    email: stringOrNull(row.email),
  }));
}

async function loadViewers(
  q: Queryable,
  portfolioId: number,
): Promise<{ viewers: PlanningViewer[]; candidates: PlanningViewerCandidate[] }> {
  const viewerResult = await q.query(
    `SELECT u.id, u.name, u.email, v.granted_at::text AS granted_at
     FROM portfolio_plan_viewers v
     JOIN users u ON u.id = v.user_id
     WHERE v.portfolio_id = $1::bigint AND u.deactivated_at IS NULL
     ORDER BY u.name, u.id`,
    [portfolioId],
  );
  const candidateResult = await q.query(
    `SELECT id, name, email
     FROM users
     WHERE deactivated_at IS NULL
     ORDER BY name, id`,
  );
  return {
    viewers: viewerResult.rows.map((row) => ({
      id: number(row.id),
      name: String(row.name),
      email: stringOrNull(row.email),
      grantedAt: String(row.granted_at),
    })),
    candidates: candidateResult.rows.map((row) => ({
      id: number(row.id),
      name: String(row.name),
      email: stringOrNull(row.email),
    })),
  };
}

export async function loadPlanningState(input: {
  portfolioId: number;
  workspaceId: number;
  userId: number;
  periodKey?: string | null;
}): Promise<PlanningState> {
  return withTransaction(async (q) => {
    await q.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const access: PlanningAccessRecord = await requirePlanningAccess(
      q,
      input.portfolioId,
      input.workspaceId,
      input.userId,
    );
    const periods = await loadPeriods(q, input.portfolioId, input.workspaceId);
    let selectedPeriod: PlanningPeriodSummary | null = periods[0] ?? null;
    if (input.periodKey) {
      const match = /^(\d{4})-Q([1-4])$/.exec(input.periodKey.trim());
      if (match) {
        const year = Number(match[1]);
        const quarter = Number(match[2]);
        selectedPeriod =
          periods.find((period) => period.year === year && period.quarter === quarter) ??
          selectedPeriod;
      }
    }

    const roles = await loadRoles(q, input.portfolioId);
    const projects = await getPortfolioProjects(input.portfolioId, input.userId, q);
    const approval = await loadApprovalSettings(q, input.portfolioId);

    let capacities: PlanningCapacity[] = [];
    let initiatives: PlanningInitiative[] = [];
    let carryovers: PlanningState["carryovers"] = [];
    let scenarios: [PlanningScenario, PlanningScenario] | null = null;
    let comparison: PlanningComparisonProjection | null = null;
    let decisions: PlanningDecision[] = [];
    let proposals: PlanningProposal[] = [];
    let restricted = false;

    if (selectedPeriod) {
      capacities = await loadCapacities(q, selectedPeriod.id);
      const allInitiatives = await loadPeriodInitiatives(q, selectedPeriod.id, input.portfolioId);
      const linkedProjectIds = allInitiatives
        .map((initiative) => initiative.linkedProjectId)
        .filter((id): id is number => id !== null);
      const visible = await visibleProjectIds(
        q,
        input.userId,
        input.workspaceId,
        linkedProjectIds,
      );
      restricted = linkedProjectIds.some((id) => !visible.has(id));
      initiatives = restricted
        ? allInitiatives.filter(
            (initiative) =>
              initiative.linkedProjectId === null || visible.has(initiative.linkedProjectId),
          )
        : allInitiatives;
      if (!restricted) {
        scenarios = await loadScenarios(q, selectedPeriod.id, input.portfolioId);
        comparison = buildPlanningComparison({
          revision: selectedPeriod.revision,
          budgetYen: selectedPeriod.budgetYen,
          initiatives: allInitiatives,
          roles,
          capacities,
          scenarios,
        });
      }
      if (access.canEdit) {
        carryovers = await loadCarryovers(
          q,
          selectedPeriod.id,
          input.portfolioId,
          input.workspaceId,
          input.userId,
        );
      }
      decisions = await loadDecisions(q, {
        workspaceId: input.workspaceId,
        portfolioId: input.portfolioId,
        periodId: selectedPeriod.id,
        userId: input.userId,
      });
      proposals = await loadProposals(q, {
        workspaceId: input.workspaceId,
        portfolioId: input.portfolioId,
        periodId: selectedPeriod.id,
        userId: input.userId,
      });
    }

    let viewers: PlanningViewer[] | null = null;
    let viewerCandidates: PlanningViewerCandidate[] | null = null;
    let ownerCandidates: PlanningOwnerCandidate[] | null = null;
    let approvalCandidates: PlanningApprovalCandidate[] | null = null;
    if (access.canEdit) {
      // The member directory is editor-only; read-only projections never
      // include account emails. It follows the same active-workspace membership
      // rule as owner validation.
      ownerCandidates = await loadOwnerCandidates(q, input.workspaceId);
      approvalCandidates = await loadEligiblePlanParticipants(
        q,
        input.portfolioId,
        input.workspaceId,
      );
      const loaded = await loadViewers(q, input.portfolioId);
      viewers = loaded.viewers;
      viewerCandidates = loaded.candidates;
    }

    return {
      portfolio: { id: input.portfolioId, name: access.portfolioName },
      access: {
        canView: access.canView,
        canEdit: access.canEdit,
        canManageViewers: access.canManageViewers,
        canEditData: access.canEdit && !restricted && selectedPeriod !== null,
      },
      periods,
      selectedPeriod,
      roles,
      capacities,
      initiatives,
      carryovers,
      scenarios,
      comparison,
      decisions,
      approval,
      proposals,
      approvalCandidates,
      viewers,
      viewerCandidates,
      ownerCandidates,
      currentUserId: input.userId,
      projects: projects.map((project) => ({ id: project.id, name: project.name })),
      restricted,
      restrictedReason: restricted
        ? "閲覧権限のない元プロジェクトに紐づく案件があるため、合計・月別需給・比較を表示できません。全案件の元プロジェクトの閲覧権限が必要です。"
        : null,
    };
  });
}
