import type { RuleAction, RuleCondition, RuleDefinition, RulePath, RuleTrigger } from "./types";

export type RuleEditorDraft = {
  name: string;
  description: string;
  triggers: RuleTrigger[];
  conditions: RuleCondition[];
  actions: RuleAction[];
  branches: RulePath[];
  useBranches: boolean;
};

export function ruleEditorDraft(
  source: { name: string; description: string; definition: RuleDefinition },
): RuleEditorDraft {
  return {
    name: source.name,
    description: source.description,
    triggers: source.definition.triggers,
    conditions: source.definition.conditions ?? [],
    actions: source.definition.actions ?? source.definition.branches?.[0]?.actions ?? [],
    branches: source.definition.branches ?? [],
    useBranches: Boolean(source.definition.branches?.length),
  };
}

/** Each editing mode retains its own draft until the rule is saved or replaced. */
export function toggleRuleBranches(draft: RuleEditorDraft, blankAction: RuleAction): RuleEditorDraft {
  if (draft.useBranches) return { ...draft, useBranches: false };
  return {
    ...draft,
    useBranches: true,
    branches: draft.branches.length > 0 ? draft.branches : [{
      name: "パス1",
      conditions: [],
      actions: draft.actions.length > 0 ? draft.actions : [blankAction],
    }],
  };
}

export function ruleEditorDefinition(draft: RuleEditorDraft): RuleDefinition {
  return {
    version: 1,
    triggers: draft.triggers,
    conditions: draft.conditions,
    ...(draft.useBranches ? { branches: draft.branches } : { actions: draft.actions }),
  };
}
