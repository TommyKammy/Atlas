import type { RuleAction } from "./types";
import type { RuleEvaluationTrace, RulePreviewResponse } from "./evaluation";

const sensitiveKey = /^(?:secret|token|authorization|cookie|password|api_?key)$/i;
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => [key, sensitiveKey.test(key) ? "[REDACTED]" : redact(entry)]));
  return value;
}

/** Preview never loads stored signing keys, and still redacts supplied test secrets. */
export function previewResponse(trace: RuleEvaluationTrace, actions: RuleAction[], warnings: string[]): RulePreviewResponse {
  const condition = (row: RuleEvaluationTrace["conditions"][number]) => {
    const result = redact(row) as typeof row;
    if (row.field.split(".").some((part) => sensitiveKey.test(part))) {
      if (Object.hasOwn(result, "actual")) result.actual = "[REDACTED]";
      if (Object.hasOwn(result, "value")) result.value = "[REDACTED]";
    }
    return result;
  };
  return {
    preview: true,
    trace: { ...trace, conditions: trace.conditions.map(condition), branches: trace.branches.map((branch) => ({ ...branch, conditions: branch.conditions.map(condition) })) },
    actions: actions.map((action) => ({
      capability: action.capability,
      params: action.capability === "webhook.post" ? {} : redact(action.params) as Record<string, unknown>,
      reason: action.capability === "webhook.post" ? "送信しません。接続先・署名キーは表示から除外しました。" : "条件に一致したため展開しました。実行・保存はしていません。",
    })),
    warnings,
  };
}
