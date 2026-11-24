import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionCookieSecure } from "./cookie-security";
import {
  POST_LOGIN_COOKIE,
  postLoginCookieHeader,
  postLoginCookieOptions,
  postLoginPathFromCookieHeader,
  safePostLoginPath,
} from "./post-login";

test("the post-login destination accepts only the authorization page", () => {
  assert.equal(safePostLoginPath("/oauth/authorize"), "/oauth/authorize");
  assert.equal(
    safePostLoginPath("/oauth/authorize?client_id=https%3A%2F%2Fclient.example&state=x"),
    "/oauth/authorize?client_id=https%3A%2F%2Fclient.example&state=x",
  );
  assert.equal(safePostLoginPath("/oauth/authorize?scope=read%20write"), "/oauth/authorize?scope=read%20write");
});

test("external, protocol-relative and other paths are ignored", () => {
  for (const value of [
    "https://evil.example/oauth/authorize",
    "//evil.example/oauth/authorize",
    "/\\evil.example/oauth/authorize",
    "/oauth/authorize/../profile",
    "/oauth/authorizeevil",
    "/oauth/authorize#fragment",
    "/profile",
    "/oauth/token",
    "javascript:alert(1)",
    "",
    null,
    undefined,
    42,
  ]) {
    assert.equal(safePostLoginPath(value), null, String(value));
  }
});

test("the cookie header round-trips an encoded destination", () => {
  const path = "/oauth/authorize?client_id=https%3A%2F%2Fclient.example&state=abc";
  assert.equal(
    postLoginPathFromCookieHeader(`other=1; ${POST_LOGIN_COOKIE}=${encodeURIComponent(path)}; last=2`),
    path,
  );
  assert.equal(
    postLoginPathFromCookieHeader(`${POST_LOGIN_COOKIE}=${encodeURIComponent("https://evil.example")}`),
    null,
  );
  assert.equal(postLoginPathFromCookieHeader(`x=${POST_LOGIN_COOKIE}`), null);
  assert.equal(postLoginPathFromCookieHeader(null), null);
});

test("the post-login cookie is short-lived, httpOnly and SameSite=Lax", () => {
  const options = postLoginCookieOptions();
  assert.equal(options.path, "/");
  assert.equal(options.maxAge, 600);
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, "lax");
  assert.equal(options.secure, sessionCookieSecure());

  const header = postLoginCookieHeader("/oauth/authorize?state=x");
  assert.match(header, /^atlas_post_login=/);
  assert.match(header, /; Path=\//);
  assert.match(header, /; Max-Age=600/);
  assert.match(header, /; HttpOnly/);
  assert.match(header, /; SameSite=Lax/);
  assert.equal(header.includes("; Secure"), sessionCookieSecure());
});
