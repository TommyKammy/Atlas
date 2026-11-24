import { OAuthError } from "./errors";

export type McpResourceEndpoint = "default" | "readonly";

const RESOURCE_PATHS: Record<McpResourceEndpoint, string> = {
  default: "/mcp",
  readonly: "/mcp/readonly",
};

type Environment = Record<string, string | undefined>;

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

/** The RFC 8707 resource value for an MCP endpoint, e.g. https://atlas/mcp. */
export function mcpResourceUrl(
  endpoint: McpResourceEndpoint,
  env: Environment = process.env,
): string | null {
  const base = appBaseUrl(env);
  return base === null ? null : `${base}${RESOURCE_PATHS[endpoint]}`;
}

/**
 * Compare a token audience with the endpoint that received the request.
 * Comparison is exact after URL canonicalization; a token minted for /mcp is
 * never accepted by /mcp/readonly and vice versa.
 */
export function resourceMatchesEndpoint(
  resource: string | null | undefined,
  endpoint: McpResourceEndpoint,
  env: Environment = process.env,
): boolean {
  if (typeof resource !== "string" || resource === "") return false;
  const expected = mcpResourceUrl(endpoint, env);
  if (expected === null) return false;
  let parsed: URL;
  try {
    parsed = new URL(resource);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password || parsed.hash || parsed.search) return false;
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
