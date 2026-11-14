#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/e2e-guard.sh

suite="${1:-shell}"
usage='usage: bash tests/run-e2e.sh [shell|browser|toolbar|task-create|knowledge|knowledge-ai|sidebar|critical-performance|timeline-stability [repeat-count [workers]]]'
timeline_repeat=50
timeline_workers=4
case "$suite" in
  shell|browser|toolbar|task-create|knowledge|knowledge-ai|sidebar|critical-performance) [[ $# -le 1 ]] || e2e_abort "$usage" ;;
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

# Only this newly created stack uses this short-lived MFA encryption key.
export MFA_ENCRYPTION_KEY_ID=regression
MFA_ENCRYPTION_KEYS=$(node -e 'process.stdout.write(JSON.stringify({regression:require("node:crypto").randomBytes(32).toString("base64")}))')
export MFA_ENCRYPTION_KEYS
if [[ "$suite" == knowledge-ai || "$suite" == browser ]]; then
  export LLM_ENCRYPTION_KEY="$(openssl rand -base64 32)"
  export LLM_ALLOWED_LOCAL_ORIGINS="http://llm-mock:8080"
  export COMPOSE_PROFILES=ai
fi

export ATLAS_E2E_STACK="atlas-e2e-$(openssl rand -hex 16)"
export ATLAS_E2E_MARKER="$(openssl rand -hex 16)"
export ATLAS_E2E_WORKER_TOKEN="$(openssl rand -hex 32)"
[[ "$ATLAS_E2E_STACK" =~ ^atlas-e2e-[a-f0-9]{32}$ && "$ATLAS_E2E_MARKER" =~ ^[a-f0-9]{32}$ && "$ATLAS_E2E_WORKER_TOKEN" =~ ^[a-f0-9]{64}$ ]] \
  || e2e_abort 'could not generate stack identity'
ATLAS_E2E_PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
export ATLAS_E2E_PORT
export ATLAS_E2E_BASE="http://127.0.0.1:$ATLAS_E2E_PORT"
compose=(docker compose -f docker-compose.ci.yml --project-name "$ATLAS_E2E_STACK")
perf_override=''
[[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$ATLAS_E2E_STACK")" ]] \
  || e2e_abort 'test stack name already exists'

cleanup() {
  local status=$?
  if (( status != 0 )); then "${compose[@]}" logs --tail 50 app db >&2 || true; fi
  "${compose[@]}" down --volumes --rmi local >&2 || true
  if [[ -n "$perf_override" ]]; then rm -f "$perf_override"; fi
}
trap cleanup EXIT

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
[[ "$(db_sql -qAtc 'SELECT count(*) FROM project_tabs WHERE project_id = 1 AND NOT is_custom')" == 10 ]] \
  || e2e_abort 'default project tabs were not seeded'
db_sql -q -v marker="$ATLAS_E2E_MARKER" <<'SQL'
CREATE TABLE atlas_e2e_identity (marker text PRIMARY KEY);
INSERT INTO atlas_e2e_identity VALUES (:'marker');
SQL

if [[ "$suite" == knowledge-ai || "$suite" == browser ]]; then "${compose[@]}" up -d --build llm-mock; fi
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
if [[ "$suite" == browser || "$suite" == toolbar || "$suite" == task-create || "$suite" == knowledge || "$suite" == knowledge-ai || "$suite" == sidebar || "$suite" == timeline-stability ]]; then
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
  elif [[ "$suite" == task-create ]]; then
    E2E_BASE_URL="$ATLAS_E2E_BASE" npm run test:browser -- tests/browser/project-task-create.spec.ts tests/browser/section-task-create.spec.ts tests/browser/list.spec.ts tests/browser/board-section-add.spec.ts tests/browser/project-toolbar.spec.ts tests/browser/timeline-section-add.spec.ts tests/browser/timeline-windowing.spec.ts --workers 1 --output "$browser_output"
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
    E2E_BASE_URL="$ATLAS_E2E_BASE" npm run test:browser -- --output "$browser_output"
  fi
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
