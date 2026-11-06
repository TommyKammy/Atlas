import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Demo auth gate: every page/API except login requires a numeric atlas_uid cookie.
// Cookie issuance itself is password-gated at /api/auth/login.
export function proxy(req: NextRequest) {
  if (
    req.nextUrl.pathname === "/login" ||
    req.nextUrl.pathname.startsWith("/share/") ||
    req.nextUrl.pathname.startsWith("/invite/") ||
    req.nextUrl.pathname.startsWith("/api/invitations/")
  ) {
    return NextResponse.next();
  }
  const uid = req.cookies.get("atlas_uid")?.value;
  if (!uid || !/^\d+$/.test(uid)) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth).*)"],
};
