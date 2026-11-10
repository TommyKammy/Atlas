import { createHash, randomUUID } from "node:crypto";
import type { RuleDefinition } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function mapWebhookActions<T>(
  definition: T,
  map: (action: Record<string, unknown>, position: string) => Record<string, unknown>,
): T {
  if (!isRecord(definition)) return definition;
  const mapActions = (actions: unknown, path: string) => Array.isArray(actions)
    ? actions.map((action, index) => isRecord(action) && action.capability === "webhook.post"
      ? map(action, `${path}/${index}`)
      : action)
    : actions;
  return {
    ...definition,
    ...(Array.isArray(definition.actions) ? { actions: mapActions(definition.actions, "actions") } : {}),
    ...(Array.isArray(definition.branches) ? {
      branches: definition.branches.map((branch, index) => isRecord(branch)
        ? { ...branch, actions: mapActions(branch.actions, `branches/${index}`) }
        : branch),
    } : {}),
  };
}

export function hasWebhookAction(definition: unknown): boolean {
  if (!isRecord(definition)) return false;
  const containsWebhook = (actions: unknown) => Array.isArray(actions) && actions.some(
    (action) => isRecord(action) && action.capability === "webhook.post",
  );
  return containsWebhook(definition.actions) || (
    Array.isArray(definition.branches) &&
    definition.branches.some((branch) => isRecord(branch) && containsWebhook(branch.actions))
  );
}

const ACTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isWebhookActionReference(value: unknown): value is string {
  return typeof value === "string" && (ACTION_ID_PATTERN.test(value) || /^legacy:[0-9a-f]{64}$/.test(value));
}

function storedActionId(action: Record<string, unknown>): string | undefined {
  return typeof action.webhookActionId === "string" && ACTION_ID_PATTERN.test(action.webhookActionId)
    ? action.webhookActionId
    : undefined;
}

function actionReference(action: Record<string, unknown>, scope: string, position: string): string {
  return storedActionId(action) ?? `legacy:${createHash("sha256").update(`${scope}/${position}`).digest("hex")}`;
}

/** Only the owner needs the destination URL, which may itself contain credentials. */
export function redactWebhookDefinition<T>(definition: T, ownerScope?: string): T {
  return mapWebhookActions(definition, (action, position) => {
    const url = isRecord(action.params) ? action.params.url : undefined;
    return {
      capability: action.capability,
      params: ownerScope && typeof url === "string" ? { url } : {},
      ...(ownerScope ? { webhookActionId: actionReference(action, ownerScope, position) } : {}),
    };
  });
}

/** Copies need a destination and credentials configured by their new owner. */
export function copyRuleWithoutWebhookCredentials<T extends { definition: unknown; enabled?: boolean }>(
  rule: T,
): T {
  if (!hasWebhookAction(rule.definition)) return rule;
  return { ...rule, definition: redactWebhookDefinition(rule.definition), enabled: false };
}

/** A create never accepts client-supplied references to stored credentials. */
export function assignWebhookActionIds(definition: RuleDefinition): RuleDefinition {
  return mapWebhookActions(definition, (action) => ({ ...action, webhookActionId: randomUUID() }));
}

type StoredWebhook = { id?: string; url: unknown; secret: unknown };

/** Keep an omitted secret only for the same action and unchanged destination. */
export function retainWebhookSecrets(
  definition: RuleDefinition,
  previous: RuleDefinition,
  scope: string,
  referencesOnly = false,
): { ok: true; definition: RuleDefinition } | { ok: false; error: string } {
  const storedByReference = new Map<string, StoredWebhook | null>();
  const storedByUrl = new Map<string, StoredWebhook[]>();
  mapWebhookActions(previous, (action, position) => {
    const params = isRecord(action.params) ? action.params : {};
    const stored = { id: storedActionId(action), url: params.url, secret: params.secret };
    const reference = actionReference(action, scope, position);
    storedByReference.set(reference, storedByReference.has(reference) ? null : stored);
    if (typeof stored.url === "string") {
      storedByUrl.set(stored.url, [...(storedByUrl.get(stored.url) ?? []), stored]);
    }
    return action;
  });

  const incomingUrls = new Map<string, number>();
  let hasReferences = false;
  mapWebhookActions(definition, (action) => {
    const url = isRecord(action.params) ? action.params.url : undefined;
    if (typeof url === "string") incomingUrls.set(url, (incomingUrls.get(url) ?? 0) + 1);
    if (action.webhookActionId !== undefined) hasReferences = true;
    return action;
  });

  const usedReferences = new Set<string>();
  let error: string | undefined;
  const updated = mapWebhookActions(definition, (action) => {
    const params = isRecord(action.params) ? action.params : {};
    const { url, secret } = params;
    const reference = action.webhookActionId;
    let stored: StoredWebhook | undefined;
    if (reference !== undefined) {
      if (!isWebhookActionReference(reference) || usedReferences.has(reference)) {
        error = "invalid or duplicate webhook action reference";
        return action;
      }
      const previousAction = storedByReference.get(reference);
      if (!previousAction) {
        error = "invalid or duplicate webhook action reference";
        return action;
      }
      usedReferences.add(reference);
      stored = previousAction;
    } else if (!referencesOnly && !hasReferences && secret === undefined && typeof url === "string") {
      const candidates = storedByUrl.get(url) ?? [];
      if (candidates.some((candidate) => typeof candidate.secret === "string" && candidate.secret !== "")) {
        if (candidates.length !== 1 || incomingUrls.get(url) !== 1) {
          error = "webhook action reference required for an ambiguous destination";
          return action;
        }
        stored = candidates[0];
      }
    }

    const retainedSecret = stored?.url === url ? stored?.secret : undefined;
    return {
      ...action,
      webhookActionId: stored?.id ?? randomUUID(),
      params: secret === undefined && typeof retainedSecret === "string" ? { ...params, secret: retainedSecret } : params,
    };
  });
  return error ? { ok: false, error } : { ok: true, definition: updated };
}

function publicWebhookError(error: unknown): string | undefined {
  if (typeof error !== "string" || !error) return undefined;
  if (/^webhook returned [0-9]{3}$/.test(error)) return error;
  if ([
    "invalid webhook URL",
    "invalid webhook URL: expected HTTP(S) without credentials",
    "invalid webhook destination: only public IP addresses are allowed",
    "invalid webhook destination: redirects are not allowed",
    "webhook hostname could not be resolved",
    "webhook delivery outcome is unknown after the last attempt",
  ].includes(error)) return error;
  return "webhook request failed";
}

/** Strip both signing keys and credential-bearing URLs from stored and legacy history. */
export function redactWebhookRun<T extends { details?: unknown; error?: unknown }>(run: T): T {
  if (!Array.isArray(run.details)) return run;
  let webhookFailed = false;
  const details = run.details.map((detail) => {
    if (!isRecord(detail) || detail.capability !== "webhook.post") return detail;
    if (detail.status === "failed") webhookFailed = true;
    return {
      ...detail,
      params: {},
      error: publicWebhookError(detail.error),
    };
  });
  return {
    ...run,
    details,
    ...(webhookFailed ? { error: publicWebhookError(run.error) ?? null } : {}),
  };
}
