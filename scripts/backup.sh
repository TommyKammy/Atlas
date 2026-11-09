#!/usr/bin/env bash
# Atlas backup (disposable local env): DB dump + uploads archive.
# Usage: ./scripts/backup.sh [dest_dir]  (default ./backups/atlas-<timestamp>)
set -e -u
cd "$(dirname "$0")/.."
DEST="${1:-./backups/atlas-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$DEST"
echo "-> db dump"
docker exec atlas-db pg_dump -U atlas -d atlas --no-owner --no-privileges > "$DEST/db.sql"
echo "-> uploads archive"
rm -rf "$DEST/uploads-tmp" && mkdir -p "$DEST/uploads-tmp"
docker cp atlas-app:/app/uploads/. "$DEST/uploads-tmp/" 2>/dev/null || true
tar -czf "$DEST/uploads.tar.gz" -C "$DEST/uploads-tmp" . 2>/dev/null || tar -czf "$DEST/uploads.tar.gz" --files-from /dev/null
rm -rf "$DEST/uploads-tmp"
TABLES=$(docker exec atlas-db psql -U atlas -d atlas -t -A -c "SELECT 'tasks:'||(SELECT COUNT(*) FROM tasks)||' projects:'||(SELECT COUNT(*) FROM projects)||' comments:'||(SELECT COUNT(*) FROM comments);")
TABLES="$TABLES" DEST="$DEST" python3 -c "
import json, os, datetime
manifest = {
  'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
  'counts': os.environ['TABLES'],
}
open(os.environ['DEST'] + '/manifest.json', 'w').write(json.dumps(manifest, indent=1) + '\n')
print('manifest:', manifest)
"
ls -la "$DEST"
echo "backup done: $DEST"
