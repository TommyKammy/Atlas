#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/e2e-guard.sh

suite="${1:-shell}"
usage='usage: bash tests/run-e2e.sh [shell|browser|timeline-stability [repeat-count [workers]]]'
timeline_repeat=50
timeline_workers=4
case "$suite" in
  shell|browser) [[ $# -le 1 ]] || e2e_abort "$usage" ;;
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
for program in docker node python3 curl openssl shasum; do
  command -v "$program" >/dev/null || e2e_abort "missing test dependency: $program"
done

export ATLAS_E2E_STACK="atlas-e2e-$(openssl rand -hex 16)"
export ATLAS_E2E_MARKER="$(openssl rand -hex 16)"
export ATLAS_E2E_WORKER_TOKEN="$(openssl rand -hex 32)"
[[ "$ATLAS_E2E_STACK" =~ ^atlas-e2e-[a-f0-9]{32}$ && "$ATLAS_E2E_MARKER" =~ ^[a-f0-9]{32}$ && "$ATLAS_E2E_WORKER_TOKEN" =~ ^[a-f0-9]{64}$ ]] \
  || e2e_abort 'could not generate stack identity'
ATLAS_E2E_PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
export ATLAS_E2E_PORT
export ATLAS_E2E_BASE="http://127.0.0.1:$ATLAS_E2E_PORT"
compose=(docker compose -f docker-compose.ci.yml --project-name "$ATLAS_E2E_STACK")
[[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$ATLAS_E2E_STACK")" ]] \
  || e2e_abort 'test stack name already exists'

cleanup() {
  local status=$?
  if (( status != 0 )); then "${compose[@]}" logs --tail 50 app db >&2 || true; fi
  "${compose[@]}" down --volumes --rmi local >&2 || true
}
trap cleanup EXIT

"${compose[@]}" up -d --wait --wait-timeout 90 db redis
E2E_DB_ID=$(e2e_container db) || e2e_abort 'test database did not start'
db_sql -q < db/init.sql
db_sql -q < db/seed.sql
db_sql -q < tests/e2e-seed.sql
[[ "$(db_sql -qAtc 'SELECT count(*) FROM project_tabs WHERE project_id = 1 AND NOT is_custom')" == 10 ]] \
  || e2e_abort 'default project tabs were not seeded'
db_sql -q -v marker="$ATLAS_E2E_MARKER" <<'SQL'
CREATE TABLE atlas_e2e_identity (marker text PRIMARY KEY);
INSERT INTO atlas_e2e_identity VALUES (:'marker');
SQL

"${compose[@]}" up -d --build app
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
expect_guard_rejection 'HTTP target does not match the labeled test app' \
  env ATLAS_E2E_BASE=http://127.0.0.1:0 bash tests/e2e.sh http://127.0.0.1:0
expect_guard_rejection 'a per-run marker is required' \
  env ATLAS_E2E_MARKER= bash scripts/restore.sh /no-such-backup
printf 'ok   unsafe E2E and restore targets refused\n'
if [[ "$suite" == browser || "$suite" == timeline-stability ]]; then
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
  else
    E2E_BASE_URL="$ATLAS_E2E_BASE" npm run test:browser -- --output "$browser_output"
  fi
else
  bash tests/e2e.sh "$ATLAS_E2E_BASE"
fi
