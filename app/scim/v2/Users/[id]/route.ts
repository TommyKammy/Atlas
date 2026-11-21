import { db } from "@/lib/db";
import { readScimJsonObject } from "@/lib/scim/body";
import { invalidSyntax, ScimApiError, scimJsonResponse } from "@/lib/scim/errors";
import {
  scimActiveFromPayload, scimEmailFromPayload, scimExternalIdFromPayload,
  scimNamePatchFromPayload, scimTitleFromPayload, scimUserNameFromPayload, scimUserResource,
} from "@/lib/scim/map";
import { applyScimPatch, type ScimPatchOperation } from "@/lib/scim/patch";
import { withScimAuth } from "@/lib/scim/route";
import {
  deleteScimUser, findScimUser, runScimMutation, updateScimUser, type ScimUserUpdate,
} from "@/lib/scim/users";

function operationsFromBody(body: Record<string, unknown>): ScimPatchOperation[] {
  const raw = body.Operations ?? body.operations;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw invalidSyntax("Operations must be a non-empty array");
  }
  return raw as ScimPatchOperation[];
}

export const GET = withScimAuth(async (_req, { auth, params, origin }) => {
  const row = await findScimUser(db, auth.workspaceId, params.id);
  if (!row) throw new ScimApiError(404, "user not found");
  return scimJsonResponse(scimUserResource(row, origin));
});

export const PUT = withScimAuth(async (req, { auth, params, origin }) => {
  const body = await readScimJsonObject(req);
  const fields: ScimUserUpdate = {};
  if (body.emails !== undefined) fields.email = scimEmailFromPayload(body);
  const userName = scimUserNameFromPayload(body);
  if (userName !== undefined) fields.userName = userName;
  // PUT without active must not silently reactivate or deactivate the account.
  if ("active" in body) fields.active = scimActiveFromPayload(body);
  const name = scimNamePatchFromPayload(body, true);
  if (Object.keys(name).length > 0) fields.name = name;
  const title = scimTitleFromPayload(body);
  if (title !== undefined) fields.title = title;
  const externalId = scimExternalIdFromPayload(body);
  if (externalId !== undefined) fields.externalId = externalId;
  const row = await runScimMutation(auth, (q) => updateScimUser(q, auth, params.id, fields));
  return scimJsonResponse(scimUserResource(row, origin));
});

export const PATCH = withScimAuth(async (req, { auth, params, origin }) => {
  const body = await readScimJsonObject(req);
  const fields = applyScimPatch(operationsFromBody(body));
  const row = await runScimMutation(auth, (q) => updateScimUser(q, auth, params.id, fields));
  return scimJsonResponse(scimUserResource(row, origin));
});

export const DELETE = withScimAuth(async (_req, { auth, params }) => {
  await runScimMutation(auth, (q) => deleteScimUser(q, auth, params.id));
  return new Response(null, {
    status: 204,
    headers: { "Content-Type": "application/scim+json", "Cache-Control": "no-store" },
  });
});
