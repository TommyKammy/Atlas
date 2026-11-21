export const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
export const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";

export const SCIM_CONTENT_TYPE = "application/scim+json";

export type ScimType =
  | "invalidFilter"
  | "invalidSyntax"
  | "invalidValue"
  | "invalidPath"
  | "noTarget"
  | "uniqueness"
  | "mutability"
  | "tooMany";

/** Error raised by SCIM parsing and persistence code, rendered by the route wrapper. */
export class ScimApiError extends Error {
  readonly status: number;
  readonly scimType?: ScimType;
  readonly headers?: Record<string, string>;

  constructor(status: number, detail: string, scimType?: ScimType, headers?: Record<string, string>) {
    super(detail);
    this.name = "ScimApiError";
    this.status = status;
    this.scimType = scimType;
    this.headers = headers;
  }
}

export function scimErrorResponse(error: ScimApiError): Response {
  const body: Record<string, unknown> = {
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(error.status),
  };
  if (error.scimType) body.scimType = error.scimType;
  body.detail = error.message;
  return new Response(JSON.stringify(body), {
    status: error.status,
    headers: {
      "Content-Type": SCIM_CONTENT_TYPE,
      "Cache-Control": "no-store",
      ...error.headers,
    },
  });
}

export function scimJsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": SCIM_CONTENT_TYPE,
      "Cache-Control": "no-store",
      ...init?.headers,
    },
  });
}

export function invalidFilter(detail = "unsupported filter"): ScimApiError {
  return new ScimApiError(400, detail, "invalidFilter");
}

export function invalidValue(detail: string): ScimApiError {
  return new ScimApiError(400, detail, "invalidValue");
}

export function invalidSyntax(detail: string): ScimApiError {
  return new ScimApiError(400, detail, "invalidSyntax");
}

export function uniqueness(detail: string): ScimApiError {
  return new ScimApiError(409, detail, "uniqueness");
}
