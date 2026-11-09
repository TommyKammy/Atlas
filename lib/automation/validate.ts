import { DOMAIN_EVENT_TYPES, type DomainEventType } from "../domain/events";
import { ACTION_DESCRIPTORS } from "./descriptors";
import {
  isConditionOperator,
  RULE_LIMITS,
  type RuleAction,
  type RuleCondition,
  type RuleDefinition,
  type RulePath,
  type RuleTrigger,
} from "./types";

const ACTION_IDS = new Set(ACTION_DESCRIPTORS.map((action) => action.id));
const EVENT_IDS = new Set<string>(DOMAIN_EVENT_TYPES);
const REQUIRED_PARAMS: Record<string, string[]> = {
  "task.assign": ["user_id"],
  "task.set_status": ["status"],
  "task.move_section": ["section_id"],
  "task.add_comment": ["body"],
  "task.create_subtask": ["name"],
  "task.create": ["name"],
  "task.set_custom_field": ["field_id", "value"],
  "project.set_status": ["status"],
  "task.add_to_project": ["project_id"],
  "webhook.post": ["url"],
};

function hasRequiredParams(capability: string, params: Record<string, unknown>): boolean {
  const required = REQUIRED_PARAMS[capability] ?? [];
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
    const days = Number(item.days);
    if (!Number.isFinite(days) || days < 0 || days > 365) return null;
    trigger.days = Math.floor(days);
  }
  return trigger;
}

function normalizeCondition(raw: unknown): RuleCondition | null {
  const item = asRecord(raw);
  if (!item || typeof item.field !== "string" || item.field.trim() === "") return null;
  if (!isConditionOperator(item.op)) return null;
  return {
    field: item.field.trim(),
    op: item.op,
    value: item.value,
  };
}

function normalizeAction(raw: unknown): RuleAction | null {
  const item = asRecord(raw);
  if (!item || typeof item.capability !== "string" || !ACTION_IDS.has(item.capability)) {
    return null;
  }
  const descriptor = ACTION_DESCRIPTORS.find((action) => action.id === item.capability);
  const params = asRecord(item.params) ?? {};
  if (descriptor && !hasRequiredParams(item.capability, params)) return null;
  return { capability: item.capability, params };
}

function normalizePath(raw: unknown): RulePath | null {
  const item = asRecord(raw);
  if (!item) return null;
  const conditions = Array.isArray(item.conditions)
    ? item.conditions.map(normalizeCondition)
    : [];
  const actions = Array.isArray(item.actions) ? item.actions.map(normalizeAction) : [];
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

  const definition: RuleDefinition = {
    version: 1,
    triggers: triggers as RuleTrigger[],
    conditions: conditions as RuleCondition[],
  };
  if (actions.length > 0) definition.actions = actions as RuleAction[];
  if (branches.length > 0) definition.branches = branches as RulePath[];
  return { ok: true, definition };
}
