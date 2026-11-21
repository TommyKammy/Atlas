#!/usr/bin/env bash
# NGINX front-proxy regressions for `bash tests/run-e2e.sh nginx`.
# Everything below targets the disposable stack created by run-e2e.sh.
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/e2e-guard.sh
require_e2e_target

BASE="${ATLAS_E2E_BASE:?}"
CA="${ATLAS_E2E_CA_CERT:?}"
HTTP_PORT="${ATLAS_E2E_HTTP_PORT:?}"
NGINX_VERSION="${ATLAS_NGINX_VERSION:?}"
APP_IMAGE=$(docker inspect --format '{{.Config.Image}}' "$E2E_APP_ID")
PASS=0; FAIL=0

ok()  { PASS=$((PASS+1)); echo "ok   $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL $1${2:+ -- $2}"; }
expect_eq() { # description expected actual
  if [[ "$3" == "$2" ]]; then ok "$1"; else bad "$1" "expected=$2 actual=$3"; fi
}
count_hdr() { # name header-file
  local n
  n=$(grep -ci "^$1:" "$2" || true)
  printf '%s\n' "${n:-0}"
}
curlv() { curl --noproxy '*' --cacert "$CA" "$@"; }

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT
JAR="$TMPD/jar"
HDR="$TMPD/hdr"
BODY="$TMPD/body"

echo "== nginx build =="
VERSION=$(docker exec "$E2E_NGINX_ID" nginx -v 2>&1 || true)
if [[ "$VERSION" == *"nginx/$NGINX_VERSION"* ]]; then
  ok "nginx -v reports $NGINX_VERSION"
else
  bad "nginx -v reports $NGINX_VERSION" "$VERSION"
fi
if TEST_OUT=$(docker exec "$E2E_NGINX_ID" nginx -t 2>&1); then
  ok "nginx -t"
else
  bad "nginx -t" "$TEST_OUT"
fi

echo "== HTTP -> HTTPS =="
ACME=$(curl --noproxy '*' -fsS --max-time 10 "http://127.0.0.1:$HTTP_PORT/.well-known/acme-challenge/e2e-token" || true)
expect_eq "ACME HTTP-01 challenge is served on port 80" "atlas-e2e-acme-token" "$ACME"
REDIRECT=$(curl --noproxy '*' -sS --max-time 10 -o /dev/null -D - "http://127.0.0.1:$HTTP_PORT/projects/1?view=list" || true)
STATUS=$(printf '%s' "$REDIRECT" | sed -n '1s/^HTTP\/[0-9.]* \([0-9][0-9][0-9]\).*/\1/p')
expect_eq "HTTP page redirects with 301" "301" "$STATUS"
if printf '%s' "$REDIRECT" | grep -qi '^location: https://[^/]*/projects/1?view=list'; then
  ok "redirect targets the HTTPS URL with the original query"
else
  bad "redirect targets the HTTPS URL with the original query" "$(printf '%s' "$REDIRECT" | grep -i '^location:' || true)"
fi

echo "== auth and headers =="
LOGIN=$(curlv -sS --max-time 15 -o "$TMPD/login.json" -D "$TMPD/login.hdr" -c "$JAR" \
  -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"atlas-dev-2026"}' -w '%{http_code}')
expect_eq "login through HTTPS proxy" "200" "$LOGIN"
if grep -qi '^set-cookie: atlas_session=[A-Za-z0-9_-]\{43\}.*; Secure' "$TMPD/login.hdr"; then
  ok "session cookie is Secure behind the HTTPS proxy"
else
  bad "session cookie is Secure behind the HTTPS proxy"
fi
ME=$(curlv -sS --max-time 15 -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/api/me")
expect_eq "authenticated /api/me" "200" "$ME"

PAGE=$(curlv -sS --max-time 20 -b "$JAR" -D "$HDR" -o "$BODY" "$BASE/projects/1?view=list" -w '%{http_code}')
expect_eq "project page through NGINX" "200" "$PAGE"
if grep -q '__next_error__' "$BODY"; then bad "project page has no Next error page"; else ok "project page has no Next error page"; fi
expect_eq "HSTS header appears exactly once" "1" "$(count_hdr 'strict-transport-security' "$HDR")"
for header in x-content-type-options referrer-policy x-frame-options permissions-policy content-security-policy; do
  expect_eq "$header appears exactly once" "1" "$(count_hdr "$header" "$HDR")"
done
if grep -qi '^strict-transport-security: max-age=31536000; includeSubDomains' "$HDR"; then
  ok "HSTS value"
else
  bad "HSTS value" "$(grep -i '^strict-transport-security:' "$HDR" || true)"
fi
if grep -qi '^content-security-policy:.*nonce-' "$HDR"; then
  ok "Atlas CSP nonce survives the proxy"
else
  bad "Atlas CSP nonce survives the proxy"
fi
SERVER_HDR=$(grep -i '^server:' "$HDR" | head -1 | tr -d '\r' || true)
if [[ "$SERVER_HDR" == "Server: nginx" || "$SERVER_HDR" == "server: nginx" ]]; then
  ok "server_tokens off hides the NGINX version"
else
  bad "server_tokens off hides the NGINX version" "$SERVER_HDR"
fi

echo "== websocket =="
if WS_OUT=$(ATLAS_E2E_BASE="$BASE" ATLAS_E2E_CA_CERT="$CA" NODE_EXTRA_CA_CERTS="$CA" \
  node tests/nginx/ws-check.mjs 2>&1); then
  WS_COUNT=$(printf '%s\n' "$WS_OUT" | grep -c '^ok   ' || true)
  if [[ "$WS_COUNT" == "3" ]]; then
    while IFS= read -r line; do
      [[ "$line" == "ok   "* ]] && ok "${line#ok   }"
    done <<<"$WS_OUT"
  else
    bad "WebSocket checks reported all three passes" "$WS_OUT"
  fi
else
  bad "WebSocket upgrade through NGINX" "$WS_OUT"
fi

echo "== attachments =="
head25() { dd if=/dev/zero of="$1" bs=1048576 count=25 2>/dev/null; }
head25 "$TMPD/exact.bin"
AID=$(curlv -sS --max-time 120 -b "$JAR" -X POST "$BASE/api/attachments" \
  -F "task_id=2" -F "file=@$TMPD/exact.bin;type=application/octet-stream" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))' 2>/dev/null || true)
if [[ "$AID" =~ ^[0-9]+$ ]]; then
  ok "25 MiB attachment is accepted ($AID)"
else
  bad "25 MiB attachment is accepted" "$AID"
fi
SIZE=$(curlv -sS --max-time 15 -b "$JAR" "$BASE/api/attachments?task_id=2" \
  | python3 -c 'import json,sys; rows=json.load(sys.stdin); print(next((str(r["size_bytes"]) for r in rows if str(r["id"])==sys.argv[1]), ""))' "$AID" 2>/dev/null || true)
expect_eq "stored attachment has the exact 25 MiB size" "26214400" "$SIZE"
if [[ "$AID" =~ ^[0-9]+$ ]]; then curl --noproxy '*' --cacert "$CA" -sS --max-time 15 -b "$JAR" -X DELETE "$BASE/api/attachments/$AID" -o /dev/null || true; fi
dd if=/dev/zero of="$TMPD/too-big.bin" bs=1048576 count=27 2>/dev/null
OVER=$(curlv -sS --max-time 120 -b "$JAR" -o /dev/null -w '%{http_code}' -X POST "$BASE/api/attachments" \
  -F "task_id=2" -F "file=@$TMPD/too-big.bin;type=application/octet-stream" || true)
expect_eq "oversized attachment is rejected with 413" "413" "$OVER"
rm -f "$TMPD/exact.bin" "$TMPD/too-big.bin"

echo "== per-client login throttling =="
peer_hash() {
  python3 -c 'import hashlib,json,sys; print(hashlib.sha256(json.dumps(["peer",sys.argv[1]],separators=(",",":")).encode()).hexdigest())' "$1"
}
A_IP="${ATLAS_NGINX_CLIENT_A_IP:?}"
B_IP="${ATLAS_NGINX_CLIENT_B_IP:?}"
A_HASH=$(peer_hash "$A_IP")
B_HASH=$(peer_hash "$B_IP")
db_sql -q -c "INSERT INTO auth_rate_limits (scope,identity_hash,attempts,window_started_at,expires_at)
  VALUES ('peer','$A_HASH',499,clock_timestamp(),clock_timestamp()+interval '5 minutes')
  ON CONFLICT (scope,identity_hash) DO UPDATE SET attempts=499,
    window_started_at=clock_timestamp(),expires_at=clock_timestamp()+interval '5 minutes'"
run_client() { # ip label count expected [spoof]
  docker run --rm --network "$ATLAS_NGINX_CLIENT_NETWORK" --ip "$1" \
    -v "$ATLAS_NGINX_TLS_DIR:/certs:ro" \
    -v "$PWD/tests/nginx/client-login.mjs:/client-login.mjs:ro" \
    -e NODE_EXTRA_CA_CERTS=/certs/ca.pem \
    -e ATLAS_NGINX_LOGIN_BASE=https://nginx \
    -e ATLAS_NGINX_LOGIN_COUNT="$3" \
    -e ATLAS_NGINX_LOGIN_EXPECT="$4" \
    -e ATLAS_NGINX_SPOOF_XFF="${5:-}" \
    -e ATLAS_NGINX_LABEL="$2" \
    "$APP_IMAGE" node /client-login.mjs 2>&1
}
ok_line() { printf '%s\n' "$1" | grep '^ok   ' | tail -1 | sed 's/^ok   //'; }
expect_client() { # ip label count expected [spoof]
  local ip="$1" label="$2" count="$3" expected="$4" spoof="${5:-}" out line
  if out=$(run_client "$ip" "$label" "$count" "$expected" "$spoof"); then
    line=$(ok_line "$out" || true)
    if [[ -n "$line" ]]; then ok "$line"; else bad "$label" "$out"; fi
  else
    bad "$label" "$out"
  fi
}
expect_client "$A_IP" "client A reaches its seeded limit" 1 "401"
expect_client "$A_IP" "client A is now locked" 1 "429"
expect_client "$B_IP" "client B is not locked by client A" 1 "401"
expect_client "$B_IP" "client B spoofing A's X-Forwarded-For stays B" 1 "401" "$A_IP"
expect_client "$A_IP" "client A spoofing B's X-Forwarded-For cannot evade its lock" 1 "429" "$B_IP"
N_A=$(db_sql -qAtc "SELECT attempts FROM auth_rate_limits WHERE scope='peer' AND identity_hash='$A_HASH'")
N_B=$(db_sql -qAtc "SELECT attempts FROM auth_rate_limits WHERE scope='peer' AND identity_hash='$B_HASH'")
expect_eq "limiter row for client A is isolated" "500" "$N_A"
expect_eq "limiter row for client B counts only B" "2" "$N_B"
db_sql -q -c "DELETE FROM auth_rate_limits WHERE scope='peer' AND identity_hash IN ('$A_HASH','$B_HASH')"

echo "== SCIM conformance over HTTPS =="
SCIM_ENABLE=$(curlv -sS --max-time 15 -b "$JAR" -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/admin/security" \
  -H 'Content-Type: application/json' -d '{"scim_enabled":true}')
expect_eq "enable SCIM" "200" "$SCIM_ENABLE"
ORIGIN_JSON=$(curlv -sS --max-time 15 -b "$JAR" "$BASE/api/admin/scim/tokens")
expect_eq "SCIM origin prefers APP_ORIGIN" "$BASE" "$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("origin",""))' <<<"$ORIGIN_JSON")"
TOKEN_JSON=$(curlv -sS --max-time 15 -b "$JAR" -X POST "$BASE/api/admin/scim/tokens" \
  -H 'Content-Type: application/json' -d '{"name":"nginx e2e","idp":"entra"}')
SCIM_TOKEN=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))' <<<"$TOKEN_JSON")
if [[ "$SCIM_TOKEN" =~ ^atlas_scim_ ]]; then
  ok "issue a disposable SCIM token"
else
  bad "issue a disposable SCIM token" "$TOKEN_JSON"
fi
if SCIM_OUT=$(NODE_EXTRA_CA_CERTS="$CA" SCIM_TOKEN="$SCIM_TOKEN" \
  node scripts/scim-conformance.mjs --base "$BASE" --profile all 2>&1); then
  TOTAL=$(printf '%s\n' "$SCIM_OUT" | sed -n 's/^  total: \([0-9][0-9]*\) passed, 0 failed$/\1/p' | head -1)
  if [[ "$TOTAL" =~ ^[0-9]+$ ]] && (( TOTAL >= 30 )); then
    ok "SCIM conformance (profile all) passes every check ($TOTAL)"
  else
    bad "SCIM conformance summary" "$(printf '%s\n' "$SCIM_OUT" | tail -5)"
  fi
else
  bad "SCIM conformance (profile all) over HTTPS" "$SCIM_OUT"
fi

echo "== upstream keep-alive =="
# 6s is just above Node's old 5s keepAliveTimeout default. NGINX's upstream
# keepalive_timeout is 60s, so a stale connection would surface as 502 here.
for round in 1 2 3 4; do
  CODE=$(curlv -sS --max-time 15 -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/api/me")
  expect_eq "keep-alive round $round after idle gap" "200" "$CODE"
  if (( round < 4 )); then sleep 6; fi
done
BURST_FAIL=0
for round in $(seq 1 20); do
  CODE=$(curlv -sS --max-time 15 -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/api/me")
  [[ "$CODE" == "200" ]] || BURST_FAIL=1
done
expect_eq "20-request keep-alive burst has no 502" "0" "$BURST_FAIL"

echo "---- PASS=$PASS FAIL=$FAIL ----"
[[ "$FAIL" == "0" ]]
