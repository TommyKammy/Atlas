import {
  CLIENT_INFO_META_KEY,
  createMcpHandler,
  DEFAULT_MAX_REQUEST_BODY_SIZE,
  hostHeaderValidationResponse,
  originValidationResponse,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import { authRateLimitResponse } from "@/lib/auth-rate-limit";
import {
  protectedResourceMetadataUrlFromBase,
  requestBaseUrl,
} from "@/lib/oauth/resources";
import type { Actor } from "@/lib/services/actor";
import { authenticateMcpToken, type McpAuthResult, type McpEndpoint, type McpScope } from "./auth";
import {
  mcpClientIp,
  recordMcpRequest,
  type McpRequestLogEntry,
  type McpRequestOutcome,
} from "./request-log";
import { buildMcpServer, type McpServerBuilder } from "./server";
import { bearerToken } from "./token";

const ATLAS_AUTH_EXTRA = "atlas";
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Upper bound on the request body read for the request log. The SDK handler
 * receives the same value so logging can never accept more than the transport.
 */
export const MCP_MAX_REQUEST_BODY_BYTES = DEFAULT_MAX_REQUEST_BODY_SIZE;

type AtlasAuthExtra = {
  actor: Actor;
  scopes: McpScope[];
  endpoint: McpEndpoint;
  /** Request-body client name, or the token's stored name. */
  clientName: string | null;
};

/**
 * Hostnames accepted by the Host and Origin checks. APP_URL and APP_ORIGIN
 * are the public deployment origins; localhost stays available for local
 * development. Ports are intentionally ignored (the SDK helpers compare
 * hostnames only).
 */
export function mcpAllowedHostnames(): string[] {
  const allowed = new Set<string>(LOCAL_HOSTS);
  for (const value of [process.env.APP_URL, process.env.APP_ORIGIN]) {
    if (!value) continue;
    try {
      const hostname = new URL(value).hostname;
      if (hostname) allowed.add(hostname);
    } catch {
      // An invalid deployment URL must not widen the allowlist.
    }
  }
  return [...allowed];
}

type RpcMetadata = {
  method: string | null;
  toolName: string | null;
  clientName: string | null;
  isToolCall: boolean;
};

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, maxLength);
}

/**
 * Metadata that can be read without touching the body. Used for requests
 * rejected before the body is inspected (Host/Origin/authentication) and for
 * bodies that exceed the log's read limit.
 */
function headerRpcMetadata(req: Request): RpcMetadata {
  const method = boundedText(req.headers.get("mcp-method"), 100);
  const isToolCall = method === "tools/call";
  return {
    method,
    toolName: isToolCall ? boundedText(req.headers.get("mcp-name"), 200) : null,
    clientName: null,
    isToolCall,
  };
}

/**
 * Read a JSON body from a clone, stopping as soon as it exceeds `maxBytes`.
 * Returns null for an unreadable, malformed or oversized body so the caller
 * falls back to header metadata. The original request stays available to the
 * SDK handler, which enforces the same bound and owns the final response.
 */
async function readBoundedJson(req: Request, maxBytes: number): Promise<unknown | null> {
  if (req.body === null) return null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const clone = req.clone();
    if (clone.body === null) return null;
    reader = clone.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        // Stop buffering the clone. Its cancel promise only settles once the
        // original branch is cancelled too, so the SDK request must not wait
        // for it. Releasing the lock leaves the original body readable.
        void reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      return null;
    }
  } catch {
    return null;
  } finally {
    try {
      reader?.releaseLock();
    } catch {
      // The stream may already be closed or cancelled.
    }
  }
}

/**
 * Read only the routing metadata needed for the request log. The full body
 * and the tool arguments are never retained, and the read is bounded.
 */
export async function readRpcMetadata(
  req: Request,
  maxBytes = MCP_MAX_REQUEST_BODY_BYTES,
): Promise<RpcMetadata> {
  const header = headerRpcMetadata(req);
  // The SDK independently enforces this bound. Avoid parsing an oversized
  // body just to populate the log when the declared size is already too big.
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return header;

  const body = await readBoundedJson(req, maxBytes);
  const message = Array.isArray(body) ? body[0] : body;
  const record = message !== null && typeof message === "object"
    ? message as { method?: unknown; params?: unknown }
    : null;
  const params = record?.params !== null && typeof record?.params === "object"
    ? record.params as { name?: unknown; _meta?: unknown; clientInfo?: unknown }
    : null;
  const meta = params?._meta !== null && typeof params?._meta === "object"
    ? params._meta as Record<string, unknown>
    : null;
  const method = boundedText(record?.method, 100) ?? header.method;
  const isToolCall = method === "tools/call";
  const clientInfo = meta?.[CLIENT_INFO_META_KEY] ?? params?.clientInfo;
  const clientName = boundedText(
    clientInfo !== null && typeof clientInfo === "object"
      ? (clientInfo as { name?: unknown }).name
      : null,
    200,
  );
  return {
    method,
    toolName: isToolCall
      ? boundedText(params?.name, 200) ?? header.toolName
      : null,
    clientName,
    isToolCall,
  };
}

function invalidTokenResponse(req: Request, endpoint: McpEndpoint): Response {
  const resourceMetadata = protectedResourceMetadataUrlFromBase(
    requestBaseUrl(req),
    endpoint,
  );
  const scope = endpoint === "readonly" ? "read" : "read write";
  // RFC 6750: when the request carried no Bearer credential there is no
  // invalid_token error to report; the challenge still points at the
  // protected-resource metadata so the client can start authorization.
  const params = [
    ...(bearerToken(req.headers.get("authorization")) === null
      ? []
      : ['error="invalid_token"']),
    `resource_metadata="${resourceMetadata}"`,
    `scope="${scope}"`,
  ];
  return new Response(JSON.stringify({ error: "invalid_token" }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "www-authenticate": `Bearer ${params.join(", ")}`,
    },
  });
}

function internalErrorResponse(): Response {
  return new Response(JSON.stringify({ error: "internal_error" }), {
    status: 500,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function methodNotAllowedResponse(): Response {
  return new Response("Method not allowed.", {
    status: 405,
    headers: { allow: "POST", "cache-control": "no-store" },
  });
}

function authInfoFor(
  auth: Extract<McpAuthResult, { ok: true }>,
  endpoint: McpEndpoint,
  clientName: string | null,
): AuthInfo {
  const extra: AtlasAuthExtra = {
    actor: auth.actor,
    scopes: auth.scopes,
    endpoint,
    clientName,
  };
  return {
    // AuthInfo is an in-process carrier only; do not copy the bearer secret
    // into the server context where a stray logger could capture it.
    token: "",
    clientId: String(auth.tokenId),
    scopes: auth.scopes,
    extra: { [ATLAS_AUTH_EXTRA]: extra },
  };
}

function atlasAuthFrom(info: AuthInfo | undefined): AtlasAuthExtra {
  const value = info?.extra?.[ATLAS_AUTH_EXTRA];
  if (value === null || typeof value !== "object") {
    throw new Error("MCP request is missing Atlas authentication context");
  }
  const candidate = value as Partial<AtlasAuthExtra>;
  if (
    candidate.actor === null
    || typeof candidate.actor !== "object"
    || typeof candidate.actor.uid !== "number"
    || !Array.isArray(candidate.scopes)
    || (candidate.endpoint !== "default" && candidate.endpoint !== "readonly")
  ) {
    throw new Error("MCP request has invalid Atlas authentication context");
  }
  return {
    actor: candidate.actor,
    scopes: candidate.scopes,
    endpoint: candidate.endpoint,
    clientName: typeof candidate.clientName === "string" ? candidate.clientName : null,
  };
}

function makeHandler(buildServer: McpServerBuilder): ReturnType<typeof createMcpHandler> {
  return createMcpHandler(
    (ctx) => {
      const auth = atlasAuthFrom(ctx.authInfo);
      return buildServer({
        actor: auth.actor,
        scopes: auth.scopes,
        endpoint: auth.endpoint,
        era: ctx.era,
        clientName: auth.clientName,
      });
    },
    {
      responseMode: "json",
      maxRequestBodySize: MCP_MAX_REQUEST_BODY_BYTES,
      // Keep the 2025 stateless fallback (legacy defaults to "stateless").
      onerror: (error) => console.error("[mcp] request failed:", error.message),
    },
  );
}

// Production builds one handler for the lifetime of the process.
const SHARED_HANDLER = makeHandler(buildMcpServer);
const testHandlers = new WeakMap<McpServerBuilder, ReturnType<typeof createMcpHandler>>();

function handlerFor(buildServer: McpServerBuilder): ReturnType<typeof createMcpHandler> {
  if (buildServer === buildMcpServer) return SHARED_HANDLER;
  let handler = testHandlers.get(buildServer);
  if (!handler) {
    handler = makeHandler(buildServer);
    testHandlers.set(buildServer, handler);
  }
  return handler;
}

async function classifyResponse(
  response: Response,
  rpc: RpcMetadata,
): Promise<{ outcome: McpRequestOutcome; errorCode: string | null }> {
  if (response.status >= 400) {
    return {
      outcome: response.status === 401 || response.status === 403 ? "denied" : "error",
      errorCode: `http_${response.status}`,
    };
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    // SSE (subscriptions/listen) and empty notification responses are fine.
    return { outcome: "ok", errorCode: null };
  }
  const payload = await response.clone().json().catch(() => null) as unknown;
  const messages = Array.isArray(payload) ? payload : [payload];
  for (const message of messages) {
    if (message === null || typeof message !== "object") continue;
    const error = (message as { error?: unknown }).error;
    if (error !== null && typeof error === "object") {
      const code = (error as { code?: unknown }).code;
      return {
        outcome: "error",
        errorCode: typeof code === "number" || typeof code === "string"
          ? String(code)
          : "jsonrpc_error",
      };
    }
    const result = (message as { result?: unknown }).result;
    if (
      rpc.isToolCall
      && result !== null
      && typeof result === "object"
      && (result as { isError?: unknown }).isError === true
    ) {
      return { outcome: "error", errorCode: "tool_error" };
    }
  }
  return { outcome: "ok", errorCode: null };
}

export type McpHttpDependencies = {
  authenticate: (
    req: Request,
    opts: { endpoint: McpEndpoint },
  ) => Promise<McpAuthResult>;
  record: (entry: McpRequestLogEntry) => Promise<void>;
  buildServer: McpServerBuilder;
};

const DEFAULT_DEPENDENCIES: McpHttpDependencies = {
  authenticate: authenticateMcpToken,
  record: recordMcpRequest,
  buildServer: buildMcpServer,
};

/** Logging must never change the MCP response. */
async function safeRecord(
  deps: McpHttpDependencies,
  entry: McpRequestLogEntry,
): Promise<void> {
  try {
    await deps.record(entry);
  } catch (error) {
    console.error(
      "MCP request log write failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

type LogBase = {
  endpoint: McpEndpoint;
  rpc: RpcMetadata;
  startedAt: number;
  clientIp: string | null;
};

function logEntry(
  base: LogBase,
  outcome: McpRequestOutcome,
  values: {
    workspaceId?: number | null;
    tokenId?: number | null;
    userId?: number | null;
    errorCode?: string | null;
    clientName?: string | null;
  } = {},
): McpRequestLogEntry {
  return {
    workspaceId: values.workspaceId ?? null,
    tokenId: values.tokenId ?? null,
    userId: values.userId ?? null,
    endpoint: base.endpoint,
    rpcMethod: base.rpc.method,
    toolName: base.rpc.toolName,
    outcome,
    errorCode: values.errorCode ?? null,
    durationMs: Date.now() - base.startedAt,
    clientName: values.clientName ?? base.rpc.clientName,
    clientIp: base.clientIp,
  };
}

/**
 * POST /mcp and POST /mcp/readonly.
 *
 * Order is deliberate: reject a bad Host before anything else, then a present
 * and unparseable/cross-origin Origin, then authenticate the bearer token.
 * The body is inspected for routing metadata only after authentication, and
 * the SDK handler still receives the untouched request.
 */
export async function handleMcpPost(
  req: Request,
  endpoint: McpEndpoint,
  overrides: Partial<McpHttpDependencies> = {},
): Promise<Response> {
  const deps = { ...DEFAULT_DEPENDENCIES, ...overrides };
  const startedAt = Date.now();
  let base: LogBase = {
    endpoint,
    rpc: headerRpcMetadata(req),
    startedAt,
    clientIp: mcpClientIp(req),
  };

  // Host and Origin are decided before the body is inspected.
  const hostRejected = hostHeaderValidationResponse(req, mcpAllowedHostnames());
  if (hostRejected) {
    await safeRecord(deps, logEntry(base, "denied", { errorCode: "invalid_host" }));
    return hostRejected;
  }

  const originRejected = originValidationResponse(req, mcpAllowedHostnames());
  if (originRejected) {
    await safeRecord(deps, logEntry(base, "denied", { errorCode: "invalid_origin" }));
    return originRejected;
  }

  let auth: McpAuthResult;
  try {
    auth = await deps.authenticate(req, { endpoint });
  } catch (error) {
    const limited = authRateLimitResponse(error);
    if (limited) {
      await safeRecord(deps, logEntry(base, "unauthenticated", {
        errorCode: limited.status === 429 ? "rate_limited" : "auth_unavailable",
      }));
      return limited;
    }
    console.error(
      "[mcp] authentication failed unexpectedly:",
      error instanceof Error ? error.message : String(error),
    );
    await safeRecord(deps, logEntry(base, "unauthenticated", { errorCode: "internal_error" }));
    return internalErrorResponse();
  }

  if (!auth.ok) {
    // The failure reason (disabled, guest, revoked, ...) stays server-side.
    await safeRecord(deps, logEntry(base, "unauthenticated", {
      errorCode: auth.reason,
    }));
    return invalidTokenResponse(req, endpoint);
  }

  // Body-derived routing metadata is for the request log only.
  base = { ...base, rpc: await readRpcMetadata(req) };

  const clientName = base.rpc.clientName ?? auth.clientName;
  let response: Response;
  try {
    response = await handlerFor(deps.buildServer).fetch(req, {
      authInfo: authInfoFor(auth, endpoint, clientName),
    });
  } catch (error) {
    console.error(
      "[mcp] handler failed unexpectedly:",
      error instanceof Error ? error.message : String(error),
    );
    await safeRecord(deps, logEntry(base, "error", {
      workspaceId: auth.workspaceId,
      tokenId: auth.tokenId,
      userId: auth.userId,
      clientName,
      errorCode: "internal_error",
    }));
    return internalErrorResponse();
  }

  const classification = await classifyResponse(response, base.rpc);
  await safeRecord(deps, logEntry(base, classification.outcome, {
    workspaceId: auth.workspaceId,
    tokenId: auth.tokenId,
    userId: auth.userId,
    clientName,
    errorCode: classification.errorCode,
  }));
  return response;
}
