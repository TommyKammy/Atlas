import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isSessionToken, SESSION_COOKIE } from "@/lib/session-token";
import { loadSessionByToken } from "@/lib/api/session";
import { queryAtRequestBoundary } from "@/lib/db";
import { STATIC_SECURITY_HEADERS } from "@/lib/security-headers";

function securityHeaders(nonce: string): Record<string, string> {
  // React's development build needs eval() for debugging features. Keep the
  // relaxed directive scoped to `next dev`; production keeps strict CSP.
  const dev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    dev
      ? `script-src 'self' 'unsafe-eval' 'nonce-${nonce}' 'strict-dynamic'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    dev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
    "media-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
  return {
    ...STATIC_SECURITY_HEADERS,
    "Content-Security-Policy": csp,
  };
}

function withSecurityHeaders(response: NextResponse, nonce: string): NextResponse {
  for (const [key, value] of Object.entries(securityHeaders(nonce))) {
    response.headers.set(key, value);
  }
  return response;
}

// Block invalid sessions before a protected page can stream HTML or an RSC payload.
export async function proxy(req: NextRequest) {
  const nonce = crypto.randomUUID();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  // Production SSR reads the nonce from the incoming CSP. In next dev,
  // forwarding this per-request header makes Turbopack Fast Refresh reload
  // continuously; its development renderer already receives the response CSP.
  // Keep the enforced response policy in both modes and discard client CSP.
  if (process.env.NODE_ENV === "development") {
    requestHeaders.delete("Content-Security-Policy");
  } else {
    requestHeaders.set("Content-Security-Policy", securityHeaders(nonce)["Content-Security-Policy"]);
  }

  const next = () => NextResponse.next({ request: { headers: requestHeaders } });
  const publicPath =
    req.nextUrl.pathname === "/login" ||
    req.nextUrl.pathname === "/api/automation/process" ||
    req.nextUrl.pathname.startsWith("/api/automation/webhook/") ||
    req.nextUrl.pathname.startsWith("/share/") ||
    req.nextUrl.pathname.startsWith("/invite/") ||
    req.nextUrl.pathname.startsWith("/scim/v2/") ||
    req.nextUrl.pathname.startsWith("/api/invitations/");

  if (publicPath) {
    return withSecurityHeaders(next(), nonce);
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!isSessionToken(token)) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return withSecurityHeaders(
        NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
        nonce,
      );
    }
    return withSecurityHeaders(NextResponse.redirect(new URL("/login", req.url)), nonce);
  }

  if (!req.nextUrl.pathname.startsWith("/api/")) {
    const session = await loadSessionByToken(token, { query: queryAtRequestBoundary });
    if (!session) return withSecurityHeaders(NextResponse.redirect(new URL("/login", req.url)), nonce);
    if (session.mfaPending && req.nextUrl.pathname !== "/profile") {
      return withSecurityHeaders(NextResponse.redirect(new URL("/profile#two-factor", req.url)), nonce);
    }
  }
  return withSecurityHeaders(next(), nonce);
}

export const config = {
  // These two authenticated JSON routes consume multipart bodies directly.
  // Next's Proxy otherwise clones the request body before the handler runs.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth|api/attachments/?$|api/projects/[^/]+/import/?$).*)"],
};
