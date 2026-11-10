import type { DomainEventRow } from "../domain/events";
import { configuredTaskId } from "./task-target";
import type { RuleAction, RuleCondition, RuleDefinition } from "./types";

export type RuleSnapshot = {
  task: Record<string, unknown> | null;
  project: Record<string, unknown> | null;
  custom: Record<string, unknown>;
  event: DomainEventRow;
};

export type RuleConditionEvaluation = {
  index: number;
  field: string;
  op: RuleCondition["op"];
  evaluated: boolean;
  matched: boolean | null;
  reason: string;
  value?: unknown;
  actual?: unknown;
};

export type RuleEvaluationTrace = {
  matched: boolean;
  reason: string;
  triggers: { index: number; event: string; matched: boolean; reason: string }[];
  conditions: RuleConditionEvaluation[];
  branches: {
    index: number; name: string; else: boolean; evaluated: boolean;
    matched: boolean | null; selected: boolean; reason: string;
    conditions: RuleConditionEvaluation[];
  }[];
  selected_branch: number | null;
};

export type RulePreviewResponse = {
  preview: true;
  trace: RuleEvaluationTrace;
  actions: (RuleAction & { reason: string })[];
  warnings: string[];
};

function pathValue(source: unknown, path: string): unknown {
  let current = source;
  for (const part of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function actualValue(condition: RuleCondition, snapshot: RuleSnapshot): unknown {
  if (condition.field.startsWith("task.")) return snapshot.task ? pathValue(snapshot.task, condition.field.slice(5)) : undefined;
  if (condition.field.startsWith("project.")) return snapshot.project ? pathValue(snapshot.project, condition.field.slice(8)) : undefined;
  if (condition.field.startsWith("custom.")) return snapshot.custom[condition.field.slice(7)];
  if (condition.field.startsWith("event.")) return pathValue(snapshot.event, condition.field.slice(6));
  return pathValue({ task: snapshot.task, project: snapshot.project }, condition.field);
}

function comparable(actual: unknown): string | number | boolean | null {
  if (actual === null || actual === undefined) return null;
  if (typeof actual === "number" || typeof actual === "boolean") return actual;
  if (typeof actual === "string") {
    if (actual === "true") return true;
    if (actual === "false") return false;
    return actual;
  }
  return JSON.stringify(actual);
}

export function matchRuleCondition(condition: RuleCondition, snapshot: RuleSnapshot): boolean {
  const actual = actualValue(condition, snapshot);
  const expected = condition.value;
  const a = comparable(actual);
  const e = comparable(expected);
  switch (condition.op) {
    case "eq": return a === e || (a !== null && e !== null && String(a) === String(e));
    case "neq": return !(a === e || (a !== null && e !== null && String(a) === String(e)));
    case "contains": return Array.isArray(actual) ? actual.map(String).includes(String(expected)) : a !== null && String(a).includes(String(expected ?? ""));
    case "not_contains": return Array.isArray(actual) ? !actual.map(String).includes(String(expected)) : a === null || !String(a).includes(String(expected ?? ""));
    case "in": return a !== null && (Array.isArray(expected) ? expected.map(String) : [String(expected ?? "")]).includes(String(a));
    case "not_in": return a === null || !(Array.isArray(expected) ? expected.map(String) : [String(expected ?? "")]).includes(String(a));
    case "is_empty": return actual === null || actual === undefined || actual === "" || (Array.isArray(actual) && actual.length === 0);
    case "is_not_empty": return !(actual === null || actual === undefined || actual === "" || (Array.isArray(actual) && actual.length === 0));
    case "gt": case "gte": case "lt": case "lte": {
      const left = typeof a === "number" ? a : Number(a);
      const right = typeof e === "number" ? e : Number(e);
      const [l, r] = Number.isFinite(left) && Number.isFinite(right) ? [left, right] : [String(a ?? ""), String(e ?? "")];
      if (condition.op === "gt") return l > r;
      if (condition.op === "gte") return l >= r;
      if (condition.op === "lt") return l < r;
      return l <= r;
    }
    default: return false;
  }
}

export function renderRuleTemplate(value: unknown, snapshot: RuleSnapshot): unknown {
  if (typeof value === "string") return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, raw: string) => {
    const path = raw.trim();
    const resolved = path.startsWith("task.") && snapshot.task ? pathValue(snapshot.task, path.slice(5))
      : path.startsWith("project.") && snapshot.project ? pathValue(snapshot.project, path.slice(8))
        : path.startsWith("custom.") ? snapshot.custom[path.slice(7)]
          : path.startsWith("event.") ? pathValue(snapshot.event, path.slice(6)) : undefined;
    return resolved === null || resolved === undefined ? "" : String(resolved);
  });
  if (Array.isArray(value)) return value.map((entry) => renderRuleTemplate(entry, snapshot));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => [key, renderRuleTemplate(entry, snapshot)]));
  return value;
}

export function renderRuleActions(actions: RuleAction[], snapshot: RuleSnapshot): RuleAction[] {
  return actions.map((action) => {
    const { task_id, ...rest } = action.params ?? {};
    const params = renderRuleTemplate(rest, snapshot) as Record<string, unknown>;
    const taskId = snapshot.event.subject_type === "task" ? snapshot.event.subject_id : configuredTaskId(task_id);
    if (taskId !== null) params.task_id = taskId;
    return { capability: action.capability, params };
  });
}

function triggerTrace(definition: RuleDefinition, event: DomainEventRow, ruleId?: number): RuleEvaluationTrace["triggers"] {
  const target = event.data?.target_rule_id;
  return (definition.triggers ?? []).map((trigger, index) => {
    if (target !== undefined && Number(target) !== ruleId) return { index, event: trigger.event, matched: false, reason: "対象のルールIDが異なります" };
    if (trigger.event !== event.type) return { index, event: trigger.event, matched: false, reason: "イベントの種類が異なります" };
    const matched = !trigger.filters || Object.entries(trigger.filters).every(([key, value]) =>
      String(pathValue(event.data, key) ?? pathValue(event, key)) === String(value));
    return { index, event: trigger.event, matched, reason: matched ? "イベントの種類とフィルターが一致しました" : "イベントのフィルターが一致しません" };
  });
}

export function ruleTriggersMatch(definition: RuleDefinition, event: DomainEventRow, ruleId?: number): boolean {
  return triggerTrace(definition, event, ruleId).some((trigger) => trigger.matched);
}

function conditionTrace(conditions: RuleCondition[], snapshot: RuleSnapshot, evaluate: boolean): RuleConditionEvaluation[] {
  let remaining = evaluate;
  return conditions.map((condition, index) => {
    const evaluated = remaining;
    const matched = evaluated ? matchRuleCondition(condition, snapshot) : null;
    if (matched === false) remaining = false;
    return {
      index, field: condition.field, op: condition.op, evaluated, matched,
      reason: !evaluated ? "前の評価で対象外となったため評価していません" : matched ? "条件に一致しました" : "条件に一致しません",
      value: condition.value,
      ...(evaluated ? { actual: actualValue(condition, snapshot) ?? null } : {}),
    };
  });
}

/** Pure evaluator shared by the durable runner and the side-effect-free preview. */
export function evaluateRule(definition: RuleDefinition, snapshot: RuleSnapshot, ruleId?: number): { trace: RuleEvaluationTrace; actions: RuleAction[] } {
  const triggers = triggerTrace(definition, snapshot.event, ruleId);
  const triggerMatched = triggers.some((trigger) => trigger.matched);
  const conditions = conditionTrace(definition.conditions ?? [], snapshot, triggerMatched);
  const globalMatched = triggerMatched && conditions.every((condition) => condition.matched === true);
  const paths = definition.branches ?? [];
  const branches: RuleEvaluationTrace["branches"] = paths.map((path, index) => ({
    index, name: path.name, else: path.else === true, evaluated: false, matched: null, selected: false,
    reason: "前の評価で対象外となったため評価していません", conditions: conditionTrace(path.conditions, snapshot, false),
  }));
  let selected: number | null = null;
  if (globalMatched) {
    for (const [index, path] of paths.entries()) {
      if (path.else === true || selected !== null) continue;
      const result = conditionTrace(path.conditions, snapshot, true);
      const matched = result.every((condition) => condition.matched === true);
      branches[index] = { ...branches[index], evaluated: true, matched, selected: matched, conditions: result,
        reason: matched ? "最初に条件が一致したパスを選びました" : "パスの条件が一致しません" };
      if (matched) selected = index;
    }
    if (selected === null) {
      const fallback = paths.findIndex((path) => path.else === true);
      if (fallback >= 0) {
        selected = fallback;
        branches[fallback] = { ...branches[fallback], evaluated: true, matched: true, selected: true,
          reason: "他のパスが一致しなかったためelseパスを選びました" };
      }
    }
  }
  const configured = !globalMatched ? [] : paths.length > 0 ? selected === null ? [] : paths[selected].actions : definition.actions ?? [];
  const matched = configured.length > 0;
  return {
    trace: {
      matched, triggers, conditions, branches, selected_branch: selected,
      reason: !triggerMatched ? "トリガーに一致しません" : !globalMatched ? "ルール全体の条件に一致しません"
        : paths.length > 0 && selected === null ? "一致するパスがありません" : !matched ? "実行対象のアクションがありません" : "アクションの実行条件に一致しました",
    },
    actions: renderRuleActions(configured, snapshot),
  };
}

/** History readers need the decision, not copied task, webhook or comparison values. */
export function historyRuleEvaluation(trace: RuleEvaluationTrace): RuleEvaluationTrace {
  const conditions = (rows: RuleConditionEvaluation[]) => rows.map((row) => ({
    index: row.index, field: row.field, op: row.op, evaluated: row.evaluated, matched: row.matched, reason: row.reason,
  }));
  return { ...trace, conditions: conditions(trace.conditions), branches: trace.branches.map((branch) => ({ ...branch, conditions: conditions(branch.conditions) })) };
}
