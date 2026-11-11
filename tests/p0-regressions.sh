#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

suite="${1:-p0}"
project_delete_repeat=1
case "$suite" in
  p0|p1|integrity|p2|all|approval)
    [[ $# -le 1 ]] || { echo "Unexpected regression arguments" >&2; exit 2; }
    ;;
  project-delete)
    [[ $# -le 2 ]] || { echo "Usage: bash tests/p0-regressions.sh project-delete [repeat-count]" >&2; exit 2; }
    project_delete_repeat="${2-1}"
    [[ "$project_delete_repeat" =~ ^[1-9][0-9]{0,2}$ ]] && (( project_delete_repeat <= 500 )) \
      || { echo "project-delete repeat-count must be an integer from 1 to 500" >&2; exit 2; }
    ;;
  *) echo "Usage: bash tests/p0-regressions.sh [p0|p1|integrity|p2|all|approval|project-delete [repeat-count]]" >&2; exit 2 ;;
esac

# Each disposable stack receives its own ephemeral encryption key.
export MFA_ENCRYPTION_KEY_ID=regression
MFA_ENCRYPTION_KEYS=$(node -e 'process.stdout.write(JSON.stringify({regression:require("node:crypto").randomBytes(32).toString("base64")}))')
export MFA_ENCRYPTION_KEYS

prefix="atlas-p0-$(date +%s)-$$-$RANDOM"
image="$prefix:app"
network_id="" db_id="" redis_id="" app_id="" replica_id="" uploads_volume="" saml_dir=""
built=false

cleanup() {
  local status=$?
  if [[ "$status" != 0 ]]; then
    if [[ -n "$app_id" ]]; then docker logs --tail 50 "$app_id" >&2 || true; fi
    if [[ -n "$replica_id" ]]; then docker logs --tail 50 "$replica_id" >&2 || true; fi
    if [[ -n "$db_id" ]]; then docker logs --tail 30 "$db_id" >&2 || true; fi
  fi
  for id in "$replica_id" "$app_id" "$redis_id" "$db_id"; do
    if [[ -n "$id" ]]; then docker rm -f "$id" >/dev/null || true; fi
  done
  if [[ -n "$network_id" ]]; then docker network rm "$network_id" >/dev/null || true; fi
  if [[ -n "$uploads_volume" ]]; then docker volume rm "$uploads_volume" >/dev/null || true; fi
  if "$built"; then docker image rm "$image" >/dev/null || true; fi
  if [[ -n "$saml_dir" ]]; then rm -r "$saml_dir"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Use the working tree without ignored files or macOS ._ metadata sidecars.
git ls-files -z --cached --others --exclude-standard -- ':(exclude,glob)**/.env*' |
  COPYFILE_DISABLE=1 tar -czf - --null -T - |
  docker build -t "$image" -
built=true

# Only these newly created containers can access the test database.
network_id=$(docker network create --internal "$prefix")
uploads_volume=$(docker volume create "$prefix-uploads")
db_id=$(docker run -d --name "$prefix-db" --network "$network_id" --network-alias db \
  --tmpfs /var/lib/postgresql -e POSTGRES_USER=atlas -e POSTGRES_PASSWORD=atlas \
  -e POSTGRES_DB=atlas_p0 pgvector/pgvector:pg18)
for attempt in {1..60}; do
  if docker exec "$db_id" pg_isready -q -h 127.0.0.1 -U atlas -d atlas_p0; then break; fi
  if [[ "$attempt" == 60 ]]; then docker logs --tail 30 "$db_id" >&2; exit 1; fi
  sleep 1
done
docker exec -i "$db_id" psql -X -q -v ON_ERROR_STOP=1 -U atlas -d atlas_p0 < db/init.sql
# Reproduce the old move's result before the app applies migrations.
docker exec -i "$db_id" psql -X -q -v ON_ERROR_STOP=1 -U atlas -d atlas_p0 <<'SQL'
WITH homes AS (
  INSERT INTO projects (workspace_id, name) VALUES (1, 'Legacy A'), (1, 'Legacy B')
  RETURNING id, name
), parent AS (
  INSERT INTO tasks (project_id, name) SELECT id, 'Legacy parent' FROM homes WHERE name = 'Legacy A'
  RETURNING id
)
INSERT INTO tasks (project_id, parent_task_id, name)
SELECT homes.id, parent.id, 'Legacy child' FROM homes CROSS JOIN parent WHERE homes.name = 'Legacy B';
SQL

# Resolve the Redis hostname from startup, but refuse connections until the
# first test has checked the HTTP listener and a write with Redis unavailable.
redis_id=$(docker run -d --name "$prefix-redis" --network "$network_id" --network-alias redis \
  --entrypoint sh redis:8-alpine -c 'until [ -f /tmp/start-redis ]; do sleep 1; done; exec redis-server')
app_id=$(docker run -d --name "$prefix-app" --network "$network_id" \
  --mount "source=$uploads_volume,target=/app/uploads" \
  -e DATABASE_URL=postgres://atlas:atlas@db:5432/atlas_p0 \
  -e MFA_ENCRYPTION_KEY_ID -e MFA_ENCRYPTION_KEYS \
  -e REDIS_URL=redis://redis:6379 -e AUTOMATION_WORKER_DISABLED=1 -e NOTIFICATION_WORKER_DISABLED=1 \
  -e AUTOMATION_WORKER_TOKEN=atlas-regression-worker "$image")
docker exec "$app_id" mkdir -p /app/tests
docker cp tests/regression-fixtures.mjs "$app_id:/app/tests/"
# Direct tsx regression imports need the same @/* resolution as the build.
docker cp tsconfig.json "$app_id:/app/tsconfig.json"

status=0
if [[ "$suite" == p0 || "$suite" == all ]]; then
  docker cp tests/p0-regressions.mjs "$app_id:/app/tests/"
  docker exec "$app_id" node --test --test-name-pattern='^R03 Redis unavailable' /app/tests/p0-regressions.mjs || status=1
fi
docker exec "$redis_id" touch /tmp/start-redis
if [[ "$suite" == p0 || "$suite" == all ]]; then
  docker exec "$app_id" node --test --test-name-pattern='^(R01|R02|R03 Redis recovery)' /app/tests/p0-regressions.mjs || status=1
fi
if [[ "$suite" == p1 || "$suite" == all ]]; then
  saml_dir=$(mktemp -d "${TMPDIR:-/tmp}/atlas-saml-regression.XXXXXX")
  openssl req -x509 -nodes -newkey rsa:2048 -keyout "$saml_dir/key.pem" \
    -out "$saml_dir/cert.pem" -subj '/CN=Atlas regression IdP' -days 1 2>"$saml_dir/openssl.log" \
    || { cat "$saml_dir/openssl.log" >&2; exit 1; }
  docker exec "$app_id" mkdir -p /app/tests/saml-fixture
  docker cp "$saml_dir/key.pem" "$app_id:/app/tests/saml-fixture/"
  docker cp "$saml_dir/cert.pem" "$app_id:/app/tests/saml-fixture/"
  docker cp tests/saml-assertion.mjs "$app_id:/app/tests/"
  docker cp tests/p1-regressions.mjs "$app_id:/app/tests/"
  docker exec "$app_id" node --import tsx --test /app/tests/p1-regressions.mjs || status=1
  for file in auth-encryption auth-policy auth-rate-limit; do
    docker cp "tests/$file-regressions.mjs" "$app_id:/app/tests/"
    docker exec "$app_id" node --import tsx --test "/app/tests/$file-regressions.mjs" || status=1
  done
  for file in p1-final-portfolio p1-final-task-auth p1-final-copy; do
    docker cp "tests/$file-regressions.mjs" "$app_id:/app/tests/"
    docker exec "$app_id" node --test "/app/tests/$file-regressions.mjs" || status=1
  done
fi
if [[ "$suite" == integrity || "$suite" == all ]]; then
  docker cp tests/p1-integrity-regressions.mjs "$app_id:/app/tests/"
  docker exec "$app_id" node --test /app/tests/p1-integrity-regressions.mjs || status=1
  docker cp tests/p1-automation-regressions.mjs "$app_id:/app/tests/"
  docker exec "$app_id" node --test /app/tests/p1-automation-regressions.mjs || status=1
  docker cp tests/ar01-ar03-regressions.mjs "$app_id:/app/tests/"
  docker exec "$app_id" node --test /app/tests/ar01-ar03-regressions.mjs || status=1
  for file in ar04 ar05 ar08 ar10 ar11 ar12 ar13 rules-custom-fields rules-project-scope rule-editor-drafts rule-editor-preview rule-editor-options rule-editor-pages rule-condition-input; do
    docker cp "tests/$file-regressions.mjs" "$app_id:/app/tests/"
    docker exec "$app_id" node --import tsx --test "/app/tests/$file-regressions.mjs" || status=1
  done
fi
if [[ "$suite" == project-delete || "$suite" == all || "$suite" == integrity ]]; then
  for file in project-delete-automation project-delete-automation-extra; do
    docker cp "tests/$file-regressions.mjs" "$app_id:/app/tests/"
    docker exec -e "ATLAS_PROJECT_DELETE_REPEAT=$project_delete_repeat" "$app_id" \
      node --import tsx --test "/app/tests/$file-regressions.mjs" || status=1
  done
fi
if [[ "$suite" == approval || "$suite" == all || "$suite" == integrity ]]; then
  docker cp tests/task-approval-regressions.mjs "$app_id:/app/tests/"
  docker exec "$app_id" node --import tsx --test /app/tests/task-approval-regressions.mjs || status=1
fi
if [[ "$suite" == p1 || "$suite" == all || "$suite" == integrity ]]; then
  for file in ev01 ev03 ev04-ev05; do
    docker cp "tests/$file-regressions.mjs" "$app_id:/app/tests/"
    docker exec "$app_id" node --import tsx --test "/app/tests/$file-regressions.mjs" || status=1
  done
fi
if [[ "$suite" == p2 || "$suite" == all ]]; then
  replica_id=$(docker run -d --name "$prefix-attachment-replica" --network "$network_id" \
    --network-alias attachment-replica --mount "source=$uploads_volume,target=/app/uploads" \
    -e DATABASE_URL=postgres://atlas:atlas@db:5432/atlas_p0 \
    -e MFA_ENCRYPTION_KEY_ID -e MFA_ENCRYPTION_KEYS \
  -e REDIS_URL=redis://redis:6379 -e AUTOMATION_WORKER_DISABLED=1 -e NOTIFICATION_WORKER_DISABLED=1 "$image")
  for file in p2-migration p2-data p2-automation p2-attachments p2-timeline-pins ev09 ev10; do
    docker cp "tests/$file-regressions.mjs" "$app_id:/app/tests/"
    docker exec -e ATLAS_ATTACHMENT_REPLICA=http://attachment-replica:3000 \
      "$app_id" node --import tsx --test "/app/tests/$file-regressions.mjs" || status=1
  done
fi
exit "$status"
