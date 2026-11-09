#!/usr/bin/env bash
# Atlas restore (DESTRUCTIVE, disposable local env only).
# Usage: ./scripts/restore.sh <backup_dir>
# Drops the public schema, replays db.sql, restores uploads, restarts app.
set -e -u
cd "$(dirname "$0")/.."
SRC="${1:?usage: restore.sh <backup_dir>}"
[[ -f "$SRC/db.sql" ]] || { echo "no db.sql in $SRC"; exit 1; }
echo "-> uploads restore (clear live files first)"
docker exec atlas-app sh -c 'rm -rf /app/uploads/* 2>/dev/null || true; mkdir -p /app/uploads' >/dev/null
echo "STOPPING app (db/redis keep running)"
docker compose stop app >/dev/null
echo "-> drop + recreate schema"
docker exec atlas-db psql -U atlas -d atlas -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null
echo "-> replay dump"
docker exec -i atlas-db psql -U atlas -d atlas -q -v ON_ERROR_STOP=1 < "$SRC/db.sql" >/dev/null
if [[ -f "$SRC/uploads.tar.gz" ]]; then
  rm -rf ./restore-tmp && mkdir -p ./restore-tmp
  tar -xzf "$SRC/uploads.tar.gz" -C ./restore-tmp
  docker cp ./restore-tmp/. atlas-app:/app/uploads/ 2>/dev/null || true
  rm -rf ./restore-tmp
fi
echo "-> starting app"
docker compose start app >/dev/null
sleep 6
docker compose ps --format '{{.Name}} {{.Status}}' | head -3
echo "restore done from $SRC"
