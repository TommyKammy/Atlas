/**
 * OAuth 2.1 protocol error. HTTP endpoints (the next phase) translate the
 * `code` into the RFC 6749 `{ "error": code }` body and use `status`.
 * The message is for logs and tests; it must not carry token material.
 */
export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "invalid_scope"
  | "invalid_target"
  | "unsupported_grant_type"
  | "unauthorized_client"
  | "access_denied"
  | "invalid_client_metadata"
  | "invalid_redirect_uri"
  | "server_error"
  | "temporarily_unavailable";

const STATUS: Record<OAuthErrorCode, number> = {
  invalid_request: 400,
  invalid_client: 400,
  invalid_grant: 400,
  invalid_scope: 400,
  invalid_target: 400,
  unsupported_grant_type: 400,
  unauthorized_client: 400,
  access_denied: 403,
  invalid_client_metadata: 400,
  invalid_redirect_uri: 400,
  server_error: 500,
  temporarily_unavailable: 503,
};

export class OAuthError extends Error {
  readonly code: OAuthErrorCode;
  readonly status: number;

  constructor(code: OAuthErrorCode, message: string) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
    this.status = STATUS[code];
  }
}

export function isOAuthError(error: unknown): error is OAuthError {
  return error instanceof OAuthError;
}
