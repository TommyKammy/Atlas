import { OAuthError } from "./errors";

export type McpResourceEndpoint = "default" | "readonly";

const RESOURCE_PATHS: Record<McpResourceEndpoint, string> = {
  default: "/mcp",
  readonly: "/mcp/readonly",
};

type Environment = Record<string, string | undefined>;

/**
 * Raised when production has no explicit public origin. Callers translate this
 * to a 500 instead of deriving the issuer from a potentially spoofed Host.
 */
export class MissingPublicBaseUrlError extends Error {
  constructor() {
    super("APP_URL or APP_ORIGIN is required in production");
    this.name = "MissingPublicBaseUrlError";
  }
}

/**
 * Public origin for OAuth resource identifiers. APP_URL wins over APP_ORIGIN;
 * only an absolute http(s) URL without credentials is accepted. The path is
 * intentionally discarded because the deployment origin is the audience base.
 */
export function appBaseUrl(env: Environment = process.env): string | null {
  for (const raw of [env.APP_URL, env.APP_ORIGIN]) {
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
        continue;
      }
      return url.origin;
    } catch {
      continue;
    }
  }
  return null;
}

function trimTrailingSlashes(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** The RFC 8707 resource value built from an explicit public base URL. */
export function mcpResourceUrlFromBase(
  baseUrl: string,
  endpoint: McpResourceEndpoint,
): string {
  return `${trimTrailingSlashes(baseUrl)}${RESOURCE_PATHS[endpoint]}`;
}

/** RFC 9728 metadata URL (path insertion style), e.g. https://atlas/.well-known/oauth-protected-resource/mcp. */
export function protectedResourceMetadataUrlFromBase(
  baseUrl: string,
  endpoint: McpResourceEndpoint,
): string {
  return `${trimTrailingSlashes(baseUrl)}/.well-known/oauth-protected-resource${RESOURCE_PATHS[endpoint]}`;
}

/** The RFC 8707 resource value for an MCP endpoint, e.g. https://atlas/mcp. */
export function mcpResourceUrl(
  endpoint: McpResourceEndpoint,
  env: Environment = process.env,
): string | null {
  const base = appBaseUrl(env);
  return base === null ? null : mcpResourceUrlFromBase(base, endpoint);
}

/**
 * Public base URL used by the metadata endpoints and WWW-Authenticate.
 *
 * APP_URL / APP_ORIGIN are authoritative when configured. In development the
 * origin of the incoming request is an acceptable fallback. Production must
 * configure the public origin explicitly: a Host-header fallback would let an
 * attacker change the issuer and resource URLs advertised by the metadata
 * endpoints, so it fails closed with a logged error instead.
 */
export function requestBaseUrl(
  request: Request,
  env: Environment = process.env,
): string {
  const base = appBaseUrl(env);
  if (base !== null) return base;
  const nodeEnv = env.NODE_ENV ?? process.env.NODE_ENV;
  if (nodeEnv === "production") {
    console.error(
      "[oauth] APP_URL or APP_ORIGIN must be set in production; "
      + "refusing to derive the public origin from the request host",
    );
    throw new MissingPublicBaseUrlError();
  }
  return new URL(request.url).origin;
}

/**
 * Compare a token audience with the endpoint that received the request.
 * Comparison is exact after URL canonicalization; a token minted for /mcp is
 * never accepted by /mcp/readonly and vice versa.
 *
 * Without APP_URL/APP_ORIGIN the development server has no public origin to
 * compare against, so it accepts the two exact endpoint paths. Test and
 * production runtimes keep failing closed.
 */
export function resourceMatchesEndpoint(
  resource: string | null | undefined,
  endpoint: McpResourceEndpoint,
  env: Environment = process.env,
): boolean {
  if (typeof resource !== "string" || resource === "") return false;
  const expected = mcpResourceUrl(endpoint, env);
  let parsed: URL;
  try {
    parsed = new URL(resource);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password || parsed.hash || parsed.search) return false;
  if (expected === null) {
    const nodeEnv = env.NODE_ENV ?? process.env.NODE_ENV;
    return nodeEnv === "development" && parsed.pathname === RESOURCE_PATHS[endpoint];
  }
  return parsed.href === expected;
}

/** True when `resource` identifies either MCP endpoint. */
export function isSupportedResource(
  resource: unknown,
  env: Environment = process.env,
): resource is string {
  return typeof resource === "string"
    && (resourceMatchesEndpoint(resource, "default", env)
      || resourceMatchesEndpoint(resource, "readonly", env));
}

/** Throw `invalid_target` unless the resource is one of the two MCP audiences. */
export function assertSupportedResource(resource: unknown, env: Environment = process.env): string {
  if (!isSupportedResource(resource, env)) {
    throw new OAuthError("invalid_target", "resource must identify /mcp or /mcp/readonly");
  }
  return resource;
}
