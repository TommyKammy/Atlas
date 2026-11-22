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

e2e_curl_get() {
  if [[ -n "${ATLAS_E2E_CA_CERT:-}" ]]; then
    curl --noproxy '*' --cacert "$ATLAS_E2E_CA_CERT" "$@"
  else
    curl --noproxy '*' "$@"
  fi
}

e2e_wait_for_http() {
  local attempt status
  for ((attempt = 0; attempt < 90; attempt++)); do
    status=$(e2e_curl_get -s --max-time 2 -o /dev/null -w '%{http_code}' "$ATLAS_E2E_BASE/api/me") || status=""
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
  local nginx_mode=0
  [[ "${ATLAS_E2E_NGINX:-}" == "1" ]] && nginx_mode=1
  E2E_DB_ID=$(e2e_container db) || e2e_abort 'exactly one labeled test database must be running'
  E2E_APP_ID=$(e2e_container app) || e2e_abort 'exactly one labeled test app must be running'
  local app_port token hash matched me proto
  app_port=$(docker port "$E2E_APP_ID" 3000/tcp) || e2e_abort 'test app port is not published'
  [[ "$app_port" =~ ^127\.0\.0\.1:[0-9]+$ ]] || e2e_abort 'test app port is not published'
  [[ "$app_port" == "127.0.0.1:${ATLAS_E2E_PORT:-}" ]] \
    || e2e_abort 'test app must publish the assigned loopback port'
  if (( nginx_mode )); then
    [[ -n "${ATLAS_E2E_CA_CERT:-}" && -f "${ATLAS_E2E_CA_CERT:-}" ]] || e2e_abort 'test CA certificate is missing'
    E2E_NGINX_ID=$(e2e_container nginx) || e2e_abort 'exactly one labeled test nginx must be running'
    local http_port https_port
    http_port=$(docker port "$E2E_NGINX_ID" 80/tcp) || e2e_abort 'test nginx HTTP port is not published'
    [[ "$http_port" == "127.0.0.1:${ATLAS_E2E_HTTP_PORT:-}" ]] \
      || e2e_abort 'HTTP target does not match the labeled test nginx'
    https_port=$(docker port "$E2E_NGINX_ID" 443/tcp) || e2e_abort 'test nginx port is not published'
    [[ "$https_port" =~ ^127\.0\.0\.1:[0-9]+$ && "${ATLAS_E2E_BASE:-}" == "https://$https_port" ]] \
      || e2e_abort 'HTTPS target does not match the labeled test nginx'
    proto='=https'
  else
    [[ "${ATLAS_E2E_BASE:-}" == "http://$app_port" ]] \
      || e2e_abort 'HTTP target does not match the labeled test app'
    proto='=http'
  fi
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
  me=$(e2e_curl_get --proto "$proto" -fsS --max-time 10 \
    --cookie "atlas_session=$token" "$ATLAS_E2E_BASE/api/me") || me=""
  db_sql -qc "DELETE FROM user_sessions WHERE token_hash = '$hash'" || e2e_abort 'could not remove session challenge'
  python3 -c 'import json,sys; u=json.load(sys.stdin); sys.exit(not (int(u["id"])==1 and u["is_admin"] is True))' \
    <<<"$me" 2>/dev/null || e2e_abort 'HTTP app and SQL database are different targets'
}
