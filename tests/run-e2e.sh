#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/e2e-guard.sh

suite="${1:-shell}"
usage='usage: bash tests/run-e2e.sh [shell|browser|ui-contrast|toolbar|task-create|knowledge|knowledge-ai|sidebar|critical-performance|nginx|timeline-stability [repeat-count [workers]]]'
timeline_repeat=50
timeline_workers=4
case "$suite" in
  shell|browser|ui-contrast|toolbar|task-create|knowledge|knowledge-ai|sidebar|critical-performance|nginx) [[ $# -le 1 ]] || e2e_abort "$usage" ;;
  timeline-stability)
    [[ $# -le 3 ]] || e2e_abort "$usage"
    timeline_repeat="${2-50}"
    timeline_workers="${3-4}"
    [[ "$timeline_repeat" =~ ^[1-9][0-9]{0,2}$ ]] && (( timeline_repeat <= 500 )) \
      || e2e_abort 'timeline repeat-count must be an integer from 1 to 500'
    [[ "$timeline_workers" =~ ^[1-8]$ ]] \
      || e2e_abort 'timeline workers must be an integer from 1 to 8'
    ;;
  *) e2e_abort "$usage" ;;
esac
# Optional CI sharding of the full browser suite, e.g. ATLAS_E2E_SHARD=2/4.
# Each shard runs on its own fresh stack, so shards never share data.
browser_shard=()
if [[ -n "${ATLAS_E2E_SHARD:-}" ]]; then
  [[ "$suite" == browser ]] || e2e_abort 'ATLAS_E2E_SHARD is only supported for the browser suite'
  [[ "$ATLAS_E2E_SHARD" =~ ^([1-9][0-9]?)/([1-9][0-9]?)$ ]] && (( BASH_REMATCH[1] <= BASH_REMATCH[2] )) \
    || e2e_abort 'ATLAS_E2E_SHARD must look like 1/4 (index/total)'
  browser_shard=(--shard "$ATLAS_E2E_SHARD")
fi
for program in docker node python3 curl openssl shasum; do
  command -v "$program" >/dev/null || e2e_abort "missing test dependency: $program"
done

# Only this newly created stack uses this short-lived MFA encryption key.
export MFA_ENCRYPTION_KEY_ID=regression
MFA_ENCRYPTION_KEYS=$(node -e 'process.stdout.write(JSON.stringify({regression:require("node:crypto").randomBytes(32).toString("base64")}))')
export MFA_ENCRYPTION_KEYS
if [[ "$suite" == knowledge-ai || "$suite" == browser || "$suite" == nginx ]]; then
  export LLM_ENCRYPTION_KEY="$(openssl rand -base64 32)"
  export LLM_ALLOWED_LOCAL_ORIGINS="http://llm-mock:8080"
  export COMPOSE_PROFILES=ai
fi

export ATLAS_E2E_STACK="atlas-e2e-$(openssl rand -hex 16)"
export ATLAS_E2E_MARKER="$(openssl rand -hex 16)"
export ATLAS_E2E_WORKER_TOKEN="$(openssl rand -hex 32)"
[[ "$ATLAS_E2E_STACK" =~ ^atlas-e2e-[a-f0-9]{32}$ && "$ATLAS_E2E_MARKER" =~ ^[a-f0-9]{32}$ && "$ATLAS_E2E_WORKER_TOKEN" =~ ^[a-f0-9]{64}$ ]] \
  || e2e_abort 'could not generate stack identity'
free_tcp_port() {
  python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'
}
ATLAS_E2E_PORT=$(free_tcp_port)
export ATLAS_E2E_PORT
nginx_tmp=''
if [[ "$suite" == nginx ]]; then
  export ATLAS_E2E_NGINX=1
  ATLAS_NGINX_VERSION="${ATLAS_NGINX_VERSION:-1.31.9}"
  [[ "$ATLAS_NGINX_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || e2e_abort 'ATLAS_NGINX_VERSION must look like 1.30.7'
  export ATLAS_NGINX_VERSION
  ATLAS_E2E_HTTP_PORT=$(free_tcp_port)
  ATLAS_E2E_HTTPS_PORT=$(free_tcp_port)
  while [[ "$ATLAS_E2E_HTTPS_PORT" == "$ATLAS_E2E_PORT" \
    || "$ATLAS_E2E_HTTP_PORT" == "$ATLAS_E2E_PORT" \
    || "$ATLAS_E2E_HTTP_PORT" == "$ATLAS_E2E_HTTPS_PORT" ]]; do
    ATLAS_E2E_HTTP_PORT=$(free_tcp_port)
    ATLAS_E2E_HTTPS_PORT=$(free_tcp_port)
  done
  export ATLAS_E2E_HTTP_PORT ATLAS_E2E_HTTPS_PORT
  export ATLAS_E2E_BASE="https://127.0.0.1:$ATLAS_E2E_HTTPS_PORT"
else
  unset ATLAS_E2E_NGINX ATLAS_E2E_CA_CERT ATLAS_E2E_HTTP_PORT ATLAS_E2E_HTTPS_PORT
  export ATLAS_E2E_BASE="http://127.0.0.1:$ATLAS_E2E_PORT"
fi
compose=(docker compose -f docker-compose.ci.yml --project-name "$ATLAS_E2E_STACK")
if [[ "$suite" == nginx ]]; then compose+=(-f tests/nginx/compose.nginx.yml); fi
perf_override=''
[[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$ATLAS_E2E_STACK")" ]] \
  || e2e_abort 'test stack name already exists'

cleanup() {
  local status=$?
  if (( status != 0 )); then
    if [[ "$suite" == nginx ]]; then
      "${compose[@]}" logs --tail 50 app db nginx llm-mock >&2 || true
    else
      "${compose[@]}" logs --tail 50 app db >&2 || true
    fi
  fi
  "${compose[@]}" down --volumes --rmi local >&2 || true
  if [[ -n "$perf_override" ]]; then rm -f "$perf_override"; fi
  if [[ -n "$nginx_tmp" ]]; then rm -rf "$nginx_tmp"; fi
}
trap cleanup EXIT

if [[ "$suite" == nginx ]]; then
  # The app trusts this private proxy subnet. NGINX is the only long-lived
  # member; client containers live on a separate subnet.
  if ! read -r ATLAS_NGINX_SUBNET ATLAS_NGINX_CLIENT_SUBNET < <(python3 - <<'PY'
import ipaddress
import json
import subprocess
import sys

used = []
for name in subprocess.check_output(["docker", "network", "ls", "-q"], text=True).split():
    if not name:
        continue
    try:
        data = json.loads(subprocess.check_output(["docker", "network", "inspect", name], text=True))[0]
    except Exception:
        continue
    for config in (data.get("IPAM") or {}).get("Config") or []:
        subnet = config.get("Subnet")
        if subnet:
            try:
                used.append(ipaddress.ip_network(subnet))
            except ValueError:
                pass

picked = []
for second in range(200, 250):
    for third in range(1, 255):
        network = ipaddress.ip_network(f"10.{second}.{third}.0/24")
        if any(network.overlaps(item) for item in used + picked):
            continue
        picked.append(network)
        if len(picked) == 2:
            print(picked[0], picked[1])
            sys.exit(0)
sys.exit(1)
PY
  ); then
    e2e_abort 'could not allocate private Docker subnets'
  fi
  [[ "$ATLAS_NGINX_SUBNET" =~ ^10\.[0-9]+\.[0-9]+\.0/24$ && "$ATLAS_NGINX_CLIENT_SUBNET" =~ ^10\.[0-9]+\.[0-9]+\.0/24$ ]] \
    || e2e_abort 'could not allocate private Docker subnets'
  export ATLAS_NGINX_SUBNET ATLAS_NGINX_CLIENT_SUBNET
  export ATLAS_NGINX_CLIENT_NETWORK="${ATLAS_E2E_STACK}-clients"
  ATLAS_NGINX_CLIENT_A_IP=$(python3 -c 'import ipaddress,sys; print(list(ipaddress.ip_network(sys.argv[1]).hosts())[20])' "$ATLAS_NGINX_CLIENT_SUBNET")
  ATLAS_NGINX_CLIENT_B_IP=$(python3 -c 'import ipaddress,sys; print(list(ipaddress.ip_network(sys.argv[1]).hosts())[21])' "$ATLAS_NGINX_CLIENT_SUBNET")
  export ATLAS_NGINX_CLIENT_A_IP ATLAS_NGINX_CLIENT_B_IP

  mkdir -p test-results
  nginx_tmp=$(mktemp -d "$PWD/test-results/nginx-$ATLAS_E2E_STACK.XXXXXX")
  mkdir -p "$nginx_tmp/tls" "$nginx_tmp/conf" "$nginx_tmp/acme/.well-known/acme-challenge"
  printf 'atlas-e2e-acme-token' > "$nginx_tmp/acme/.well-known/acme-challenge/e2e-token"
  cat > "$nginx_tmp/ca.cnf" <<'EOF'
[req]
distinguished_name = dn
x509_extensions = v3_ca
prompt = no
[dn]
CN = Atlas E2E CA
[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
EOF
  cat > "$nginx_tmp/server.cnf" <<'EOF'
[req]
distinguished_name = dn
req_extensions = v3_req
prompt = no
[dn]
CN = localhost
[v3_req]
subjectAltName = @alt
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
[alt]
DNS.1 = localhost
DNS.2 = nginx
IP.1 = 127.0.0.1
EOF
  openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
    -keyout "$nginx_tmp/tls/ca.key" -out "$nginx_tmp/tls/ca.pem" \
    -config "$nginx_tmp/ca.cnf" >/dev/null 2>&1
  openssl req -new -newkey rsa:2048 -nodes \
    -keyout "$nginx_tmp/tls/server.key" -out "$nginx_tmp/tls/server.csr" \
    -config "$nginx_tmp/server.cnf" >/dev/null 2>&1
  openssl x509 -req -in "$nginx_tmp/tls/server.csr" \
    -CA "$nginx_tmp/tls/ca.pem" -CAkey "$nginx_tmp/tls/ca.key" -CAcreateserial \
    -CAserial "$nginx_tmp/tls/ca.srl" -days 2 -out "$nginx_tmp/tls/server.crt" \
    -extfile "$nginx_tmp/server.cnf" -extensions v3_req >/dev/null 2>&1
  openssl verify -CAfile "$nginx_tmp/tls/ca.pem" "$nginx_tmp/tls/server.crt" >/dev/null 2>&1 \
    || e2e_abort 'could not create the disposable TLS certificate'

  # Render the production include with only host-specific values changed.
  sed \
    -e 's|server_name atlas.example.com;|server_name localhost;|g' \
    -e 's|/etc/letsencrypt/live/atlas.example.com/fullchain.pem|/etc/nginx/atlas-tls/server.crt|g' \
    -e 's|/etc/letsencrypt/live/atlas.example.com/privkey.pem|/etc/nginx/atlas-tls/server.key|g' \
    -e 's|server 127.0.0.1:3000;|server app:3000;|g' \
    deploy/nginx/atlas.conf > "$nginx_tmp/conf/atlas.conf"
  grep -q 'server app:3000;' "$nginx_tmp/conf/atlas.conf" \
    || e2e_abort 'could not render the NGINX upstream'
  grep -q 'ssl_certificate     /etc/nginx/atlas-tls/server.crt;' "$nginx_tmp/conf/atlas.conf" \
    || e2e_abort 'could not render the NGINX certificate'
  export ATLAS_NGINX_CONF="$nginx_tmp/conf/atlas.conf"
  export ATLAS_NGINX_SNIPPET="$PWD/deploy/nginx/snippets/atlas-proxy-headers.conf"
  export ATLAS_NGINX_TLS_DIR="$nginx_tmp/tls"
  export ATLAS_NGINX_ACME_DIR="$nginx_tmp/acme"
  export ATLAS_E2E_CA_CERT="$nginx_tmp/tls/ca.pem"
fi

if [[ "$suite" == critical-performance ]]; then
  # This override belongs only to this newly generated stack. Ordinary full
  # regressions retain the worker; performance runs exclude background polling.
  perf_override=$(mktemp /tmp/atlas-critical-perf-compose.XXXXXX)
  cat > "$perf_override" <<'YAML'
services:
  app:
    environment:
      AUTOMATION_WORKER_DISABLED: "1"
YAML
  compose+=(-f "$perf_override")
fi

"${compose[@]}" up -d --wait --wait-timeout 90 db redis
E2E_DB_ID=$(e2e_container db) || e2e_abort 'test database did not start'
db_sql -q < db/init.sql
db_sql -q < db/seed.sql
db_sql -q < tests/e2e-seed.sql
# Simulate legacy drift, then prove migration 0037 repairs it and is repeatable.
db_sql -q -c 'UPDATE users SET is_admin = FALSE, is_guest = TRUE WHERE id = 1'
db_sql -q < db/migrations/0037_sync_role_flags.sql
db_sql -q < db/migrations/0037_sync_role_flags.sql
[[ "$(db_sql -qAtc "SELECT count(*) FROM users u JOIN workspace_roles r ON r.id = u.role_id
  WHERE u.is_admin IS DISTINCT FROM (r.base_level = 'admin')
     OR u.is_guest IS DISTINCT FROM (r.base_level = 'guest')")" == 0 ]] \
  || e2e_abort 'user role flags disagree with workspace_roles after migration 0037'
printf 'ok   migration 0037 aligns user role flags idempotently\n'
[[ "$(db_sql -qAtc 'SELECT count(*) FROM project_tabs WHERE project_id = 1 AND NOT is_custom')" == 10 ]] \
  || e2e_abort 'default project tabs were not seeded'
db_sql -q -v marker="$ATLAS_E2E_MARKER" <<'SQL'
CREATE TABLE atlas_e2e_identity (marker text PRIMARY KEY);
INSERT INTO atlas_e2e_identity VALUES (:'marker');
SQL

if [[ "$suite" == knowledge-ai || "$suite" == browser || "$suite" == nginx ]]; then "${compose[@]}" up -d --build llm-mock; fi
if [[ "$suite" == nginx ]]; then
  "${compose[@]}" up -d --build app nginx
  E2E_NGINX_ID=$(e2e_container nginx) || e2e_abort 'test nginx did not start'
else
  "${compose[@]}" up -d --build app
fi
E2E_APP_ID=$(e2e_container app) || e2e_abort 'test app did not start'
[[ "$(docker port "$E2E_APP_ID" 3000/tcp)" == "127.0.0.1:$ATLAS_E2E_PORT" ]] \
  || e2e_abort 'test app must publish the assigned loopback port'
export NO_PROXY=127.0.0.1 no_proxy=127.0.0.1 TZ=Asia/Tokyo
e2e_wait_for_http || e2e_abort 'test app did not become ready'

expect_guard_rejection() {
  local expected=$1 output
  shift
  if output=$("$@" 2>&1) || [[ "$output" != "Atlas E2E isolation check failed: $expected" ]]; then
    e2e_abort "guard did not reject the unsafe target as expected: $output"
  fi
}
expect_guard_rejection 'run bash tests/run-e2e.sh' \
  env ATLAS_E2E_STACK= bash tests/e2e.sh "$ATLAS_E2E_BASE"
if [[ "$suite" == nginx ]]; then
  expect_guard_rejection 'HTTPS target does not match the labeled test nginx' \
    env ATLAS_E2E_BASE=https://127.0.0.1:0 bash tests/e2e.sh https://127.0.0.1:0
else
  expect_guard_rejection 'HTTP target does not match the labeled test app' \
    env ATLAS_E2E_BASE=http://127.0.0.1:0 bash tests/e2e.sh http://127.0.0.1:0
fi
expect_guard_rejection 'a per-run marker is required' \
  env ATLAS_E2E_MARKER= bash scripts/restore.sh /no-such-backup
printf 'ok   unsafe E2E and restore targets refused\n'
if [[ "$suite" == browser || "$suite" == ui-contrast || "$suite" == toolbar || "$suite" == task-create || "$suite" == knowledge || "$suite" == knowledge-ai || "$suite" == sidebar || "$suite" == timeline-stability ]]; then
  browser_output="test-results/$suite-$ATLAS_E2E_STACK"
  if output=$(ATLAS_E2E_STACK= E2E_BASE_URL="$ATLAS_E2E_BASE" npm run test:browser -- --output "$browser_output/guard-missing-stack" 2>&1) ||
    [[ "$output" != *'Atlas E2E isolation check failed: run bash tests/run-e2e.sh'* ]]; then
    e2e_abort "Playwright did not reject the missing stack identity: $output"
  fi
  if output=$(E2E_BASE_URL=http://127.0.0.1:0 npm run test:browser -- --output "$browser_output/guard-wrong-target" 2>&1) ||
    [[ "$output" != *'Atlas E2E isolation check failed: Playwright base URL does not match the test stack'* ]]; then
    e2e_abort "Playwright did not reject the wrong HTTP target: $output"
  fi
  printf 'ok   unsafe Playwright targets refused\n'
  printf 'Playwright artifacts: %s\n' "$browser_output"
  if [[ "$suite" == timeline-stability ]]; then
    E2E_BASE_URL="$ATLAS_E2E_BASE" npm run test:browser -- tests/browser/timeline-resilience.spec.ts \
      --grep 'changing membership project|membership picker waits for client handlers' --repeat-each "$timeline_repeat" \
      --workers "$timeline_workers" --retries=0 --trace retain-on-failure --output "$browser_output"
  elif [[ "$suite" == ui-contrast ]]; then
    require_e2e_target
    mkdir -p "$browser_output"
    if [[ "${ATLAS_UI_CONTRAST_WRITE_BASELINE:-}" == "1" ]]; then
      BASE="$ATLAS_E2E_BASE" node scripts/ui-contrast.mjs --write-baseline | tee "$browser_output/baseline.json"
      printf 'Contrast baseline written: tests/fixtures/contrast-baseline.json\n'
    else
      ATLAS_UI_CONTRAST=1 E2E_BASE_URL="$ATLAS_E2E_BASE" npm run test:browser -- tests/browser/ui-contrast.spec.ts \
        --workers 1 --output "$browser_output"
    fi
  elif [[ "$suite" == task-create ]]; then
    E2E_BASE_URL="$ATLAS_E2E_BASE" npm run test:browser -- tests/browser/project-task-create.spec.ts tests/browser/section-task-create.spec.ts tests/browser/list.spec.ts tests/browser/board-section-add.spec.ts tests/browser/project-toolbar.spec.ts tests/browser/timeline-section-add.spec.ts tests/browser/list-section-insert.spec.ts tests/browser/timeline-windowing.spec.ts --workers 1 --output "$browser_output"
  elif [[ "$suite" == toolbar ]]; then
    E2E_BASE_URL="$ATLAS_E2E_BASE" npm run test:browser -- tests/browser/project-toolbar.spec.ts tests/browser/board-section-add.spec.ts tests/browser/list.spec.ts --workers 1 --output "$browser_output"
  elif [[ "$suite" == knowledge-ai ]]; then
    E2E_BASE_URL="$ATLAS_E2E_BASE" npm run test:browser -- tests/browser/knowledge-ai.spec.ts tests/browser/project-partner.spec.ts tests/browser/partner-workflows.spec.ts --workers 1 --output "$browser_output"
  elif [[ "$suite" == knowledge ]]; then
    require_e2e_target
    docker exec "$E2E_APP_ID" mkdir -p /app/tests
    docker cp tests/authorized-data-integration.ts "$E2E_APP_ID:/app/tests/authorized-data-integration.ts"
    docker exec -e ATLAS_E2E_MARKER="$ATLAS_E2E_MARKER" "$E2E_APP_ID" node --import tsx tests/authorized-data-integration.ts
    E2E_BASE_URL="$ATLAS_E2E_BASE" npm run test:browser -- tests/browser/knowledge.spec.ts tests/browser/knowledge-order.spec.ts tests/browser/knowledge-trash.spec.ts --output "$browser_output"
  elif [[ "$suite" == sidebar ]]; then
    E2E_BASE_URL="$ATLAS_E2E_BASE" npm run test:browser -- tests/browser/sidebar.spec.ts tests/browser/sidebar-project-order.spec.ts --workers 1 --output "$browser_output"
  else
    # The suite shares one database (sidebar order, recents, seeded users), so
    # it must run one test at a time. Pin it: Playwright's default worker count
    # follows the runner's CPU count and gave 2 workers on 4-core runners.
    E2E_BASE_URL="$ATLAS_E2E_BASE" npm run test:browser -- ${browser_shard[@]+"${browser_shard[@]}"} --workers 1 --output "$browser_output"
  fi
elif [[ "$suite" == nginx ]]; then
  require_e2e_target
  bash tests/nginx/check.sh
  # A small browser pass proves real pages and API calls work through the
  # self-signed HTTPS endpoint, not only curl. Playwright ignores the test CA.
  browser_output="test-results/nginx-$ATLAS_E2E_STACK"
  printf 'Playwright artifacts: %s\n' "$browser_output"
  E2E_BASE_URL="$ATLAS_E2E_BASE" E2E_IGNORE_HTTPS_ERRORS=1 npm run test:browser -- \
    tests/browser/sidebar.spec.ts --workers 1 --output "$browser_output"
elif [[ "$suite" == critical-performance ]]; then
  require_e2e_target
  fixture_project=$(db_sql -qAt < scripts/bench-critical-timeline.sql)
  [[ "$fixture_project" =~ ^[1-9][0-9]*$ ]] || e2e_abort 'critical performance fixture project was not created'
  [[ "$(db_sql -qAtc "SELECT count(*) FROM tasks WHERE project_id = $fixture_project")" == 3000 ]] \
    || e2e_abort 'critical performance fixture must contain exactly 3000 tasks'
  [[ "$(db_sql -qAtc "SELECT count(*) FROM task_dependencies d JOIN tasks t ON t.id = d.task_id WHERE t.project_id = $fixture_project")" == 3550 ]] \
    || e2e_abort 'critical performance dependency fixture is incomplete'
  benchmark_output="${BENCH_OUTPUT:-test-results/critical-performance-$ATLAS_E2E_STACK.json}"
  printf 'Critical performance artifact: %s\n' "$benchmark_output"
  E2E_BASE_URL="$ATLAS_E2E_BASE" BENCH_PROJECT_ID="$fixture_project" BENCH_OUTPUT="$benchmark_output" \
    node scripts/bench-critical-browser.mjs
else
  bash tests/e2e.sh "$ATLAS_E2E_BASE"
fi
