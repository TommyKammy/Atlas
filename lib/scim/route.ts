import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { AuthRateLimitError, AuthRateLimitUnavailableError } from "@/lib/auth-rate-limit";
import { authenticateScim, type ScimAuthContext } from "./auth";
import {
  ScimApiError, scimErrorResponse, uniqueness,
} from "./errors";
import { shouldRecordScimRequest } from "./log";
import { recordScimRequest } from "./request-log";

type Params = Record<string, string>;

export type ScimRequestContext<P extends Params = Params> = {
  auth: ScimAuthContext;
  params: P;
  origin: string;
};

export type ScimOriginValues = {
  configured?: string | null;
  url: string;
  forwardedHost?: string | null;
  host?: string | null;
  forwardedProto?: string | null;
  protocol?: string | null;
};

/**
 * Public origin for SCIM meta.location, honoring the same proxies as SAML.
 * APP_ORIGIN wins; otherwise forwarded headers, the Host header, then the
 * request URL.
 */
export function resolveScimOrigin(values: ScimOriginValues): string {
  if (values.configured) return values.configured.replace(/\/+$/, "");
  let fallback = "";
  try {
    fallback = new URL(values.url).origin;
  } catch {
    fallback = "";
  }
  const host = values.forwardedHost ?? values.host;
  const proto = values.forwardedProto ?? values.protocol;
  if (host && proto) return `${proto}://${host}`.replace(/\/+$/, "");
  return fallback.replace(/\/+$/, "");
}

/** Public origin for SCIM meta.location, honoring the same proxies as SAML. */
export function scimOrigin(req: Request): string {
  let protocol: string | null = null;
  try {
    protocol = new URL(req.url).protocol.replace(":", "");
  } catch {
    protocol = null;
  }
  return resolveScimOrigin({
    configured: process.env.APP_ORIGIN,
    url: req.url,
    forwardedHost: req.headers.get("x-forwarded-host"),
    host: req.headers.get("host"),
    forwardedProto: req.headers.get("x-forwarded-proto"),
    protocol,
  });
}

type Failure = {
  response: Response;
  scimType: string | null;
  detail: string | null;
};

function failure(error: unknown): Failure {
  if (error instanceof ScimApiError) {
    return {
      response: scimErrorResponse(error),
      scimType: error.scimType ?? null,
      detail: error.message,
    };
  }
  if (error instanceof AuthRateLimitError) {
    return {
      response: scimErrorResponse(new ScimApiError(429, "too many failed authentication attempts", undefined, {
        "Retry-After": String(error.retryAfter),
      })),
      scimType: null,
      detail: "too many failed authentication attempts",
    };
  }
  if (error instanceof AuthRateLimitUnavailableError) {
    return {
      response: scimErrorResponse(new ScimApiError(503, "authentication temporarily unavailable", undefined, {
        "Retry-After": "30",
      })),
      scimType: null,
      detail: "authentication temporarily unavailable",
    };
  }
  if (error instanceof ApiError) {
    return {
      response: scimErrorResponse(new ScimApiError(
        error.status,
        error.message,
        error.status === 409 ? "uniqueness" : undefined,
      )),
      scimType: error.status === 409 ? "uniqueness" : null,
      detail: error.message,
    };
  }
  if ((error as { code?: string } | null)?.code === "23505") {
    return {
      response: scimErrorResponse(uniqueness("resource already exists")),
      scimType: "uniqueness",
      detail: "resource already exists",
    };
  }
  console.error("unhandled SCIM error", error);
  return {
    response: scimErrorResponse(new ScimApiError(500, "internal server error")),
    scimType: null,
    detail: "internal server error",
  };
}

/**
 * Authenticate before every SCIM endpoint, then translate failures into the
 * RFC 7644 error envelope with application/scim+json. Every request, including
 * a 401, is recorded after the response is built. The log write uses the pool
 * only after the handler's transaction has released its client.
 */
export function withScimAuth<P extends Params = Params>(
  handler: (req: NextRequest, ctx: ScimRequestContext<P>) => Promise<Response>,
) {
  return async (req: NextRequest, context?: { params?: Promise<P> }): Promise<Response> => {
    let auth: ScimAuthContext | null = null;
    let outcome: Failure;
    try {
      const authResult = await authenticateScim(req);
      if (!authResult.ok) {
        auth = authResult.auth;
        // Keep the response generic so a caller cannot tell a valid token for a
        // disabled workspace from a bad token. Only the log records the cause.
        outcome = {
          response: scimErrorResponse(new ScimApiError(401, "invalid or expired bearer token", undefined, {
            "WWW-Authenticate": "Bearer",
          })),
          scimType: null,
          detail: authResult.reason === "disabled"
            ? "SCIM provisioning is disabled"
            : "invalid or expired bearer token",
        };
      } else {
        auth = authResult.auth;
        const params = context?.params ? await context.params : ({} as P);
        outcome = {
          response: await handler(req, { auth, params, origin: scimOrigin(req) }),
          scimType: null,
          detail: null,
        };
      }
    } catch (error) {
      outcome = failure(error);
    }
    if (shouldRecordScimRequest(outcome.response.status)) {
      await recordScimRequest({
        req,
        auth,
        status: outcome.response.status,
        scimType: outcome.scimType,
        detail: outcome.detail,
        location: outcome.response.headers.get("Location"),
      }).catch(() => undefined);
    }
    return outcome.response;
  };
}
