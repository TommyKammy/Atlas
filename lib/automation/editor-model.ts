import type { RuleDescriptors } from "./descriptors";
import { ruleEditorDefinition, type RuleEditorDraft } from "./editor-draft";
import type { RuleAction, RuleCondition, RuleDefinition } from "./types";
import { ruleConditionType, ruleVariables } from "./no-code-inputs";
import { conditionInputProblem } from "./condition-schema";

type EditorAction = RuleAction & { editorKey?: string };
export type RuleEditorDocument = RuleEditorDraft & { enabled: boolean };
type SavedEditorDocument = { name: string; description: string; definition: RuleDefinition; enabled: boolean };
const actionKey = (action: RuleAction) => (action as EditorAction).editorKey;

export function withEditorKeys(document: RuleEditorDocument, makeKey = () => crypto.randomUUID()): RuleEditorDocument {
  const keys = new Map<RuleAction, string>();
  const apply = (action: RuleAction): EditorAction => {
    if (actionKey(action)) return action;
    const key = keys.get(action) ?? makeKey();
    keys.set(action, key);
    return { ...action, editorKey: key };
  };
  return { ...document, actions: document.actions.map(apply), branches: document.branches.map((branch) => ({ ...branch, actions: branch.actions.map(apply) })) };
}

function publicAction(action: RuleAction): RuleAction {
  const copy = { ...action } as EditorAction;
  delete copy.editorKey;
  return copy;
}
export type RuleEditorSelection =
  | { kind: "trigger"; index: number }
  | { kind: "conditions" }
  | { kind: "branch"; index: number }
  | { kind: "action"; index: number; branch?: number };

export function editorPayload(document: RuleEditorDocument) {
  const definition = ruleEditorDefinition(document);
  return { name: document.name, description: document.description, enabled: document.enabled,
    definition: { ...definition, ...(definition.actions ? { actions: definition.actions.map(publicAction) } : {}),
      ...(definition.branches ? { branches: definition.branches.map((branch) => ({ ...branch, actions: branch.actions.map(publicAction) })) } : {}) },
  };
}

export function editorSignature(document: RuleEditorDocument): string {
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted)
    : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sorted(entry)])) : value;
  return JSON.stringify(sorted(editorPayload(document)));
}

/** Adopt server credential references without dropping the inactive editor mode. */
export function canonicalEditorDocument(current: RuleEditorDocument, saved: SavedEditorDocument): RuleEditorDocument {
  const withKeys = (actions: RuleAction[], previous: RuleAction[]) => actions.map((action, index) => ({ ...action, ...(previous[index] && actionKey(previous[index]) ? { editorKey: actionKey(previous[index]) } : {}) }));
  return { ...rebaseEditorCredentials(current, current, saved), name: saved.name, description: saved.description, enabled: saved.enabled,
    triggers: saved.definition.triggers, conditions: saved.definition.conditions ?? [],
    ...(current.useBranches ? { branches: (saved.definition.branches ?? []).map((branch, index) => ({ ...branch, actions: withKeys(branch.actions, current.branches[index]?.actions ?? []) })) }
      : { actions: withKeys(saved.definition.actions ?? [], current.actions) }),
  };
}

/** Rebase credentials by stable UI identity, including edits/reordering during save. */
export function rebaseEditorCredentials(current: RuleEditorDocument, sent: RuleEditorDocument, saved: SavedEditorDocument): RuleEditorDocument {
  const byKey = new Map<string, { before: RuleAction; after: RuleAction }>();
  const capture = (before: RuleAction[], after: RuleAction[]) => before.forEach((action, index) => {
    const key = actionKey(action);
    if (key && after[index]) byKey.set(key, { before: action, after: after[index] });
  });
  if (sent.useBranches) sent.branches.forEach((branch, index) => capture(branch.actions, saved.definition.branches?.[index]?.actions ?? []));
  else capture(sent.actions, saved.definition.actions ?? []);
  const rebase = (action: RuleAction): RuleAction => {
    const entry = byKey.get(actionKey(action) ?? "");
    if (!entry || action.capability !== "webhook.post" || entry.after.capability !== action.capability) return action;
    const params = { ...action.params };
    if (params.secret === entry.before.params.secret) delete params.secret;
    return { ...action, webhookActionId: entry.after.webhookActionId, params };
  };
  return { ...current, actions: current.actions.map(rebase), branches: current.branches.map((branch) => ({ ...branch, actions: branch.actions.map(rebase) })) };
}

export function duplicateRuleAction(action: RuleAction): RuleAction {
  const copied = structuredClone(action);
  delete (copied as EditorAction).editorKey;
  if (copied.capability === "webhook.post") {
    // A copied credential reference must never be attached to a new identity.
    delete copied.webhookActionId;
    copied.params.url = "";
    delete copied.params.secret;
    delete copied.params.signing_secret;
  }
  return copied;
}

export function moveEditorItem<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function conditionSummary(condition: RuleCondition, descriptors: RuleDescriptors): string {
  const field = descriptors.conditionFields.find((entry) => entry.id === condition.field);
  const operator = descriptors.operators.find((entry) => entry.value === condition.op)?.label ?? condition.op;
  if (condition.op === "is_empty" || condition.op === "is_not_empty") return `${field?.label ?? condition.field} が${operator}`;
  if (conditionInputProblem(condition, ruleConditionType(condition.field, descriptors))) return `${field?.label ?? condition.field} ${operator}［入力を確認］`;
  const values = Array.isArray(condition.value) ? condition.value : [condition.value];
  const text = values.map((value) => field?.options?.find((option) => String(option.value) === String(value))?.label ?? String(value ?? "未設定")).join("、");
  return `${field?.label ?? condition.field} ${operator}「${text}」`;
}

export function actionSummary(action: RuleAction, descriptors: RuleDescriptors): string {
  const description = descriptors.actions.find((entry) => entry.id === action.capability);
  const values = (description?.params ?? []).filter((param) => param.type !== "password")
    .flatMap((param) => {
      const value = action.params[param.name];
      if (value === undefined || value === null || value === "") return [];
      if (param.name === "url") return ["送信先を設定済み"];
      if (param.name === "task_id") return ["指定したタスク"];
      if ((param.name === "offset_days" || param.name.endsWith("_offset_days")) && Number.isFinite(Number(value))) {
        const days = Number(value);
        return [days === 0 ? "今日" : days === 1 ? "翌日" : days < 0 ? `${Math.abs(days)}日前` : `${days}日後`];
      }
      const text = param.options?.find((option) => String(option.value) === String(value))?.label ??
        (Array.isArray(value) ? value.join("、") : String(value));
      return [text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, path: string) =>
        `［${ruleVariables(descriptors).find((variable) => variable.path === path.trim())?.label ?? path.trim()}］`)];
    });
  return values.join(" / ") || "クリックして設定";
}

export function editorSummary(document: RuleEditorDocument, descriptors: RuleDescriptors): string {
  const triggers = document.triggers.map((trigger) => descriptors.triggers.find((entry) => entry.id === trigger.event)?.label ?? trigger.event);
  const conditions = document.conditions.map((condition) => conditionSummary(condition, descriptors));
  const actions = document.useBranches ? `${document.branches.length}つのパスを上から判定し、最初に一致したパスを実行します。`
    : document.actions.map((action) => descriptors.actions.find((entry) => entry.id === action.capability)?.label ?? action.capability).join(" → ") + "を順番に実行します。";
  return `${triggers.join("、または")}、${conditions.length ? conditions.join("、かつ") + "の場合に、" : ""}${actions}`;
}

export type RuleEditorProblem = { label: string; selection?: RuleEditorSelection; conditionIndex?: number };

export function editorProblems(document: RuleEditorDocument, descriptors?: RuleDescriptors): RuleEditorProblem[] {
  const result: RuleEditorProblem[] = [];
  const checkConditions = (conditions: RuleCondition[], label: string, selection: RuleEditorSelection) => {
    conditions.forEach((condition, conditionIndex) => {
      const problem = conditionInputProblem(condition, descriptors ? ruleConditionType(condition.field, descriptors) : undefined);
      if (problem) result.push({ label: `${label} ${conditionIndex + 1}：${problem}`, selection, conditionIndex });
    });
  };
  if (!document.name.trim()) result.push({ label: "ルール名を入力してください" });
  if (!document.triggers.length) result.push({ label: "きっかけを追加してください" });
  checkConditions(document.conditions, "共通の条件", { kind: "conditions" });
  if (document.useBranches) {
    if (!document.branches.length) result.push({ label: "分岐を追加してください" });
    document.branches.forEach((branch, index) => {
      checkConditions(branch.conditions, `${branch.name || `パス${index + 1}`}の条件`, { kind: "branch", index });
      if (!branch.actions.length) result.push({ label: `${branch.name}にアクションを追加してください`, selection: { kind: "branch", index } });
    });
  } else if (!document.actions.length) result.push({ label: "実行することを追加してください", selection: { kind: "conditions" } });
  return result;
}

export type EditorHistory = { past: RuleEditorDocument[]; present: RuleEditorDocument; future: RuleEditorDocument[] };
export type EditorHistoryAction = { type: "change" | "canonical"; document: RuleEditorDocument } | { type: "reset"; document: RuleEditorDocument }
  | { type: "rebase"; sent: RuleEditorDocument; saved: SavedEditorDocument } | { type: "undo" | "redo" };
export function editorHistory(state: EditorHistory, action: EditorHistoryAction): EditorHistory {
  if (action.type === "reset") return { past: [], present: action.document, future: [] };
  if (action.type === "canonical") return { ...state, present: action.document };
  if (action.type === "rebase") {
    const apply = (document: RuleEditorDocument) => rebaseEditorCredentials(document, action.sent, action.saved);
    return { past: state.past.map(apply), present: apply(state.present), future: state.future.map(apply) };
  }
  if (action.type === "change") {
    if (JSON.stringify(action.document) === JSON.stringify(state.present)) return state;
    return { past: [...state.past.slice(-39), state.present], present: action.document, future: [] };
  }
  if (action.type === "undo" && state.past.length) return {
    past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future],
  };
  if (action.type === "redo" && state.future.length) return {
    past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1),
  };
  return state;
}
