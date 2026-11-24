import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isAllowedRedirectUri,
  isLoopbackRedirectUri,
  isValidRedirectForApplication,
  redirectUriMatches,
} from "./redirect";

test("loopback redirects match despite a different port", () => {
  assert.equal(redirectUriMatches("http://127.0.0.1:1234/callback", "http://127.0.0.1:60000/callback"), true);
  assert.equal(redirectUriMatches("http://[::1]:1234/callback", "http://[::1]:60000/callback"), true);
  assert.equal(redirectUriMatches("http://localhost:1234/callback", "http://localhost:60000/callback"), true);
  assert.equal(redirectUriMatches("http://localhost/callback", "http://localhost:1234/callback"), true);
});

test("a different loopback host, path or query is rejected", () => {
  assert.equal(redirectUriMatches("http://127.0.0.1:1234/callback", "http://localhost:1234/callback"), false);
  assert.equal(redirectUriMatches("http://localhost:1234/callback", "http://localhost:1234/other"), false);
  assert.equal(redirectUriMatches("http://localhost:1234/callback", "http://localhost:1234/callback/"), false);
  assert.equal(redirectUriMatches("http://localhost:1234/callback?a=1", "http://localhost:1234/callback?a=2"), false);
  assert.equal(redirectUriMatches("http://localhost:1234/callback", "https://localhost:1234/callback"), false);
});

test("non-loopback redirects require an exact match", () => {
  assert.equal(redirectUriMatches("https://app.example/cb", "https://app.example/cb"), true);
  assert.equal(redirectUriMatches("https://app.example/cb", "https://app.example/cb?x=1"), false);
  assert.equal(redirectUriMatches("https://app.example/cb", "https://App.example/cb"), false);
  assert.equal(redirectUriMatches("https://app.example:443/cb", "https://app.example/cb"), false);
});

test("plain http is only allowed on loopback", () => {
  assert.equal(isAllowedRedirectUri("http://127.0.0.1:1234/callback"), true);
  assert.equal(isAllowedRedirectUri("http://localhost/callback"), true);
  assert.equal(isAllowedRedirectUri("https://app.example/callback"), true);
  assert.equal(isAllowedRedirectUri("http://app.example/callback"), false);
  assert.equal(redirectUriMatches("http://app.example/callback", "http://app.example/callback"), false);
});

test("fragments, userinfo and non-http schemes are rejected", () => {
  assert.equal(isAllowedRedirectUri("https://app.example/callback#frag"), false);
  assert.equal(isAllowedRedirectUri("https://app.example/callback#"), false);
  assert.equal(isAllowedRedirectUri("https://user:pass@app.example/callback"), false);
  assert.equal(isAllowedRedirectUri("com.example.app:/callback"), false);
  assert.equal(isAllowedRedirectUri("http://localhost:1234/callback#x"), false);
  assert.equal(redirectUriMatches("https://app.example/cb", "https://app.example/cb#x"), false);
});

test("native clients require loopback and web clients require https", () => {
  assert.equal(isLoopbackRedirectUri("http://127.0.0.1:5000/callback"), true);
  assert.equal(isLoopbackRedirectUri("https://app.example/callback"), false);
  assert.equal(isValidRedirectForApplication("http://localhost:5000/callback", "native"), true);
  assert.equal(isValidRedirectForApplication("https://app.example/callback", "native"), false);
  assert.equal(isValidRedirectForApplication("https://app.example/callback", "web"), true);
  assert.equal(isValidRedirectForApplication("http://localhost:5000/callback", "web"), false);
});
