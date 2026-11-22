#!/usr/bin/env node
// Send login failures from one disposable client container. The container's
// source address is the X-Forwarded-For value NGINX appends, so two containers
// can model two different clients without touching the host network.
const base = process.env.ATLAS_NGINX_LOGIN_BASE;
const label = process.env.ATLAS_NGINX_LABEL ?? "client";
const count = Number(process.env.ATLAS_NGINX_LOGIN_COUNT ?? "1");
const expected = (process.env.ATLAS_NGINX_LOGIN_EXPECT ?? "401").split(",");
const spoof = process.env.ATLAS_NGINX_SPOOF_XFF ?? "";
const email = process.env.ATLAS_NGINX_LOGIN_EMAIL ?? "nginx-rate-limit@example.com";

if (!base || !Number.isInteger(count) || count < 1 || expected.length !== count) {
  throw new Error("invalid client login configuration");
}

const statuses = [];
for (let index = 0; index < count; index += 1) {
  const headers = { "content-type": "application/json" };
  if (spoof !== "") headers["x-forwarded-for"] = spoof;
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password: "definitely-wrong" }),
  });
  statuses.push(response.status);
  await response.arrayBuffer();
}

const wanted = expected.map(Number).join(",");
const actual = statuses.join(",");
if (actual !== wanted) {
  console.error(`FAIL ${label}: expected ${wanted}, got ${actual}`);
  process.exitCode = 1;
} else {
  console.log(`ok   ${label}: HTTP ${actual}`);
}
