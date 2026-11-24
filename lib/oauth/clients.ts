import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { randomBytes } from "node:crypto";
import { db, type Queryable } from "@/lib/db";
import { resolveWebhookDestination } from "@/lib/automation/webhook-outbound";
import { OAuthError } from "./errors";
import { isAllowedRedirectUri, isValidRedirectForApplication, type OAuthApplicationType } from "./redirect";

export type OAuthClientSource = "cimd" | "dcr";

export type OAuthClient = {
  clientId: string;
  source: OAuthClientSource;
  clientName: string | null;
  redirectUris: string[];
  applicationType: OAuthApplicationType;
  metadata: Record<string, unknown>;
  fetchedAt: Date | null;
};

export type RegisterClientResponse = {
  client_id: string;
  client_id_issued_at: number;
  client_name?: string;
  redirect_uris: string[];
  application_type: OAuthApplicationType;
  token_endpoint_auth_method: "none";
  grant_types: string[];
};

type Address = { address: string; family: number };
export type ResolveAddresses = (hostname: string) => Promise<Address[]>;

export type ResolvedDestination = {
  address: Address;
  servername?: string;
};

/** Injectable HTTP transport so tests never touch the network. */
export type MetadataFetch = (
  url: URL,
  destination: ResolvedDestination,
  init: { signal: AbortSignal },
) => Promise<Response>;

export type ResolveClientOptions = {
  now?: () => number;
  resolve?: ResolveAddresses;
  fetch?: MetadataFetch;
  cacheTtlMs?: number;
};

const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;
export const CIMD_MAX_BODY_BYTES = 64 * 1024;
const MAX_REDIRECT_URIS = 20;
const CLIENT_NAME_MAX_LENGTH = 100;
const CLIENT_ID_MAX_LENGTH = 2048;

const GRANT_TYPES = new Set(["authorization_code", "refresh_token"]);

function invalidClient(message: string): OAuthError {
  return new OAuthError("invalid_client", message);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseHttpsClientId(clientId: unknown): URL | null {
  if (typeof clientId !== "string" || clientId === "" || clientId.length > CLIENT_ID_MAX_LENGTH) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
  return url;
}

function clientName(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, CLIENT_NAME_MAX_LENGTH);
}

function redirectUris(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REDIRECT_URIS) return null;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length > 2048 || !isAllowedRedirectUri(entry)) return null;
    if (!seen.has(entry)) {
      seen.add(entry);
      result.push(entry);
    }
  }
  return result.length > 0 ? result : null;
}

function inferApplicationType(uris: string[], value: unknown): OAuthApplicationType {
  if (value === "native" || value === "web") return value;
  if (value !== undefined) {
    throw new OAuthError("invalid_client_metadata", "application_type must be native or web");
  }
  return uris.every((uri) => isValidRedirectForApplication(uri, "native")) ? "native" : "web";
}

function rowToClient(row: Record<string, unknown>): OAuthClient {
  const source = row.source === "cimd" ? "cimd" : "dcr";
  const applicationType = row.application_type === "native" ? "native" : "web";
  const fetched = row.fetched_at;
  const fetchedAt = fetched instanceof Date
    ? fetched
    : typeof fetched === "string" && fetched !== "" ? new Date(fetched) : null;
  return {
    clientId: String(row.client_id),
    source,
    clientName: typeof row.client_name === "string" ? row.client_name : null,
    redirectUris: Array.isArray(row.redirect_uris) ? row.redirect_uris as string[] : [],
    applicationType,
    metadata: asRecord(row.metadata) ?? {},
    fetchedAt: fetchedAt && !Number.isNaN(fetchedAt.getTime()) ? fetchedAt : null,
  };
}

/**
 * Read at most `limit` bytes from a Response body. A declared Content-Length
 * over the limit fails before reading; streaming bodies are cancelled as soon
 * as they exceed it.
 */
async function readBoundedBody(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("client metadata document is too large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new Error("client metadata document is too large");
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The stream may already be closed or cancelled.
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Default transport: resolve DNS once, require every answer to be public and
 * connect to the vetted IP itself (the Host header and TLS SNI keep the
 * logical host). Redirects are never followed and the 5s deadline covers the
 * lookup and the body read.
 */
const defaultMetadataFetch: MetadataFetch = (url, destination, init) => {
  return new Promise<Response>((resolve, reject) => {
    const outgoing = httpsRequest({
      protocol: "https:",
      hostname: destination.address.address,
      family: destination.address.family,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: "GET",
      agent: false,
      servername: destination.servername,
      signal: init.signal,
      headers: { Host: url.host, Accept: "application/json" },
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > CIMD_MAX_BODY_BYTES) {
          response.destroy();
          reject(new Error("client metadata document is too large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        const contentType = response.headers["content-type"];
        resolve(new Response(Buffer.concat(chunks), {
          status: response.statusCode ?? 0,
          headers: { "content-type": Array.isArray(contentType) ? contentType[0] ?? "" : contentType ?? "" },
        }));
      });
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
};

/**
 * Fetch and parse a CIMD document with the same SSRF defenses as outbound
 * webhooks. Throws `invalid_client` for every failure so callers cannot tell
 * a private address from an unreachable host.
 */
export async function fetchClientMetadataDocument(
  clientId: string,
  options: ResolveClientOptions = {},
): Promise<Record<string, unknown>> {
  const url = parseHttpsClientId(clientId);
  if (!url) throw invalidClient("client metadata URL must be https without credentials or fragment");

  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let destination: ResolvedDestination;
  try {
    const defaultResolve: ResolveAddresses = (hostname) =>
      new Promise<Address[]>((resolve, reject) => {
        const abort = () => reject(new Error("client metadata lookup timed out"));
        signal.addEventListener("abort", abort, { once: true });
        lookup(hostname, { all: true }).then(resolve, reject).finally(() => {
          signal.removeEventListener("abort", abort);
        });
      });
    const resolved = await resolveWebhookDestination(url.href, options.resolve ?? defaultResolve);
    destination = { address: resolved.address, servername: resolved.servername };
  } catch {
    throw invalidClient("client metadata host must resolve only to public IP addresses");
  }

  let response: Response;
  try {
    response = await (options.fetch ?? defaultMetadataFetch)(url, destination, { signal });
  } catch {
    throw invalidClient("client metadata document could not be fetched");
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined);
    throw invalidClient("client metadata document returned an error status");
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!/^application\/(?:json|[a-z0-9.+-]+\+json)\b/i.test(contentType.trim())) {
    await response.body?.cancel().catch(() => undefined);
    throw invalidClient("client metadata document must be served as JSON");
  }

  let body: string;
  try {
    body = await readBoundedBody(response, CIMD_MAX_BODY_BYTES);
  } catch {
    throw invalidClient("client metadata document is too large or unreadable");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw invalidClient("client metadata document is not valid JSON");
  }
  const metadata = asRecord(parsed);
  if (!metadata) throw invalidClient("client metadata document must be a JSON object");
  return metadata;
}

function metadataToClient(clientId: string, metadata: Record<string, unknown>): OAuthClient {
  if (metadata.client_id !== clientId) {
    throw invalidClient("client metadata client_id does not match the requested client_id");
  }
  const uris = redirectUris(metadata.redirect_uris);
  if (!uris) {
    throw invalidClient("client metadata redirect_uris are missing or invalid");
  }
  const applicationType = inferApplicationType(uris, metadata.application_type);
  return {
    clientId,
    source: "cimd",
    clientName: clientName(metadata.client_name),
    redirectUris: uris,
    applicationType,
    metadata,
    fetchedAt: new Date(),
  };
}

async function storeCimdClient(q: Queryable, client: OAuthClient): Promise<void> {
  await q.query(
    `INSERT INTO oauth_clients
       (client_id, source, client_name, redirect_uris, application_type, metadata, fetched_at)
     VALUES ($1, 'cimd', $2, $3, $4, $5::jsonb, now())
     ON CONFLICT (client_id) DO UPDATE SET
       source = 'cimd',
       client_name = EXCLUDED.client_name,
       redirect_uris = EXCLUDED.redirect_uris,
       application_type = EXCLUDED.application_type,
       metadata = EXCLUDED.metadata,
       fetched_at = now()`,
    [
      client.clientId,
      client.clientName,
      client.redirectUris,
      client.applicationType,
      JSON.stringify(client.metadata),
    ],
  );
}

/**
 * Resolve a client_id to registered metadata.
 *
 * - https client_id: CIMD. A cached row younger than 24 hours is used as-is;
 *   otherwise the metadata document is fetched, validated and upserted.
 * - any other client_id: DCR-only lookup in oauth_clients.
 *
 * Revoked clients are always rejected.
 */
export async function resolveClient(
  clientId: string,
  q: Queryable = db,
  options: ResolveClientOptions = {},
): Promise<OAuthClient> {
  if (typeof clientId !== "string" || clientId === "" || clientId.length > CLIENT_ID_MAX_LENGTH) {
    throw invalidClient("unknown client");
  }
  const url = parseHttpsClientId(clientId);
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = options.now ? options.now() : Date.now();

  const stored = await q.query(
    `SELECT client_id, source, client_name, redirect_uris, application_type,
       metadata, fetched_at, revoked_at
     FROM oauth_clients
     WHERE client_id = $1`,
    [clientId],
  );
  const row = stored.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    if (!url) throw invalidClient("unknown client");
  } else {
    if (row.revoked_at !== null && row.revoked_at !== undefined) {
      throw invalidClient("client has been revoked");
    }
    const cachedSource = row.source === "cimd" ? "cimd" : "dcr";
    if (!url && cachedSource !== "dcr") throw invalidClient("unknown client");
    if (url && cachedSource === "cimd") {
      const client = rowToClient(row);
      if (client.fetchedAt && now - client.fetchedAt.getTime() < ttl) return client;
    }
    if (!url && cachedSource === "dcr") return rowToClient(row);
  }

  if (!url) throw invalidClient("unknown client");

  const metadata = await fetchClientMetadataDocument(clientId, options);
  const client = metadataToClient(clientId, metadata);
  await storeCimdClient(q, client);
  return client;
}

function registerError(message: string): OAuthError {
  return new OAuthError("invalid_client_metadata", message);
}

/**
 * RFC 7591 dynamic client registration. Only public clients are accepted:
 * `token_endpoint_auth_method` must be `none`, and the only grant types are
 * authorization_code and refresh_token. Native clients are restricted to
 * loopback redirects; web clients must use https.
 */
export async function registerClient(
  input: unknown,
  q: Queryable = db,
): Promise<RegisterClientResponse> {
  const record = asRecord(input);
  if (!record) throw registerError("client metadata must be a JSON object");

  const rawUris = record.redirect_uris;
  if (!Array.isArray(rawUris) || rawUris.length === 0 || rawUris.length > MAX_REDIRECT_URIS) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uris is required");
  }
  const uris: string[] = [];
  const seen = new Set<string>();
  for (const value of rawUris) {
    if (typeof value !== "string" || value.length > 2048 || !isAllowedRedirectUri(value)) {
      throw new OAuthError("invalid_redirect_uri", "redirect_uris contains an invalid URI");
    }
    if (!seen.has(value)) {
      seen.add(value);
      uris.push(value);
    }
  }

  const applicationType = record.application_type ?? "native";
  if (applicationType !== "native" && applicationType !== "web") {
    throw registerError("application_type must be native or web");
  }
  for (const uri of uris) {
    if (!isValidRedirectForApplication(uri, applicationType)) {
      throw new OAuthError(
        "invalid_redirect_uri",
        applicationType === "native"
          ? "native clients require loopback redirect_uris"
          : "web clients require https redirect_uris",
      );
    }
  }

  if (record.token_endpoint_auth_method !== undefined
      && record.token_endpoint_auth_method !== "none") {
    throw registerError("token_endpoint_auth_method must be none");
  }

  let grantTypes: string[] = ["authorization_code"];
  if (record.grant_types !== undefined) {
    if (!Array.isArray(record.grant_types) || record.grant_types.length === 0
        || !record.grant_types.every((value) => typeof value === "string" && GRANT_TYPES.has(value))) {
      throw registerError("grant_types may only contain authorization_code and refresh_token");
    }
    grantTypes = [...new Set(record.grant_types as string[])];
    if (!grantTypes.includes("authorization_code")) {
      throw registerError("grant_types must include authorization_code");
    }
  }

  let name: string | null = null;
  if (record.client_name !== undefined) {
    if (typeof record.client_name !== "string") throw registerError("client_name must be a string");
    name = record.client_name.trim();
    if (name.length > CLIENT_NAME_MAX_LENGTH) {
      throw registerError(`client_name must be ${CLIENT_NAME_MAX_LENGTH} characters or fewer`);
    }
    if (name === "") name = null;
  }

  const clientId = `atlas_oauth_${randomBytes(32).toString("base64url")}`;
  const metadata = {
    redirect_uris: uris,
    application_type: applicationType,
    token_endpoint_auth_method: "none",
    grant_types: grantTypes,
    ...(name === null ? {} : { client_name: name }),
  };
  await q.query(
    `INSERT INTO oauth_clients
       (client_id, source, client_name, redirect_uris, application_type, metadata)
     VALUES ($1, 'dcr', $2, $3, $4, $5::jsonb)`,
    [clientId, name, uris, applicationType, JSON.stringify(metadata)],
  );

  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    ...(name === null ? {} : { client_name: name }),
    redirect_uris: uris,
    application_type: applicationType,
    token_endpoint_auth_method: "none",
    grant_types: grantTypes,
  };
}
