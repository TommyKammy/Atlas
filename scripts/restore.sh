#!/usr/bin/env bash
# Atlas restore (DESTRUCTIVE, disposable local env only).
# Usage inside the disposable stack that created the backup: bash scripts/restore.sh <backup_dir>
# Drops the public schema, replays db.sql, restores uploads, restarts app.
set -euo pipefail
source "$(dirname "$0")/e2e-guard.sh"
require_e2e_target
SRC="${1:?usage: restore.sh <backup_dir>}"
[[ -s "$SRC/db.sql" && -f "$SRC/uploads.tar.gz" && -f "$SRC/stack-identity" ]] \
  || e2e_abort 'backup is incomplete'
[[ "$(cat -- "$SRC/stack-identity")" == "$ATLAS_E2E_STACK:$ATLAS_E2E_MARKER" ]] \
  || e2e_abort 'backup belongs to a different test stack'
uploads=$(mktemp -d)
trap 'rm -rf -- "$uploads"' EXIT
tar -xzf "$SRC/uploads.tar.gz" -C "$uploads"
echo "STOPPING app (db/redis keep running)"
docker stop "$E2E_APP_ID" >/dev/null
echo "-> drop + recreate schema"
db_sql -q -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null
echo "-> replay dump"
db_sql -q < "$SRC/db.sql" >/dev/null
e2e_assert_db_marker
echo "-> starting app"
docker start "$E2E_APP_ID" >/dev/null
docker exec "$E2E_APP_ID" sh -ec 'mkdir -p /app/uploads; find /app/uploads -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
docker cp "$uploads/." "$E2E_APP_ID:/app/uploads/"
e2e_wait_for_http || e2e_abort 'restored test app did not become ready'
echo "restore done from $SRC"
