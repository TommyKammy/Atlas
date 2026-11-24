import { NextResponse } from "next/server";
import {
  POST_LOGIN_COOKIE,
  postLoginCookieOptions,
  safePostLoginPath,
} from "@/lib/post-login";

/**
 * Persist the authorization page as the post-login destination. Server
 * Components cannot set cookies in the App Router, so the page redirects here,
 * this handler stores the short-lived cookie, and the browser continues to the
 * login or MFA screen.
 */
export function GET(req: Request): Response {
  const url = new URL(req.url);
  const next = safePostLoginPath(url.searchParams.get("next"));
  const destination = url.searchParams.get("to") === "mfa"
    ? "/profile#two-factor"
    : "/login";
  const response = NextResponse.redirect(new URL(destination, req.url), 303);
  response.headers.set("Cache-Control", "no-store");
  if (next !== null) {
    response.cookies.set(POST_LOGIN_COOKIE, next, postLoginCookieOptions());
  }
  return response;
}
