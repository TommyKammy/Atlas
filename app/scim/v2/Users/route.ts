import { db } from "@/lib/db";
import { readScimJsonObject } from "@/lib/scim/body";
import { invalidValue, scimJsonResponse } from "@/lib/scim/errors";
import { parseUserFilter } from "@/lib/scim/filter";
import { scimListResponse, scimUserResource } from "@/lib/scim/map";
import { withScimAuth } from "@/lib/scim/route";
import { createScimUser, listScimUsers, runScimMutation } from "@/lib/scim/users";

function integerParam(value: string | null, fallback: number, label: string, minimum: number): number {
  if (value === null || value.trim() === "") return fallback;
  if (!/^\d+$/.test(value.trim())) throw invalidValue(`${label} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw invalidValue(`${label} must be at least ${minimum}`);
  return parsed;
}

/** RFC 7644 3.4.2.4: values below 1 are treated as the first resource. */
function startIndexParam(value: string | null): number {
  if (value === null || value.trim() === "") return 1;
  if (!/^-?\d+$/.test(value.trim())) throw invalidValue("startIndex must be an integer");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw invalidValue("startIndex must be an integer");
  return Math.max(1, parsed);
}

export const GET = withScimAuth(async (req, { auth, origin }) => {
  const { searchParams } = new URL(req.url);
  const filter = parseUserFilter(searchParams.get("filter"));
  const startIndex = startIndexParam(searchParams.get("startIndex"));
  const count = Math.min(integerParam(searchParams.get("count"), 100, "count", 0), 200);
  const { rows, total } = await listScimUsers(db, auth.workspaceId, filter, startIndex, count);
  return scimJsonResponse(scimListResponse(rows.map((row) => scimUserResource(row, origin)), startIndex, total));
});

export const POST = withScimAuth(async (req, { auth, origin }) => {
  const body = await readScimJsonObject(req);
  const row = await runScimMutation(auth, (q) => createScimUser(q, auth, body));
  const resource = scimUserResource(row, origin);
  return scimJsonResponse(resource, {
    status: 201,
    headers: { Location: `${origin}/scim/v2/Users/${resource.id}` },
  });
});
