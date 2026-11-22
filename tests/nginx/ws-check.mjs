#!/usr/bin/env node
// WebSocket checks through the disposable NGINX proxy.
import fs from "node:fs";
import WebSocket from "ws";

const base = process.env.ATLAS_E2E_BASE;
const ca = process.env.ATLAS_E2E_CA_CERT;
if (!base || !ca) throw new Error("ATLAS_E2E_BASE and ATLAS_E2E_CA_CERT are required");

async function login() {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@example.com", password: "atlas-dev-2026" }),
  });
  if (response.status !== 200) throw new Error(`login failed: HTTP ${response.status}`);
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  const session = cookies.map((value) => /(?:^|;\s*)atlas_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(value))
    .find(Boolean);
  if (!session) throw new Error("login did not set atlas_session");
  return session[1];
}

function attempt(cookie, origin) {
  const url = new URL("/api/ws?project=1", base);
  url.protocol = "wss:";
  const headers = {};
  if (cookie) headers.Cookie = `atlas_session=${cookie}`;
  if (origin !== null) headers.Origin = origin;
  const socket = new WebSocket(url, { headers, ca: fs.readFileSync(ca) });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("WebSocket check timed out"));
    }, 10_000);
    socket.once("open", () => {
      clearTimeout(timer);
      resolve({ socket });
    });
    socket.once("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      response.resume();
      resolve({ status: Number(response.statusCode) });
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

const cookie = await login();
const origin = new URL(base).origin;

const valid = await attempt(cookie, origin);
if (!valid.socket) throw new Error(`valid WebSocket was rejected: HTTP ${valid.status}`);
console.log("ok   WebSocket upgrade through NGINX (wss with Origin)");
valid.socket.close(1000, "done");

const withoutCookie = await attempt("", origin);
if (withoutCookie.status !== 401) {
  throw new Error(`missing session should be 401, got ${withoutCookie.status ?? "open"}`);
}
console.log("ok   WebSocket without a session is rejected with 401");

const badOrigin = await attempt(cookie, "https://attacker.example");
if (badOrigin.status !== 403) {
  throw new Error(`wrong Origin should be 403, got ${badOrigin.status ?? "open"}`);
}
console.log("ok   WebSocket with a foreign Origin is rejected with 403");
