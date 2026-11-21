import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { AuthRateLimitError, AuthRateLimitUnavailableError } from "@/lib/auth-rate-limit";
import { authenticateScim, type ScimAuthContext } from "./auth";
import {
  ScimApiError, scimErrorResponse, uniqueness,
} from "./errors";

type Params = Record<string, string>;

export type ScimRequestContext<P extends Params = Params> = {
  auth: ScimAuthContext;
  params: P;
  origin: string;
};

/** Public origin for SCIM meta.location, honoring the same proxies as SAML. */
export function scimOrigin(req: Request): string {
  const configured = process.env.APP_ORIGIN;
  if (configured) return configured.replace(/\/+$/, "");
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return (host ? `${proto}://${host}` : url.origin).replace(/\/+$/, "");
}

function failure(error: unknown): Response {
  if (error instanceof ScimApiError) return scimErrorResponse(error);
  if (error instanceof AuthRateLimitError) {
    return scimErrorResponse(new ScimApiError(429, "too many failed authentication attempts", undefined, {
      "Retry-After": String(error.retryAfter),
    }));
  }
  if (error instanceof AuthRateLimitUnavailableError) {
    return scimErrorResponse(new ScimApiError(503, "authentication temporarily unavailable", undefined, {
      "Retry-After": "30",
    }));
  }
  if (error instanceof ApiError) {
    return scimErrorResponse(new ScimApiError(
      error.status,
      error.message,
      error.status === 409 ? "uniqueness" : undefined,
    ));
  }
  if ((error as { code?: string } | null)?.code === "23505") {
    return scimErrorResponse(uniqueness("resource already exists"));
  }
  console.error("unhandled SCIM error", error);
  return scimErrorResponse(new ScimApiError(500, "internal server error"));
}

/**
 * Authenticate before every SCIM endpoint, then translate failures into the
 * RFC 7644 error envelope with application/scim+json.
 */
export function withScimAuth<P extends Params = Params>(
  handler: (req: NextRequest, ctx: ScimRequestContext<P>) => Promise<Response>,
) {
  return async (req: NextRequest, context?: { params?: Promise<P> }): Promise<Response> => {
    try {
      const auth = await authenticateScim(req);
      if (!auth) {
        return scimErrorResponse(new ScimApiError(401, "invalid or expired bearer token", undefined, {
          "WWW-Authenticate": "Bearer",
        }));
      }
      const params = context?.params ? await context.params : ({} as P);
      return await handler(req, { auth, params, origin: scimOrigin(req) });
    } catch (error) {
      return failure(error);
    }
  };
}
