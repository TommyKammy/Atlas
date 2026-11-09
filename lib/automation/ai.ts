import { getRuleDescriptors, type DescriptorOption } from "./descriptors";
import type { RuleAction, RuleCondition, RuleDefinition, RuleTrigger } from "./types";
import { validateRuleDefinition } from "./validate";

function findOption(options: DescriptorOption[] | undefined, prompt: string): DescriptorOption | null {
  if (!options) return null;
  return options.find((option) => prompt.includes(String(option.label))) ?? null;
}

function statusId(value: unknown): string {
  return String(value);
}

/**
 * Local rule suggestion helper. Kept behind a single API so it can later be
 * replaced by an LLM without changing the rule schema or UI.
 */
export async function suggestRuleDefinition(
  projectId: number,
  viewerId: number,
  prompt: string,
): Promise<{ name: string; description: string; definition: RuleDefinition }> {
  const text = prompt.trim();
  const descriptors = await getRuleDescriptors(projectId, viewerId);
  const action = (id: string) => descriptors.actions.find((entry) => entry.id === id);
  const users = action("task.assign")?.params.find((param) => param.name === "user_id")?.options;
  const statuses = action("task.set_status")?.params.find((param) => param.name === "status")?.options;
  const sections = action("task.move_section")?.params.find((param) => param.name === "section_id")?.options;

  const triggers: RuleTrigger[] = [];
  if (/(マイルストーン(?:に|へ)?(?:変換|変更)|マイルストーンになった)/.test(text)) {
    triggers.push({ event: "task.milestone_changed" });
  } else if (/(期限超過|期限を過ぎ|overdue)/i.test(text)) {
    triggers.push({ event: "task.overdue", days: 0 });
  } else if (/(期日が近|期限が近|期日接近)/i.test(text)) {
    triggers.push({ event: "task.due_soon", days: 1 });
  } else if (/フォーム/.test(text)) {
    triggers.push({ event: "form.submitted" });
  } else if (/コメント/.test(text) && /(追加|投稿)/.test(text)) {
    triggers.push({ event: "comment.created" });
  } else if (/担当者/.test(text) && /(変更|設定|割り当て)/.test(text)) {
    triggers.push({ event: "task.assigned" });
  } else if (/セクション/.test(text)) {
    triggers.push({ event: "task.section_changed" });
  } else if (/期日/.test(text) && /(変更|設定)/.test(text)) {
    triggers.push({ event: "task.due_changed" });
  } else if (/完了/.test(text)) {
    triggers.push({ event: "task.completed" });
  } else {
    triggers.push({ event: "task.created" });
  }

  const conditions: RuleCondition[] = [];
  if (/未完了/.test(text)) conditions.push({ field: "task.completed", op: "eq", value: "false" });
  if (/完了済み/.test(text)) conditions.push({ field: "task.completed", op: "eq", value: "true" });
  if (/マイルストーン/.test(text)) {
    const regular = /(マイルストーン(?:以外|でない|ではない)|非マイルストーン)/.test(text);
    conditions.push({ field: "task.is_milestone", op: "eq", value: regular ? "false" : "true" });
  }

  const actions: RuleAction[] = [];
  const user = findOption(users, text);
  if (user && /(担当|割り当て|アサイン)/.test(text)) {
    actions.push({ capability: "task.assign", params: { user_id: Number(user.value) } });
  }
  const status = findOption(statuses, text);
  if (status && (/(ステータス|Status)/i.test(text) || text.includes(String(status.label)))) {
    actions.push({ capability: "task.set_status", params: { status: statusId(status.value) } });
  }
  const section = findOption(sections, text);
  if (/セクション/.test(text) && /(移動|変更)/.test(text) && section) {
    actions.push({ capability: "task.move_section", params: { section_id: Number(section.value) } });
  }
  const dayMatch = text.match(/(\d+)\s*日後/);
  if (/期日/.test(text) && /(設定|変更|後)/.test(text) && dayMatch) {
    actions.push({ capability: "task.set_due_date", params: { offset_days: Number(dayMatch[1]) } });
  }
  if (/完了/.test(text) && /(にする|完了させ|完了に)/.test(text) && triggers.some((trigger) => trigger.event !== "task.completed")) {
    actions.push({ capability: "task.complete", params: {} });
  }
  if (/サブタスク/.test(text)) {
    actions.push({
      capability: "task.create_subtask",
      params: { name: `${text.slice(0, 80)}`, due_offset_days: dayMatch ? Number(dayMatch[1]) : 3 },
    });
  }
  if (/(コメント|通知)/.test(text) && !/コメントが追加/.test(text)) {
    actions.push({
      capability: "task.add_comment",
      params: { body: `ルールが実行されました: {{task.name}}` },
    });
  }
  const url = text.match(/https?:\/\/[^\s]+/);
  if (url || /webhook/i.test(text)) {
    actions.push({
      capability: "webhook.post",
      params: { url: url?.[0] ?? "" },
    });
  }
  if (actions.length === 0) {
    actions.push({
      capability: "task.add_comment",
      params: { body: `ルールが実行されました: {{task.name}}` },
    });
  }

  const raw: RuleDefinition = {
    version: 1,
    triggers,
    conditions,
    actions,
  };
  const validated = validateRuleDefinition(raw);
  if (!validated.ok) {
    throw new Error(validated.error);
  }
  return {
    name: text.length > 60 ? `${text.slice(0, 60)}…` : text || "AI提案ルール",
    description: "ローカルAIアシストが生成したルール案です。内容を確認して保存してください。",
    definition: validated.definition,
  };
}

/** Portfolio suggestion: reuse the project heuristic and drop project-only actions. */
export async function suggestPortfolioRuleDefinition(
  portfolioId: number,
  viewerId: number,
  prompt: string,
  firstProjectId: number,
): Promise<{ name: string; description: string; definition: RuleDefinition }> {
  const suggestion = await suggestRuleDefinition(firstProjectId, viewerId, prompt);
  const first = (suggestion.definition.actions ?? [])[0];
  const supported = new Set([
    "task.assign",
    "task.set_status",
    "task.set_due_date",
    "task.complete",
    "task.create",
    "task.add_comment",
    "task.create_subtask",
    "project.set_status",
    "task.add_to_project",
    "webhook.post",
  ]);
  const branchActions = suggestion.definition.branches?.map((branch) => ({
    ...branch,
    actions: branch.actions.filter((action) => supported.has(action.capability)),
  }));
  const actions = (suggestion.definition.actions ?? []).filter((action) =>
    supported.has(action.capability),
  );
  const definition = {
    version: 1 as const,
    triggers: suggestion.definition.triggers,
    conditions: suggestion.definition.conditions,
    ...(branchActions && branchActions.length > 0
      ? { branches: branchActions.filter((branch) => branch.actions.length > 0) }
      : { actions: actions.length > 0 ? actions : first ? [first] : [] }),
  };
  const validated = validateRuleDefinition(definition);
  if (!validated.ok) throw new Error(validated.error);
  return {
    name: suggestion.name,
    description: "ポートフォリオ用に生成したルール案です。内容を確認して保存してください。",
    definition: validated.definition,
  };
}
