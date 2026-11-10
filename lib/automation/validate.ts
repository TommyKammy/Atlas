import { DOMAIN_EVENT_TYPES, type DomainEventType } from "../domain/events";
import { ACTION_CAPABILITIES, ACTION_IDS, requiredActionParams } from "./descriptors";
import { configuredTaskId, hasTaskSubject } from "./task-target";
import { conditionFieldType, conditionInputProblem, validConditionValue } from "./condition-schema";
import { defaultTriggerDays } from "./trigger-defaults";
import { isWebhookActionReference } from "./webhook-credentials";
import {
  isConditionOperator,
  RULE_LIMITS,
  type RuleAction,
  type RuleCondition,
  type RuleDefinition,
  type RulePath,
  type RuleTrigger,
} from "./types";

const EVENT_IDS = new Set<string>(DOMAIN_EVENT_TYPES);

function hasRequiredParams(capability: string, params: Record<string, unknown>): boolean {
  const required = requiredActionParams(capability);
  return required.every((name) => {
    const value = params[name];
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeTrigger(raw: unknown): RuleTrigger | null {
  const item = asRecord(raw);
  if (!item || typeof item.event !== "string" || !EVENT_IDS.has(item.event)) return null;
  const trigger: RuleTrigger = { event: item.event as DomainEventType };
  if (item.filters !== undefined) {
    const filters = asRecord(item.filters);
    if (!filters) return null;
    trigger.filters = filters;
  }
  if (item.days !== undefined) {
    if (typeof item.days !== "number" || !Number.isInteger(item.days) || item.days < 0 || item.days > 365) return null;
    trigger.days = item.days;
  } else {
    const days = defaultTriggerDays(trigger.event);
    if (days !== undefined) trigger.days = days;
  }
  return trigger;
}

function normalizeCondition(raw: unknown): RuleCondition | null {
  const item = asRecord(raw);
  if (!item || typeof item.field !== "string" || item.field.trim() === "") return null;
  if (!isConditionOperator(item.op)) return null;
  const condition: RuleCondition = {
    field: item.field.trim(),
    op: item.op,
    value: item.value,
  };
  return conditionFieldType(condition.field) && validConditionValue(condition) ? condition : null;
}

function conditionListProblem(conditions: unknown[], location: string): string | null {
  for (const [index, raw] of conditions.entries()) {
    const item = asRecord(raw);
    if (!item || typeof item.field !== "string" || !item.field.trim() || !isConditionOperator(item.op)) {
      return `${location}${index + 1}: 条件の項目と比較方法を選んでください。`;
    }
    const problem = conditionInputProblem({ field: item.field.trim(), op: item.op, value: item.value });
    if (problem) return `${location}${index + 1}: ${problem}`;
  }
  return null;
}

function normalizeAction(raw: unknown): RuleAction | null {
  const item = asRecord(raw);
  if (!item || typeof item.capability !== "string" || !ACTION_IDS.has(item.capability)) {
    return null;
  }
  if (item.params !== undefined && !asRecord(item.params)) return null;
  const params = asRecord(item.params) ?? {};
  if (!hasRequiredParams(item.capability, params)) return null;
  if (item.capability === "task.set_custom_field" && !Object.hasOwn(params, "value")) return null;
  if (item.capability === "webhook.post" && item.webhookActionId !== undefined) {
    if (!isWebhookActionReference(item.webhookActionId)) return null;
    return { capability: item.capability, params, webhookActionId: item.webhookActionId };
  }
  return { capability: item.capability, params };
}

function normalizePath(raw: unknown): RulePath | null {
  const item = asRecord(raw);
  if (!item) return null;
  if ((item.conditions !== undefined && !Array.isArray(item.conditions)) ||
      (item.actions !== undefined && !Array.isArray(item.actions)) ||
      (item.else !== undefined && typeof item.else !== "boolean") ||
      (item.name !== undefined && typeof item.name !== "string")) return null;
  const conditions = Array.isArray(item.conditions)
    ? item.conditions.map(normalizeCondition)
    : [];
  const actions = Array.isArray(item.actions) ? item.actions.map(normalizeAction) : [];
  if (conditions.length > RULE_LIMITS.conditionsPerPath) return null;
  if (conditions.some((condition) => condition === null)) return null;
  if (actions.some((action) => action === null)) return null;
  return {
    name:
      typeof item.name === "string" && item.name.trim() !== ""
        ? item.name.trim().slice(0, 100)
        : "パス",
    conditions: conditions as RuleCondition[],
    actions: actions as RuleAction[],
    else: item.else === true,
  };
}

export type RuleValidation =
  | { ok: true; definition: RuleDefinition }
  | { ok: false; error: string };

/** Validate and normalize a rule definition shared by UI, API and AI builder. */
export function validateRuleDefinition(raw: unknown): RuleValidation {
  const input = asRecord(raw);
  if (!input) return { ok: false, error: "definition is required" };
  if (input.version !== undefined && input.version !== 1) return { ok: false, error: "invalid definition version" };
  for (const name of ["triggers", "conditions", "actions", "branches"]) {
    if (input[name] !== undefined && !Array.isArray(input[name])) {
      return { ok: false, error: `${name} must be an array` };
    }
  }

  const triggersRaw = Array.isArray(input.triggers) ? input.triggers : [];
  if (triggersRaw.length === 0) return { ok: false, error: "at least one trigger is required" };
  if (triggersRaw.length > RULE_LIMITS.triggersPerRule) {
    return { ok: false, error: `triggers must be ${RULE_LIMITS.triggersPerRule} or fewer` };
  }
  const triggers = triggersRaw.map(normalizeTrigger);
  if (triggers.some((trigger) => trigger === null)) {
    return { ok: false, error: "invalid trigger" };
  }

  const conditionsRaw = Array.isArray(input.conditions) ? input.conditions : [];
  if (conditionsRaw.length > RULE_LIMITS.conditionsPerPath) {
    return { ok: false, error: `conditions must be ${RULE_LIMITS.conditionsPerPath} or fewer` };
  }
  const conditionsProblem = conditionListProblem(conditionsRaw, "共通の条件");
  if (conditionsProblem) return { ok: false, error: conditionsProblem };
  const conditions = conditionsRaw.map(normalizeCondition);
  if (conditions.some((condition) => condition === null)) {
    return { ok: false, error: "invalid condition" };
  }

  const actionsRaw = Array.isArray(input.actions) ? input.actions : [];
  if (actionsRaw.length > RULE_LIMITS.actionsPerRule) {
    return { ok: false, error: `actions must be ${RULE_LIMITS.actionsPerRule} or fewer` };
  }
  const actions = actionsRaw.map(normalizeAction);
  if (actions.some((action) => action === null)) {
    return { ok: false, error: "invalid action" };
  }

  const branchesRaw = Array.isArray(input.branches) ? input.branches : [];
  if (branchesRaw.length > 20) return { ok: false, error: "too many branches" };
  for (const [index, rawBranch] of branchesRaw.entries()) {
    const branch = asRecord(rawBranch);
    if (!branch || !Array.isArray(branch.conditions)) continue;
    const problem = conditionListProblem(branch.conditions, `パス${index + 1}の条件`);
    if (problem) return { ok: false, error: problem };
  }
  const branches = branchesRaw.map(normalizePath);
  if (branches.some((branch) => branch === null)) {
    return { ok: false, error: "invalid branch" };
  }
  const totalActions =
    actions.length + (branches as RulePath[]).reduce((sum, branch) => sum + branch.actions.length, 0);
  if (totalActions > RULE_LIMITS.actionsPerRule) {
    return {
      ok: false,
      error: `total actions must be ${RULE_LIMITS.actionsPerRule} or fewer`,
    };
  }
  if (actions.length === 0 && branches.length === 0) {
    return { ok: false, error: "at least one action is required" };
  }
  const ruleTriggers = triggers as RuleTrigger[];
  const ruleActions = actions as RuleAction[];
  const ruleBranches = branches as RulePath[];
  if (ruleTriggers.some((trigger) => !hasTaskSubject(trigger.event))) {
    for (const action of [...ruleActions, ...ruleBranches.flatMap((branch) => branch.actions)]) {
      if (!ACTION_CAPABILITIES.find((capability) => capability.id === action.capability)?.requiresTask) continue;
      const taskId = configuredTaskId(action.params.task_id);
      if (taskId === null) {
        return { ok: false, error: `${action.capability} requires task triggers or a fixed task_id` };
      }
      action.params = { ...action.params, task_id: taskId };
    }
  }

  const definition: RuleDefinition = {
    version: 1,
    triggers: ruleTriggers,
    conditions: conditions as RuleCondition[],
  };
  if (ruleActions.length > 0) definition.actions = ruleActions;
  if (ruleBranches.length > 0) definition.branches = ruleBranches;
  return { ok: true, definition };
}
