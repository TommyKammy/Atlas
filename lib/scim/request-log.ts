import { db, type Queryable } from "@/lib/db";
import { verifiedAuthClientIp } from "@/lib/auth-client-ip.mjs";
import type { ScimAuthContext } from "./auth";
import {
  runScimLogWrite,
  scimCreatedUserId, scimFilterFromUrl, scimLogRecord, scimPathOnly, scimTargetUserId,
} from "./log";

type RecordScimRequest = {
  req: Request;
  auth: ScimAuthContext | null;
  status: number;
  scimType?: string | null;
  detail?: string | null;
  location?: string | null;
};

let cachedDefaultWorkspaceId: number | null = null;
let pendingDefaultWorkspaceId: Promise<number | null> | null = null;

/** The app is single-workspace today; failed auth has no token to resolve it. */
async function defaultWorkspaceId(store: Queryable): Promise<number | null> {
  if (cachedDefaultWorkspaceId !== null) return cachedDefaultWorkspaceId;
  if (pendingDefaultWorkspaceId === null) {
    pendingDefaultWorkspaceId = store.query("SELECT id FROM workspaces ORDER BY id LIMIT 1")
      .then((result) => {
        const id = Number(result.rows[0]?.id ?? 0);
        if (Number.isSafeInteger(id) && id > 0) cachedDefaultWorkspaceId = id;
        return cachedDefaultWorkspaceId;
      })
      .finally(() => {
        pendingDefaultWorkspaceId = null;
      });
  }
  return pendingDefaultWorkspaceId;
}

/**
 * Persist one SCIM request. This runs after the route (and any transaction it
 * opened) has finished, so it never takes a second pooled client while a
 * transaction is open. Failures are logged and never change the SCIM response.
 */
export async function recordScimRequest(
  input: RecordScimRequest,
  store: Queryable = db,
): Promise<void> {
  await runScimLogWrite(async () => {
    const workspaceId = input.auth?.workspaceId ?? await defaultWorkspaceId(store);
    if (workspaceId === null) return;
    const path = scimPathOnly(input.req.url);
    const record = scimLogRecord({
      method: input.req.method,
      path,
      filter: scimFilterFromUrl(input.req.url),
      status: input.status,
      scimType: input.scimType,
      detail: input.detail,
      userId: scimTargetUserId(path) ?? scimCreatedUserId(input.location),
    });
    await store.query(
      `INSERT INTO scim_request_log
         (workspace_id, token_id, idp, method, path, "filter", status, scim_type,
          detail, user_id, client_ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
         (SELECT id FROM users WHERE id = $10::bigint), $11)`,
      [
        workspaceId,
        input.auth?.tokenId ?? null,
        input.auth?.idp ?? null,
        record.method,
        record.path,
        record.filter,
        record.status,
        record.scim_type,
        record.detail,
        record.user_id,
        verifiedAuthClientIp(input.req),
      ],
    );
  }, (error) => {
    // Next probes route handlers during the build. There is no real request
    // to record until the route is rendered on demand.
    const message = error instanceof Error ? error.message : "";
    if ((error as { digest?: string } | null)?.digest === "NEXT_PRERENDER_INTERRUPTED"
        || message.includes("During prerendering")) {
      return;
    }
    console.error(
      "SCIM request log write failed:",
      error instanceof Error ? error.message : String(error),
    );
  });
}
