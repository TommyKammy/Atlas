import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api/errors";
import { withTransaction, type Queryable } from "@/lib/db";
import { getRoleByKey } from "@/lib/permissions";
import { lockSuperRoles, setUserDeactivated } from "@/lib/services/admin-user-access";
import type { ScimAuthContext } from "./auth";
import { invalidValue, ScimApiError, uniqueness } from "./errors";
import type { ScimUserFilter } from "./filter";
import {
  scimActiveFromPayload, scimEmailFromPayload, scimExternalIdFromPayload,
  scimNamePatchFromPayload, scimTitleFromPayload, scimUserNameFromPayload,
  userNameDrivesEmail, type ScimUserRow,
} from "./map";
import {
  emptyScimNameState, isScimEmail, mergeScimName, normalizeScimEmail,
  type ScimNamePatch, type ScimNameState,
} from "./patch";

type UserRow = {
  id: number;
  name: string;
  email: string | null;
  title: string;
  deactivated_at: Date | string | null;
  created_at: Date | string;
};

type IdentityRow = {
  id: number;
  idp: string;
  external_id: string | null;
  user_name: string;
  given_name: string | null;
  family_name: string | null;
  formatted_name: string | null;
  display_name: string | null;
  deleted_at: Date | string | null;
  updated_at: Date | string;
};

const IDP_LABELS = { entra: "Entra ID", okta: "Okta", generic: "SCIM" } as const;

function auditLabel(auth: ScimAuthContext): string {
  return `SCIM（${IDP_LABELS[auth.idp]}）`;
}

function identityNameState(identity: IdentityRow | null): ScimNameState {
  return {
    formatted: identity?.formatted_name ?? null,
    givenName: identity?.given_name ?? null,
    familyName: identity?.family_name ?? null,
    displayName: identity?.display_name ?? null,
  };
}

function identityUserNameFallback(user: UserRow): string {
  return user.email ?? `user-${user.id}`;
}

function idpChangeNote(previousIdp: string | null, currentIdp: string): string {
  if (previousIdp === null || previousIdp === currentIdp) return "";
  return `（IdP を ${previousIdp} から ${currentIdp} に変更）`;
}

async function auditScim(
  q: Queryable | null,
  auth: ScimAuthContext,
  action: string,
  userId: number,
  detail: string,
) {
  await audit(null, action, {
    workspaceId: auth.workspaceId,
    entity: "user",
    entityId: userId,
    summary: `${auditLabel(auth)}${detail}`,
  }, q ?? undefined);
}

function userNotFound(): ScimApiError {
  return new ScimApiError(404, "user not found");
}

/** Raised inside a transaction so the denial audit is written after rollback. */
export class ScimDeactivationDeniedError extends Error {
  readonly userId: number;
  readonly email: string;

  constructor(userId: number, email: string) {
    super("cannot deactivate the last active administrator");
    this.name = "ScimDeactivationDeniedError";
    this.userId = userId;
    this.email = email;
  }
}

/**
 * Run a SCIM mutation and convert a last-admin denial into a SCIM 400. The
 * denial audit uses a fresh connection only after the transaction has rolled
 * back and released its pooled client.
 */
export async function runScimMutation<T>(
  auth: ScimAuthContext,
  change: (q: Queryable) => Promise<T>,
): Promise<T> {
  try {
    return await withTransaction(change);
  } catch (error) {
    if (error instanceof ScimDeactivationDeniedError) {
      await auditScim(null, auth, "scim.user.deactivate_denied", error.userId,
        `で最後の有効な管理者の無効化を拒否: ${error.email}`);
      throw new ScimApiError(400, "cannot deactivate the last active administrator");
    }
    throw error;
  }
}

function parseId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function findScimUser(
  q: Queryable,
  workspaceId: number,
  rawId: string,
): Promise<ScimUserRow | null> {
  const id = parseId(rawId);
  if (id === null) return null;
  const result = await q.query(
    `SELECT u.id, u.name, u.email, u.title, u.deactivated_at, u.created_at,
       i.external_id, i.user_name AS identity_user_name,
       i.given_name AS identity_given_name, i.family_name AS identity_family_name,
       i.formatted_name AS identity_formatted_name, i.display_name AS identity_display_name,
       i.updated_at AS identity_updated_at, i.deleted_at AS identity_deleted_at
     FROM users u
     LEFT JOIN scim_identities i ON i.user_id = u.id AND i.workspace_id = $1
     WHERE u.id = $2`,
    [workspaceId, id],
  );
  const row = result.rows[0] as (ScimUserRow & { identity_deleted_at: Date | string | null }) | undefined;
  if (!row || row.identity_deleted_at !== null) return null;
  return row;
}

export async function listScimUsers(
  q: Queryable,
  workspaceId: number,
  filter: ScimUserFilter | null,
  startIndex: number,
  count: number,
): Promise<{ rows: ScimUserRow[]; total: number }> {
  const params: unknown[] = [workspaceId];
  const where = ["(i.id IS NULL OR i.deleted_at IS NULL)"];
  if (filter) {
    if (filter.field === "userName") {
      params.push(filter.value);
      where.push(`(CASE WHEN i.id IS NULL THEN u.email ELSE i.user_name END)::citext = $${params.length}`);
    } else if (filter.field === "email") {
      params.push(filter.value);
      where.push(`u.email = $${params.length}`);
    } else if (filter.field === "externalId") {
      params.push(filter.value);
      where.push(`i.external_id = $${params.length}`);
    } else {
      params.push(filter.value);
      where.push(`u.id::text = $${params.length}`);
    }
  }
  const from = `FROM users u LEFT JOIN scim_identities i
    ON i.user_id = u.id AND i.workspace_id = $1
    WHERE ${where.join(" AND ")}`;
  const counted = await q.query(`SELECT COUNT(*)::int AS total ${from}`, params);
  const total = Number(counted.rows[0]?.total ?? 0);
  const rows = await q.query(
    `SELECT u.id, u.name, u.email, u.title, u.deactivated_at, u.created_at,
       i.external_id, i.user_name AS identity_user_name,
       i.given_name AS identity_given_name, i.family_name AS identity_family_name,
       i.formatted_name AS identity_formatted_name, i.display_name AS identity_display_name,
       i.updated_at AS identity_updated_at
     ${from}
     ORDER BY u.id
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, count, Math.max(0, startIndex - 1)],
  );
  return { rows: rows.rows as ScimUserRow[], total };
}

async function lockUser(q: Queryable, id: number): Promise<UserRow> {
  const result = await q.query(
    `SELECT id, name, email, title, deactivated_at, created_at
     FROM users WHERE id = $1 FOR UPDATE`,
    [id],
  );
  const row = result.rows[0] as UserRow | undefined;
  if (!row) throw userNotFound();
  return row;
}

async function lockIdentity(q: Queryable, userId: number): Promise<IdentityRow | null> {
  const result = await q.query(
    `SELECT id, idp, external_id, user_name, given_name, family_name, formatted_name,
       display_name, deleted_at, updated_at
     FROM scim_identities WHERE user_id = $1 FOR UPDATE`,
    [userId],
  );
  return (result.rows[0] as IdentityRow | undefined) ?? null;
}

async function assertExternalIdAvailable(
  q: Queryable,
  workspaceId: number,
  idp: ScimAuthContext["idp"],
  externalId: string | null,
  userId: number,
) {
  if (externalId === null) return;
  const conflict = await q.query(
    `SELECT user_id FROM scim_identities
     WHERE workspace_id = $1 AND idp = $2 AND external_id = $3 AND user_id <> $4
       AND deleted_at IS NULL
     LIMIT 1`,
    [workspaceId, idp, externalId, userId],
  );
  if (conflict.rowCount) throw uniqueness("externalId is already used by another user");
}

async function upsertIdentity(
  q: Queryable,
  auth: ScimAuthContext,
  userId: number,
  userName: string,
  externalId: string | null | undefined,
  name: ScimNameState,
): Promise<{ created: boolean; previousIdp: string | null }> {
  const existing = await lockIdentity(q, userId);
  if (existing) {
    const nextExternalId = externalId === undefined ? existing.external_id : externalId;
    await assertExternalIdAvailable(q, auth.workspaceId, auth.idp, nextExternalId, userId);
    // A deleted binding is reusable with a fresh externalId, and one workspace
    // means the current token's IdP becomes authoritative.
    await q.query(
      `UPDATE scim_identities
       SET idp = $2, external_id = $3, user_name = $4,
         given_name = $5, family_name = $6, formatted_name = $7, display_name = $8,
         updated_at = now(), deleted_at = NULL
       WHERE user_id = $1`,
      [
        userId, auth.idp, nextExternalId, userName,
        name.givenName, name.familyName, name.formatted, name.displayName,
      ],
    );
    return { created: false, previousIdp: existing.idp };
  }
  await assertExternalIdAvailable(q, auth.workspaceId, auth.idp, externalId ?? null, userId);
  await q.query(
    `INSERT INTO scim_identities
       (workspace_id, user_id, idp, external_id, user_name,
        given_name, family_name, formatted_name, display_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      auth.workspaceId, userId, auth.idp, externalId ?? null, userName,
      name.givenName, name.familyName, name.formatted, name.displayName,
    ],
  );
  return { created: true, previousIdp: null };
}

/** Apply an active-state change; a last-admin rejection is converted by
 * runScimMutation after the surrounding transaction has rolled back. */
async function applyActive(
  q: Queryable,
  auth: ScimAuthContext,
  userId: number,
  email: string,
  active: boolean,
  wasActive: boolean,
) {
  if (active === wasActive) return;
  try {
    await setUserDeactivated(q, userId, !active);
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      throw new ScimDeactivationDeniedError(userId, email);
    }
    throw error;
  }
  await auditScim(q, auth, active ? "scim.user.activate" : "scim.user.deactivate", userId,
    `${active ? "でユーザーを有効化" : "でユーザーを無効化"}: ${email}`);
}

export async function createScimUser(
  q: Queryable,
  auth: ScimAuthContext,
  body: Record<string, unknown>,
): Promise<ScimUserRow> {
  const email = scimEmailFromPayload(body);
  if ("userName" in body && (typeof body.userName !== "string" || body.userName.trim() === "")) {
    throw invalidValue("userName must be a non-empty string");
  }
  const userName = scimUserNameFromPayload(body) ?? email;
  const namePatch = scimNamePatchFromPayload(body);
  const active = scimActiveFromPayload(body);
  const title = scimTitleFromPayload(body);
  const externalId = scimExternalIdFromPayload(body);

  await lockSuperRoles(q);
  const found = await q.query(
    `SELECT id, name, email, title, deactivated_at, created_at
     FROM users WHERE email = $1 FOR UPDATE`,
    [email],
  );
  const existing = found.rows[0] as UserRow | undefined;

  // RFC 7644 3.3: a POST for an already-active SCIM binding is a conflict,
  // even if the payload is identical. Deleted bindings and unmanaged Atlas
  // accounts remain bindable.
  const bindings = await q.query(
    `SELECT user_id, deleted_at FROM scim_identities
     WHERE workspace_id = $1 AND user_name = $2
     ORDER BY id FOR UPDATE`,
    [auth.workspaceId, userName],
  );
  if ((bindings.rows as { deleted_at: Date | string | null }[])
    .some((row) => row.deleted_at === null)) {
    throw uniqueness("userName is already linked to an active SCIM identity");
  }

  let userId: number;
  if (existing) {
    userId = existing.id;
    const identity = await lockIdentity(q, userId);
    if (identity?.deleted_at === null) {
      throw uniqueness("user is already linked to an active SCIM identity");
    }
    const merged = mergeScimName(identityNameState(identity), namePatch, email);
    const nameChanged = Object.keys(namePatch).length > 0;
    // Apply supplied profile fields the same way as a newly created account;
    // omitted fields keep the value already stored in Atlas.
    const titleChanged = title !== undefined && title !== existing.title;
    if (nameChanged || titleChanged) {
      await q.query(
        "UPDATE users SET name = $2, title = $3 WHERE id = $1",
        [userId, nameChanged ? merged.name : existing.name, titleChanged ? title : existing.title],
      );
    }
    await upsertIdentity(q, auth, userId, userName, externalId, merged.state);
    await auditScim(q, auth, "scim.user.bind", userId,
      `で既存ユーザーを結び付け: ${email}${idpChangeNote(identity?.idp ?? null, auth.idp)}`);
    if (nameChanged || titleChanged) {
      await auditScim(q, auth, "scim.user.update", userId, `でユーザーを更新: ${email}`);
    }
  } else {
    const role = await getRoleByKey("member", q);
    if (!role) throw new ScimApiError(500, "default role is not configured");
    const merged = mergeScimName(emptyScimNameState(), namePatch, email);
    const created = await q.query(
      `INSERT INTO users (name, email, title, is_guest, is_admin, role_id, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, NULL)
       RETURNING id`,
      [merged.name, email, title ?? "", role.isGuest, role.isAdmin, role.id],
    );
    userId = Number(created.rows[0].id);
    await upsertIdentity(q, auth, userId, userName, externalId, merged.state);
    await auditScim(q, auth, "scim.user.create", userId, `でユーザーを作成: ${email}`);
  }

  await applyActive(q, auth, userId, email, active, existing?.deactivated_at == null);
  const row = await findScimUser(q, auth.workspaceId, String(userId));
  if (!row) throw userNotFound();
  return row;
}

export type ScimUserUpdate = {
  userName?: string;
  email?: string;
  name?: ScimNamePatch;
  title?: string;
  externalId?: string | null;
  active?: boolean;
};

export async function updateScimUser(
  q: Queryable,
  auth: ScimAuthContext,
  rawId: string,
  fields: ScimUserUpdate,
): Promise<ScimUserRow> {
  const id = parseId(rawId);
  if (id === null) throw userNotFound();
  await lockSuperRoles(q);
  const user = await lockUser(q, id);
  const identity = await lockIdentity(q, id);
  if (identity?.deleted_at) throw userNotFound();

  const currentEmail = user.email ?? "";
  const oldUserName = identity?.user_name ?? null;
  let email = fields.email !== undefined ? normalizeScimEmail(fields.email) : currentEmail;
  if (fields.email === undefined && fields.userName !== undefined
      && userNameDrivesEmail(currentEmail, oldUserName) && isScimEmail(fields.userName)) {
    // users.email was created from userName; follow a UPN rename. When the
    // email came from emails[work] it stays put.
    email = normalizeScimEmail(fields.userName);
  }
  const identityUserName = fields.userName ?? oldUserName
    ?? (email || currentEmail || identityUserNameFallback(user));
  if (identity === null || (fields.userName !== undefined && fields.userName !== oldUserName)) {
    const userNameConflict = await q.query(
      `SELECT 1 FROM scim_identities
       WHERE workspace_id = $1 AND user_name = $2 AND user_id <> $3 AND deleted_at IS NULL
       LIMIT 1`,
      [auth.workspaceId, identityUserName, id],
    );
    if (userNameConflict.rowCount) throw uniqueness("userName is already linked to an active SCIM identity");
  }
  if (email !== "" && email !== currentEmail) {
    const conflict = await q.query(
      "SELECT id FROM users WHERE email = $1 AND id <> $2 LIMIT 1",
      [email, id],
    );
    if (conflict.rowCount) throw uniqueness("userName is already used by another user");
  }
  const finalExternalId = fields.externalId === undefined
    ? identity?.external_id ?? null
    : fields.externalId;
  await assertExternalIdAvailable(q, auth.workspaceId, auth.idp, finalExternalId, id);

  const namePatch = fields.name ?? {};
  const mergedName = mergeScimName(
    identityNameState(identity), namePatch, email || currentEmail || `user-${id}`,
  );

  const sets: string[] = [];
  const values: unknown[] = [];
  if (email !== "" && email !== currentEmail) {
    values.push(email);
    sets.push(`email = $${values.length}`);
  }
  if (fields.name !== undefined && Object.keys(namePatch).length > 0) {
    values.push(mergedName.name);
    sets.push(`name = $${values.length}`);
  }
  if (fields.title !== undefined) {
    values.push(fields.title.trim().slice(0, 120));
    sets.push(`title = $${values.length}`);
  }
  values.push(id);
  if (sets.length > 0) {
    await q.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
  }

  const identityResult = await upsertIdentity(
    q, auth, id, identityUserName, fields.externalId, mergedName.state,
  );
  const idpNote = idpChangeNote(identityResult.previousIdp, auth.idp);
  if (identityResult.created) {
    await auditScim(q, auth, "scim.user.bind", id,
      `で既存ユーザーを結び付け: ${email || currentEmail}${idpNote}`);
  }
  if (sets.length > 0 || fields.userName !== undefined || fields.externalId !== undefined
      || idpNote !== "") {
    await auditScim(q, auth, "scim.user.update", id,
      `でユーザーを更新: ${email || currentEmail}${idpNote}`);
  }
  if (fields.active !== undefined) {
    await applyActive(q, auth, id, email || currentEmail, fields.active, user.deactivated_at === null);
  }
  const row = await findScimUser(q, auth.workspaceId, String(id));
  if (!row) throw userNotFound();
  return row;
}

export async function deleteScimUser(
  q: Queryable,
  auth: ScimAuthContext,
  rawId: string,
): Promise<void> {
  const id = parseId(rawId);
  if (id === null) throw userNotFound();
  await lockSuperRoles(q);
  const user = await lockUser(q, id);
  const identity = await lockIdentity(q, id);
  if (identity?.deleted_at) throw userNotFound();
  const fallbackUserName = identity?.user_name ?? identityUserNameFallback(user);
  const contact = user.email ?? fallbackUserName;
  await applyActive(q, auth, id, contact, false, user.deactivated_at === null);
  if (identity) {
    await q.query(
      `UPDATE scim_identities
       SET idp = $2, updated_at = now(), deleted_at = now()
       WHERE user_id = $1`,
      [id, auth.idp],
    );
  } else {
    await q.query(
      `INSERT INTO scim_identities (workspace_id, user_id, idp, external_id, user_name, deleted_at)
       VALUES ($1, $2, $3, NULL, $4, now())`,
      [auth.workspaceId, id, auth.idp, fallbackUserName],
    );
  }
  await auditScim(q, auth, "scim.user.delete", id,
    `でユーザーを削除（無効化）: ${contact}${idpChangeNote(identity?.idp ?? null, auth.idp)}`);
}
