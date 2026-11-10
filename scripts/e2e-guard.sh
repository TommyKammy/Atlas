#!/usr/bin/env bash
# Shared target validation for the destructive disposable test utilities.

e2e_abort() {
  printf 'Atlas E2E isolation check failed: %s\n' "$1" >&2
  exit 1
}

e2e_container() {
  local ids
  ids=$(docker ps -q --no-trunc \
    --filter "label=com.docker.compose.project=$ATLAS_E2E_STACK" \
    --filter "label=com.docker.compose.service=$1" \
    --filter "label=io.atlas.e2e-marker=$ATLAS_E2E_MARKER") || return 1
  [[ "$ids" =~ ^[a-f0-9]{64}$ ]] || return 1
  printf '%s\n' "$ids"
}

db_sql() {
  docker exec -i "$E2E_DB_ID" psql -X -v ON_ERROR_STOP=1 -h /var/run/postgresql -U atlas -d atlas_e2e "$@"
}

e2e_assert_db_marker() {
  local actual
  actual=$(db_sql -qAtc 'SELECT marker FROM atlas_e2e_identity') || e2e_abort 'database marker is missing'
  [[ "$actual" == "$ATLAS_E2E_MARKER" ]] || e2e_abort 'database marker does not match this stack'
}

e2e_wait_for_http() {
  local attempt status
  for ((attempt = 0; attempt < 90; attempt++)); do
    status=$(curl --noproxy '*' -s --max-time 2 -o /dev/null -w '%{http_code}' "$ATLAS_E2E_BASE/api/me") || status=""
    if [[ "$status" == 401 ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

require_e2e_target() {
  [[ "${ATLAS_E2E_STACK:-}" =~ ^atlas-e2e-[a-f0-9]{32}$ ]] || e2e_abort 'run bash tests/run-e2e.sh'
  [[ "${ATLAS_E2E_MARKER:-}" =~ ^[a-f0-9]{32}$ ]] || e2e_abort 'a per-run marker is required'
  E2E_DB_ID=$(e2e_container db) || e2e_abort 'exactly one labeled test database must be running'
  E2E_APP_ID=$(e2e_container app) || e2e_abort 'exactly one labeled test app must be running'
  local port token hash matched me
  port=$(docker port "$E2E_APP_ID" 3000/tcp) || e2e_abort 'test app port is not published'
  [[ "$port" =~ ^127\.0\.0\.1:[0-9]+$ && "${ATLAS_E2E_BASE:-}" == "http://$port" ]] \
    || e2e_abort 'HTTP target does not match the labeled test app'
  e2e_assert_db_marker

  # Put a one-minute challenge in the verified disposable database, then make a
  # read-only HTTP request. An app connected to another DB cannot know the token.
  token=$(openssl rand -base64 32 | tr '+/' '\055_' | tr -d '=[:space:]') || e2e_abort 'could not create session challenge'
  [[ "$token" =~ ^[A-Za-z0-9_-]{43}$ ]] || e2e_abort 'invalid session challenge'
  hash=$(printf '%s' "$token" | shasum -a 256 | cut -d' ' -f1) || e2e_abort 'could not hash session'
  [[ "$hash" =~ ^[a-f0-9]{64}$ ]] || e2e_abort 'could not hash session'
  matched=$(db_sql -qAtc "INSERT INTO user_sessions (token_hash, user_id, expires_at)
    SELECT '$hash', id, now() + interval '1 minute' FROM users WHERE id = 1 AND is_admin RETURNING user_id") \
    || e2e_abort 'could not create session challenge in the test database'
  [[ "$matched" == 1 ]] || e2e_abort 'the test admin fixture is missing'
  me=$(curl --noproxy '*' --proto '=http' -fsS --max-time 10 \
    --cookie "atlas_session=$token" "$ATLAS_E2E_BASE/api/me") || me=""
  db_sql -qc "DELETE FROM user_sessions WHERE token_hash = '$hash'" || e2e_abort 'could not remove session challenge'
  python3 -c 'import json,sys; u=json.load(sys.stdin); sys.exit(not (int(u["id"])==1 and u["is_admin"] is True))' \
    <<<"$me" 2>/dev/null || e2e_abort 'HTTP app and SQL database are different targets'
}
