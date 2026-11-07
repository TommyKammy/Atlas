import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { recordSearchHistoryAtBoundary } from "@/lib/search-history";

function securityHeaders(nonce: string): Record<string, string> {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
  return {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  };
}

function withSecurityHeaders(response: NextResponse, nonce: string): NextResponse {
  for (const [key, value] of Object.entries(securityHeaders(nonce))) {
    response.headers.set(key, value);
  }
  return response;
}

// Demo auth gate: every page/API except login requires a numeric atlas_uid cookie.
// Cookie issuance itself is password-gated at /api/auth/login.
export async function proxy(req: NextRequest) {
  const nonce = crypto.randomUUID();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);

  const next = () => NextResponse.next({ request: { headers: requestHeaders } });
  const publicPath =
    req.nextUrl.pathname === "/login" ||
    req.nextUrl.pathname.startsWith("/share/") ||
    req.nextUrl.pathname.startsWith("/invite/") ||
    req.nextUrl.pathname.startsWith("/api/invitations/");

  if (publicPath) {
    return withSecurityHeaders(next(), nonce);
  }

  const uid = req.cookies.get("atlas_uid")?.value;
  if (!uid || !/^\d+$/.test(uid)) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return withSecurityHeaders(
        NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
        nonce,
      );
    }
    return withSecurityHeaders(NextResponse.redirect(new URL("/login", req.url)), nonce);
  }

  if (req.method === "GET" && req.nextUrl.pathname === "/search") {
    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (q !== "") {
      await recordSearchHistoryAtBoundary(Number(uid), q).catch(() => undefined);
    }
  }
  return withSecurityHeaders(next(), nonce);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth).*)"],
};
