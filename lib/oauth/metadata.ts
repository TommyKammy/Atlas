import {
  mcpResourceUrlFromBase,
  requestBaseUrl,
  type McpResourceEndpoint,
} from "./resources";

export const METADATA_CACHE_CONTROL = "max-age=300";

export type OAuthProtectedResourceMetadata = {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
  resource_name: string;
};

export type OAuthAuthorizationServerMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  revocation_endpoint: string;
  client_id_metadata_document_supported: boolean;
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  revocation_endpoint_auth_methods_supported: string[];
  scopes_supported: string[];
  authorization_response_iss_parameter_supported: boolean;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** RFC 9728 document for one of the two MCP audiences. */
export function protectedResourceMetadata(
  baseUrl: string,
  endpoint: McpResourceEndpoint,
): OAuthProtectedResourceMetadata {
  const base = normalizeBaseUrl(baseUrl);
  return {
    resource: mcpResourceUrlFromBase(base, endpoint),
    authorization_servers: [base],
    scopes_supported: endpoint === "readonly" ? ["read"] : ["read", "write"],
    bearer_methods_supported: ["header"],
    resource_name: "Atlas",
  };
}

/** RFC 8414 document for Atlas as its own authorization server. */
export function authorizationServerMetadata(baseUrl: string): OAuthAuthorizationServerMetadata {
  const base = normalizeBaseUrl(baseUrl);
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    client_id_metadata_document_supported: true,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["read", "write"],
    authorization_response_iss_parameter_supported: true,
  };
}

function metadataResponse(document: unknown): Response {
  return new Response(JSON.stringify(document), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": METADATA_CACHE_CONTROL,
      // Discovery documents contain no credentials and are fetched by
      // browser-based OAuth clients from another origin.
      "access-control-allow-origin": "*",
    },
  });
}

export function protectedResourceMetadataResponse(
  request: Request,
  endpoint: McpResourceEndpoint,
  env: Record<string, string | undefined> = process.env,
): Response {
  return metadataResponse(
    protectedResourceMetadata(requestBaseUrl(request, env), endpoint),
  );
}

export function authorizationServerMetadataResponse(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): Response {
  return metadataResponse(
    authorizationServerMetadata(requestBaseUrl(request, env)),
  );
}
