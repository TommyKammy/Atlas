#!/usr/bin/env bash
# Atlas backup (disposable local env): DB dump + uploads archive.
# Usage inside a verified disposable E2E stack: bash scripts/backup.sh <dest_dir>
set -euo pipefail
source "$(dirname "$0")/e2e-guard.sh"
require_e2e_target
DEST="${1:?usage: backup.sh <dest_dir>}"
umask 077
mkdir -- "$DEST"
echo "-> db dump"
docker exec "$E2E_DB_ID" pg_dump -h /var/run/postgresql -U atlas -d atlas_e2e \
  --no-owner --no-privileges > "$DEST/db.sql"
echo "-> uploads archive"
uploads=$(mktemp -d)
trap 'rm -rf -- "$uploads"' EXIT
if docker exec "$E2E_APP_ID" test -d /app/uploads; then
  docker cp "$E2E_APP_ID:/app/uploads/." "$uploads/"
fi
tar -czf "$DEST/uploads.tar.gz" -C "$uploads" .
TABLES=$(db_sql -t -A -c "SELECT 'tasks:'||(SELECT COUNT(*) FROM tasks)||' projects:'||(SELECT COUNT(*) FROM projects)||' comments:'||(SELECT COUNT(*) FROM comments);")
TABLES="$TABLES" DEST="$DEST" python3 -c "
import json, os, datetime
manifest = {
  'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
  'counts': os.environ['TABLES'],
}
open(os.environ['DEST'] + '/manifest.json', 'w').write(json.dumps(manifest, indent=1) + '\n')
print('manifest:', manifest)
"
printf '%s:%s\n' "$ATLAS_E2E_STACK" "$ATLAS_E2E_MARKER" > "$DEST/stack-identity"
ls -la "$DEST"
echo "backup done: $DEST"
