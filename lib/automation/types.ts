import type { DomainEventType } from "../domain/events";
import type { RuleEvaluationTrace } from "./evaluation";

export type RuleFilter = Record<string, unknown>;

export type RuleTrigger = {
  event: DomainEventType;
  filters?: RuleFilter;
  /** For date triggers: days before due / days overdue. */
  days?: number;
};

export type ConditionOperator =
  | "eq"
  | "neq"
  | "contains"
  | "not_contains"
  | "in"
  | "not_in"
  | "is_empty"
  | "is_not_empty"
  | "gt"
  | "gte"
  | "lt"
  | "lte";

export type RuleCondition = {
  field: string;
  op: ConditionOperator;
  value?: unknown;
};

export type RuleAction = {
  capability: string;
  params: Record<string, unknown>;
  webhookActionId?: string;
};

export type RulePath = {
  name: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
  else?: boolean;
};

export type RuleDefinition = {
  version: 1;
  triggers: RuleTrigger[];
  conditions?: RuleCondition[];
  actions?: RuleAction[];
  branches?: RulePath[];
};

export type ProjectRule = {
  id: number;
  workspace_id: number;
  project_id: number;
  name: string;
  description: string;
  definition: RuleDefinition;
  owner_id: number | null;
  owner_name: string | null;
  enabled: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  last_run_status: string | null;
};

export type RuleRunActionDetail = {
  index: number;
  capability: string;
  params: Record<string, unknown>;
  status: "success" | "failed";
  error?: string;
  attempts?: number;
  result?: unknown;
};

export type RuleRun = {
  id: number;
  rule_id: number | null;
  event_id: number | null;
  rule_name: string;
  rule_version: number;
  owner_id: number | null;
  owner_name: string | null;
  source: string;
  status: "success" | "failed" | "skipped";
  actions_total: number;
  actions_succeeded: number;
  actions_failed: number;
  error: string | null;
  details: RuleRunActionDetail[];
  evaluation?: RuleEvaluationTrace;
  started_at: string;
  finished_at: string | null;
};

export type ManualRuleExecution = {
  event_id: number;
  status: "queued" | "success" | "failed" | "skipped";
  error: string | null;
};

export const RULE_LIMITS = {
  rulesPerProject: 50,
  triggersPerRule: 20,
  actionsPerRule: 20,
  conditionsPerPath: 30,
  chainDepth: 8,
  maxActionTargets: 150,
} as const;

export const CONDITION_OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: "eq", label: "等しい" },
  { value: "neq", label: "等しくない" },
  { value: "contains", label: "含む" },
  { value: "not_contains", label: "含まない" },
  { value: "in", label: "いずれか" },
  { value: "not_in", label: "いずれでもない" },
  { value: "is_empty", label: "空である" },
  { value: "is_not_empty", label: "空でない" },
  { value: "gt", label: "より大きい" },
  { value: "gte", label: "以上" },
  { value: "lt", label: "より小さい" },
  { value: "lte", label: "以下" },
];

export function isConditionOperator(value: unknown): value is ConditionOperator {
  return CONDITION_OPERATORS.some((entry) => entry.value === value);
}
