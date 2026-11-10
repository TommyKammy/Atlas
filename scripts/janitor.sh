#!/usr/bin/env bash
# Atlas log janitor: purge derived logs older than retention windows.
# Usage: ./scripts/janitor.sh [audit_days] [events_days] [trash_days]  (defaults 90 90 30)
set -euo pipefail
source "$(dirname "$0")/e2e-guard.sh"
require_e2e_target
AUDIT_DAYS="${1:-90}"
EVENTS_DAYS="${2:-90}"
TRASH_DAYS="${3:-30}"
[[ "$AUDIT_DAYS" =~ ^[0-9]+$ && "$EVENTS_DAYS" =~ ^[0-9]+$ && "$TRASH_DAYS" =~ ^[0-9]+$ ]] \
  || e2e_abort 'retention days must be non-negative integers'
echo "purging audit_log older than $AUDIT_DAYS days"
db_sql -t -c \
  "WITH del AS (DELETE FROM audit_log WHERE created_at < NOW() - make_interval(days => $AUDIT_DAYS) RETURNING 1) SELECT COUNT(*) FROM del;"
echo "purging expired share tokens"
db_sql -t -c \
  "WITH del AS (DELETE FROM project_share_tokens WHERE expires_at IS NOT NULL AND expires_at <= NOW() RETURNING 1) SELECT COUNT(*) FROM del;"
echo "purging trash older than $TRASH_DAYS days"
db_sql -t -c \
  "WITH del AS (DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - make_interval(days => $TRASH_DAYS) RETURNING 1) SELECT COUNT(*) FROM del;"
echo "purging task_events older than $EVENTS_DAYS days"
db_sql -t -c \
  "WITH del AS (DELETE FROM task_events WHERE created_at < NOW() - make_interval(days => $EVENTS_DAYS) RETURNING 1) SELECT COUNT(*) FROM del;"
