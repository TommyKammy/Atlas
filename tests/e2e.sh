#!/usr/bin/env bash
# Atlas API/page regression suite (disposable local env only).
# Creates its own fixtures and deletes them; seed data must remain intact.
# Provision an isolated target with: bash tests/run-e2e.sh
set -u
cd "$(dirname "$0")/.."
source scripts/e2e-guard.sh
BASE="${1:-}"
[[ -n "$BASE" && "$BASE" == "${ATLAS_E2E_BASE:-}" ]] || e2e_abort 'run bash tests/run-e2e.sh'
[[ "${ATLAS_E2E_WORKER_TOKEN:-}" =~ ^[a-f0-9]{64}$ ]] || e2e_abort 'a per-run automation token is required'
require_e2e_target
export NO_PROXY=127.0.0.1 no_proxy=127.0.0.1
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); echo "ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL $1${2:+ -- $2}"; }

# GET page: expect 200 and no Next error page. Saves body to $2.
page() { # url outfile
  local code
  if [[ -n "${JAR:-}" && -f "$JAR" ]]; then
    code=$(curl -s -m 15 -b "$JAR" -o "$2" -w "%{http_code}" "$BASE$1")
  else
    code=$(curl -s -m 15 -o "$2" -w "%{http_code}" "$BASE$1")
  fi
  if [[ "$code" != "200" ]]; then bad "GET $1 (HTTP $code)"; return 1; fi
  if grep -q __next_error__ "$2"; then bad "GET $1 (error page)"; return 1; fi
  ok "GET $1"; return 0
}

# api METHOD path [data|@file] [extra curl args...]: prints response body.
api() { # method path [data]
  local m="$1" p="$2" d="${3:-}"
  local jar=()
  [[ -n "${JAR:-}" && -f "$JAR" ]] && jar=(-b "$JAR")
  if [[ -z "$d" ]]; then curl -s -m 15 "${jar[@]}" -X "$m" "$BASE$p"
  else curl -s -m 15 "${jar[@]}" -X "$m" "$BASE$p" -H 'Content-Type: application/json' -d "$d"; fi
}

purge_task() {
  local id="$1"
  [[ "$id" =~ ^[0-9]+$ ]] || return 1
  api DELETE "/api/tasks/$id" >/dev/null
  api DELETE "/api/tasks/$id?force=1"
}

jget() { python3 -c "import json,sys; print(json.load(sys.stdin).get('$2',''))" <<<"$1"; }

TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT
JAR="$TMPD/jar"

echo "== auth =="
C=$(curl -s -m 15 -b "$JAR" -o /dev/null -w "%{http_code}" "$BASE/")
[[ "$C" == "307" || "$C" == "308" ]] && ok "unauth page redirects ($C)" || bad "unauth page redirect ($C)"
C=$(curl -s -m 15 -b "$JAR" -o /dev/null -w "%{http_code}" "$BASE/api/tasks")
[[ "$C" == "401" ]] && ok "unauth api 401" || bad "unauth api ($C)"
C=$(curl -s -m 15 -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"wrong"}' -o /dev/null -w "%{http_code}")
[[ "$C" == "401" ]] && ok "wrong password 401" || bad "wrong password ($C)"
C=$(curl -s -m 15 -c "$JAR" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"atlas-dev-2026"}' -o /dev/null -w "%{http_code}")
[[ "$C" == "200" ]] && ok "login 200" || bad "login ($C)"

echo "== session hardening =="
rm -f "$TMPD/jar-session"
curl -s -m 10 -c "$TMPD/jar-session" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"atlas-dev-2026"}' -o /dev/null
STOKEN=$(awk '$6=="atlas_session"{print $7}' "$TMPD/jar-session")
[[ ${#STOKEN} -eq 43 ]] && ok "login issues opaque atlas_session" || bad "login session token (${#STOKEN})"
grep -q 'atlas_uid' "$TMPD/jar-session" && bad "legacy atlas_uid cookie present" || ok "legacy atlas_uid cookie absent"
C=$(curl -s -m 10 -H 'Cookie: atlas_uid=1' -o /dev/null -w "%{http_code}" "$BASE/api/me")
[[ "$C" == "401" ]] && ok "forged atlas_uid rejected" || bad "forged atlas_uid ($C)"
C=$(curl -s -m 10 -H 'Cookie: atlas_uid=999999' -o /dev/null -w "%{http_code}" "$BASE/projects/1")
[[ "$C" == "307" || "$C" == "308" ]] && ok "forged atlas_uid page redirect ($C)" || bad "forged atlas_uid page ($C)"
C=$(curl -s -m 10 -H 'Cookie: atlas_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' -o /dev/null -w "%{http_code}" "$BASE/api/me")
[[ "$C" != "200" ]] && ok "unknown atlas_session rejected ($C)" || bad "unknown atlas_session ($C)"
C=$(curl -s -m 10 -b "$TMPD/jar-session" -X POST "$BASE/api/auth/logout" -o /dev/null -w "%{http_code}")
[[ "$C" == "200" ]] && ok "logout 200" || bad "logout ($C)"
C=$(curl -s -m 10 -H "Cookie: atlas_session=$STOKEN" -o /dev/null -w "%{http_code}" "$BASE/api/me")
[[ "$C" != "200" ]] && ok "logout revokes server session ($C)" || bad "revoked session still accepted ($C)"
SHASH=$(printf %s "$STOKEN" | shasum -a 256 | cut -d' ' -f1)
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM user_sessions WHERE token_hash='$SHASH';")
[[ "$N" == "0" ]] && ok "revoked session row deleted" || bad "revoked session row remains ($N)"
page "/login" "$TMPD/login.html"
curl -s -m 10 -b "$JAR" "$BASE/" -o "$TMPD/home.html"
grep -q 'さん、' "$TMPD/home.html" && grep -q 'マイタスク（担当' "$TMPD/home.html" && grep -q 'プロジェクト' "$TMPD/home.html" && ok "home summary" || bad "home summary"

db_sql -q -c "DELETE FROM project_view_states;"
db_sql -q -c "DELETE FROM search_history;"
# Clean fixtures left by an interrupted prior run so assertions stay deterministic.
db_sql -q -c "DELETE FROM users WHERE email LIKE 'e2e-%@example.com'; DELETE FROM projects WHERE name LIKE 'E2E%'; DELETE FROM project_messages WHERE title LIKE '[自動]%'; DELETE FROM tasks WHERE project_id=1 AND (name LIKE 'E2E%' OR name LIKE 'フォローアップ: E2E%');"
db_sql -q -c "DELETE FROM sections WHERE project_id=1 AND name LIKE 'E2E%';"
echo "== pages =="
page "/" "$TMPD/home.html"
page "/my-tasks" "$TMPD/mt.html"
page "/inbox" "$TMPD/ib.html"
page "/portfolio" "$TMPD/pf.html"
page "/search?q=%E3%83%AA%E3%82%B9%E3%83%88" "$TMPD/s.html"
for v in overview dashboard list board timeline calendar messages knowledge files forms; do
  page "/projects/1?view=$v" "$TMPD/p-$v.html"
done
page "/projects/1?view=list&task=2" "$TMPD/pane.html"
H=$(curl -s -m 10 -D - -o /dev/null -b "$JAR" "$BASE/projects/1?view=list")
echo "$H" | grep -qi 'content-security-policy:.*nonce-' && echo "$H" | grep -qi 'x-content-type-options: nosniff' && ok "security headers" || bad "security headers"
grep -q 'nonce=' "$TMPD/p-list.html" && ok "CSP nonce SSR" || bad "CSP nonce SSR"
grep -q 'data-project-customize' "$TMPD/p-list.html" && grep -q 'カスタマイズ' "$TMPD/p-list.html" && ok "customize launcher" || bad "customize launcher"
grep -q 'aria-label="現在のビューを保存"' "$TMPD/p-list.html" && grep -q 'aria-label="テンプレートを選択"' "$TMPD/p-list.html" && grep -q 'aria-label="テンプレートを新規作成"' "$TMPD/p-list.html" && ok "list accessible names" || bad "list accessible names"
grep -q 'lg:hidden' "$TMPD/p-list.html" && grep -q 'fixed inset-0 z-\[80\]' "$TMPD/pane.html" && grep -q 'w-36 shrink-0 border-r' "$TMPD/p-timeline.html" && ok "responsive mobile classes" || bad "responsive mobile classes"
grep -q 'data-list-row="1"' "$TMPD/p-list.html" && grep -q 'aria-label="詳細を閉じる"' "$TMPD/pane.html" && ok "list keyboard rows" || bad "list keyboard rows"
grep -q 'aria-label="タスク詳細"' "$TMPD/pane.html" && grep -q 'aria-modal="true"' "$TMPD/pane.html" && ok "task pane focus trap markup" || bad "task pane focus trap markup"
grep -q 'min-h-\[37px\]' "$TMPD/p-list.html" && grep -q 'minmax(220px,640px)' "$TMPD/p-list.html" && grep -q 'minmax(40px,1fr)' "$TMPD/p-list.html" && ok "list density columns" || bad "list density columns"
HOST=1; for v in list board timeline calendar; do grep -q 'data-task-context-menu-host' "$TMPD/p-$v.html" || HOST=0; done
[[ "$HOST" == "1" ]] && ok "task context menu host" || bad "task context menu host"

echo "== project header =="
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/header.html"
grep -q 'data-project-title="デモプロジェクト"' "$TMPD/header.html" && grep -q 'data-project-status-button' "$TMPD/header.html" && grep -q 'data-project-status-current=""' "$TMPD/header.html" && grep -q 'data-project-star' "$TMPD/header.html" && ok "project header markup" || bad "project header markup"
grep -q 'data-project-members-manage' "$TMPD/header.html" && grep -q 'aria-label="プロジェクトメンバーを管理"' "$TMPD/header.html" && grep -q 'data-project-member-add' "$TMPD/header.html" && grep -q 'aria-label="メンバーを追加"' "$TMPD/header.html" && ok "project member facepile" || bad "project member facepile"
R=$(api PATCH /api/projects/1 '{"name":"E2Eヘッダー名"}')
[[ "$(jget "$R" id)" == "1" ]] && ok "project rename api" || bad "project rename api" "$R"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/header-renamed.html"
grep -q 'data-project-title="E2Eヘッダー名"' "$TMPD/header-renamed.html" && ok "project rename rendered" || bad "project rename rendered"
R=$(api PATCH /api/projects/1 '{"status":"リスクあり","status_color":"yellow"}')
[[ "$(jget "$R" id)" == "1" ]] && ok "project status api" || bad "project status api" "$R"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/header-status.html"
grep -q 'data-project-status-current="リスクあり"' "$TMPD/header-status.html" && grep -q 'aria-label="現在のステータス: リスクあり"' "$TMPD/header-status.html" && ok "project status rendered" || bad "project status rendered"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=overview" -o "$TMPD/header-overview.html"
grep -q 'リスクあり' "$TMPD/header-overview.html" && grep -q 'bg-amber-500' "$TMPD/header-overview.html" && ok "project status overview color" || bad "project status overview color"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/projects/1" -H 'Content-Type: application/json' -d '{"status_color":"purple"}')
[[ "$C" == "400" ]] && ok "project status color validation" || bad "project status color validation ($C)"
R=$(api PATCH /api/projects/1 '{"name":"デモプロジェクト","status":"active","status_color":"none"}')
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/header-restored.html"
grep -q 'data-project-title="デモプロジェクト"' "$TMPD/header-restored.html" && grep -q 'data-project-status-current=""' "$TMPD/header-restored.html" && ok "project header restored" || bad "project header restored"

echo "== board card parity =="
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=board" -o "$TMPD/board-card.html"
grep -q 'data-board-card="2"' "$TMPD/board-card.html" && grep -q 'data-board-assignee="田中 太郎"' "$TMPD/board-card.html" && grep -q 'data-board-due="2026-11-14"' "$TMPD/board-card.html" && grep -q 'data-board-status="進行中"' "$TMPD/board-card.html" && ok "board card metadata" || bad "board card metadata"
grep -q 'data-board-subtask-count="2"' "$TMPD/board-card.html" && grep -q 'data-board-comment-count="1"' "$TMPD/board-card.html" && grep -q 'data-board-subtask-badge' "$TMPD/board-card.html" && grep -q 'data-board-comment-badge' "$TMPD/board-card.html" && ok "board card counts" || bad "board card counts"
grep -q 'data-board-card="2"' "$TMPD/board-card.html" && grep -q 'draggable' "$TMPD/board-card.html" && ok "board drag guard markup" || bad "board drag guard markup"

echo "== list column parity =="
ORDER=$(python3 - "$TMPD/p-list.html" <<'PYEOF'
import sys
h=open(sys.argv[1],encoding='utf-8').read()
keys=["name","assignee","due","progress","status"]
pos=[h.find('data-list-header="'+k+'"') for k in keys]
print("ok" if all(p>=0 for p in pos) and pos==sorted(pos) else "bad:"+",".join(map(str,pos)))
PYEOF
)
[[ "$ORDER" == "ok" ]] && ok "list column order" || bad "list column order" "$ORDER"
grep -Fq 'hover:bg-[#f3f3f3]' "$TMPD/p-list.html" && ok "field header hover style" || bad "field header hover style"
DRAG_FIELD=$(api POST /api/custom-fields '{"project_id":1,"name":"E2E並べ替え列","field_type":"text"}')
DRAG_FIELD_ID=$(jget "$DRAG_FIELD" id)
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/field-drag.html"
HAS_DRAG=$(python3 - "$TMPD/field-drag.html" "$DRAG_FIELD_ID" <<'PYEOF'
import re, sys
h = open(sys.argv[1], encoding='utf-8').read()
print("yes" if sys.argv[2].isdigit() and re.search(r'data-list-header="cf-'+sys.argv[2]+r'"[^>]*draggable="true"', h) else "no")
PYEOF
)
[[ "$HAS_DRAG" == "yes" ]] && ok "field header draggable markup" || bad "field header draggable markup"
api DELETE "/api/custom-fields/$DRAG_FIELD_ID" >/dev/null
grep -q 'minmax(220px,640px)' "$TMPD/p-list.html" && grep -q '119px 119px 119px 119px' "$TMPD/p-list.html" && ok "list column widths (640/119)" || bad "list column widths"
grep -q 'data-list-section-header="' "$TMPD/p-list.html" && ! grep -q 'data-list-section-count' "$TMPD/p-list.html" && ok "section header count hidden" || bad "section header count hidden"
HAS_SECTION_DRAG=$(python3 - "$TMPD/p-list.html" <<'PYEOF'
import re, sys
h = open(sys.argv[1], encoding='utf-8').read()
print("yes" if re.search(r'data-section-drag-handle="\d+"[^>]*draggable="true"', h) else "no")
PYEOF
)
[[ "$HAS_SECTION_DRAG" == "yes" ]] && ok "section drag handle markup" || bad "section drag handle markup"
grep -q 'data-list-section-block=' "$TMPD/p-list.html" && ok "section drop blocks markup" || bad "section drop blocks markup"
grep -q 'data-section-name="' "$TMPD/p-list.html" && grep -q 'data-section-add-task="' "$TMPD/p-list.html" && grep -q 'data-section-menu-button="' "$TMPD/p-list.html" && ok "section header controls markup" || bad "section header controls markup"
EMPTY=$(api POST /api/tasks '{"project_id":1,"section_id":2,"name":"E2E空欄アイコン"}')
EID=$(jget "$EMPTY" id)
page "/projects/1?view=list" "$TMPD/empty-icons.html"
grep -q 'stroke-dasharray="4 2"' "$TMPD/empty-icons.html" && grep -Fq '未割り当て — クリックで編集' "$TMPD/empty-icons.html" && grep -q 'aria-label="期日を設定"' "$TMPD/empty-icons.html" && ok "empty assignee/due icons" || bad "empty assignee/due icons"
R=$(purge_task "$EID")
[[ "$(jget "$R" deleted)" == "$EID" ]] && ok "empty icon fixture cleaned" || bad "empty icon fixture cleaned" "$R"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list&group=assignee" -o "$TMPD/group-count.html"
grep -q 'data-list-section-count=' "$TMPD/group-count.html" && ok "group header counts" || bad "group header counts"
grep -q 'data-list-filter-open' "$TMPD/p-list.html" && grep -q 'フィルター' "$TMPD/p-list.html" && grep -q 'data-list-sort-open' "$TMPD/p-list.html" && grep -q 'data-list-group-open' "$TMPD/p-list.html" && grep -q 'data-list-options-open' "$TMPD/p-list.html" && ok "list toolbar parity" || bad "list toolbar parity"
grep -q 'data-list-options-drawer' "$TMPD/p-list.html" && grep -q 'aria-label="ビューの名前"' "$TMPD/p-list.html" && grep -q 'data-list-columns-open' "$TMPD/p-list.html" && grep -q 'data-list-options-subtasks' "$TMPD/p-list.html" && grep -q 'aria-label="ビューのアイコン"' "$TMPD/p-list.html" && grep -q 'aria-label="現在のビューを保存"' "$TMPD/p-list.html" && ok "list options drawer markup" || bad "list options drawer markup"
grep -q 'project-drawer-enter' "$TMPD/p-list.html" && grep -q 'project-drawer-in' app/globals.css && grep -q 'animation-duration: 250ms' app/globals.css && grep -q 'animation-duration: 300ms' app/globals.css && grep -q 'project-drawer-enter-customize' components/ProjectCustomizeButton.tsx && ok "drawer slide animation" || bad "drawer slide animation"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list&completed=done&mine=1&creator=1&created=7&updated=30&completed_on=today&start=7" -o "$TMPD/list-filters.html"
grep -q 'data-list-completed-only="true"' "$TMPD/list-filters.html" && grep -q 'data-list-mine-only="true"' "$TMPD/list-filters.html" && grep -q 'data-list-creator="1"' "$TMPD/list-filters.html" && grep -q 'data-list-created="7"' "$TMPD/list-filters.html" && grep -q 'data-list-updated="30"' "$TMPD/list-filters.html" && grep -q 'data-list-completed-on="today"' "$TMPD/list-filters.html" && grep -q 'data-list-start="7"' "$TMPD/list-filters.html" && ok "list extended filters" || bad "list extended filters"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list&sort=assignee&sortdir=desc&group=creator" -o "$TMPD/list-sort-group.html"
grep -q 'data-list-sort="assignee"' "$TMPD/list-sort-group.html" && grep -q 'data-list-sortdir="desc"' "$TMPD/list-sort-group.html" && grep -q 'data-list-group="creator"' "$TMPD/list-sort-group.html" && grep -q 'data-list-section-count=' "$TMPD/list-sort-group.html" && ok "list extended sort/group" || bad "list extended sort/group"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list&sort=likes&sortdir=desc&group=assignee&group2=status&groupdir=desc&subtasks=collapsed" -o "$TMPD/list-group2.html"
grep -q 'data-list-sort="likes"' "$TMPD/list-group2.html" && grep -q 'data-list-group="assignee"' "$TMPD/list-group2.html" && grep -q 'data-list-group2="status"' "$TMPD/list-group2.html" && grep -q 'data-list-groupdir="desc"' "$TMPD/list-group2.html" && grep -q 'data-list-subtasks-collapsed="true"' "$TMPD/list-group2.html" && grep -q 'data-list-subgroup="' "$TMPD/list-group2.html" && ok "list subgroup/custom sort" || bad "list subgroup/custom sort"
SV2=$(api POST /api/saved-views '{"project_id":1,"name":"E2Eツールバー","filters":{"completed_only":true,"creator":"1","created":"30","group2":"status","groupdir":"desc","subtasks_collapsed":true},"sort_key":"assignee","group_by":"creator"}')
SVID2=$(jget "$SV2" id)
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list&saved=$SVID2" -o "$TMPD/list-saved-toolbar.html"
grep -q 'data-list-completed-only="true"' "$TMPD/list-saved-toolbar.html" && grep -q 'data-list-creator="1"' "$TMPD/list-saved-toolbar.html" && grep -q 'data-list-created="30"' "$TMPD/list-saved-toolbar.html" && grep -q 'data-list-sort="assignee"' "$TMPD/list-saved-toolbar.html" && grep -q 'data-list-group="creator"' "$TMPD/list-saved-toolbar.html" && grep -q 'data-list-group2="status"' "$TMPD/list-saved-toolbar.html" && grep -q 'data-list-groupdir="desc"' "$TMPD/list-saved-toolbar.html" && grep -q 'data-list-subtasks-collapsed="true"' "$TMPD/list-saved-toolbar.html" && ok "saved view toolbar filters" || bad "saved view toolbar filters"
api DELETE "/api/saved-views/$SVID2" >/dev/null
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d '{"project_id":1,"section_id":2,"name":"   "}')
[[ "$C" == "400" ]] && ok "empty task name rejected" || bad "empty task name rejected ($C)"
grep -q 'bg-\[#c94848\]' "$TMPD/p-list.html" && ok "contrast tokens" || bad "contrast tokens"
grep -q 'focus-visible' app/globals.css && grep -q 'box-shadow: 0 0 0 4px #2c60b8' app/globals.css && ok "global focus-visible styles" || bad "global focus-visible styles"

echo "== sidebar rail =="
curl -s -m 15 -b "$JAR" -b 'atlas_sidebar=collapsed' "$BASE/projects/1?view=list" -o "$TMPD/rail.html"
grep -q 'data-sidebar-rail' "$TMPD/rail.html" && grep -q 'data-sidebar-flyout="/my-tasks"' "$TMPD/rail.html" && grep -q 'data-sidebar-flyout-link="期限超過"' "$TMPD/rail.html" && grep -q 'data-sidebar-rail-footer' "$TMPD/rail.html" && ! grep -q 'data-sidebar-navigation' "$TMPD/rail.html" && ok "sidebar collapsed flyout markup" || bad "sidebar collapsed flyout markup"

echo "== project tabs =="
TABS=$(api GET '/api/project-tabs?project_id=1')
NT=$(echo "$TABS" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
[[ "$NT" == "10" ]] && ok "project tabs seeded" || bad "project tabs seeded ($NT)"
ORIG_IDS=$(echo "$TABS" | python3 -c "import json,sys; print(','.join(str(x['id']) for x in json.load(sys.stdin)))")
CT=$(api POST /api/project-tabs '{"project_id":1,"name":"E2Eカスタム","view_type":"board"}')
CTID=$(jget "$CT" id)
CTKEY=$(jget "$CT" tab_key)
[[ -n "$CTID" && -n "$CTKEY" ]] && ok "custom tab create ($CTID)" || bad "custom tab create" "$CT"
CTENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$CTKEY")
page "/projects/1?view=board&tab=$CTENC" "$TMPD/ptab.html"
grep -q 'E2Eカスタム' "$TMPD/ptab.html" && ok "custom tab visible" || bad "custom tab visible"
NEW_IDS="$CTID,$ORIG_IDS"
R=$(api POST /api/project-tabs/reorder "{\"project_id\":1,\"ids\":[$NEW_IDS]}")
[[ "$R" == *ok* ]] && ok "tab reorder" || bad "tab reorder" "$R"
FIRST=$(api GET '/api/project-tabs?project_id=1' | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['name'])")
[[ "$FIRST" == "E2Eカスタム" ]] && ok "tab order persisted" || bad "tab order persisted ($FIRST)"
R=$(api POST /api/project-tabs/reorder "{\"project_id\":1,\"ids\":[$ORIG_IDS]}")
[[ "$R" == *ok* ]] && ok "tab order restored" || bad "tab order restore" "$R"
R=$(api DELETE /api/project-tabs/$CTID)
[[ "$(jget "$R" deleted)" == "$CTID" ]] && ok "custom tab delete" || bad "custom tab delete" "$R"
NT=$(api GET '/api/project-tabs?project_id=1' | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
[[ "$NT" == "10" ]] && ok "custom tab cleaned" || bad "custom tab cleaned ($NT)"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/tabbar.html"
grep -q 'data-project-tabs' "$TMPD/tabbar.html" && grep -q 'data-project-tab="builtin:list"' "$TMPD/tabbar.html" && grep -q 'aria-current="page"' "$TMPD/tabbar.html" && grep -q 'data-project-tab-add' "$TMPD/tabbar.html" && grep -q 'aria-label="タブを追加"' "$TMPD/tabbar.html" && ok "project tab bar markup" || bad "project tab bar markup"
RID=$(echo "$TABS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(next(x['id'] for x in d if x['tab_key']=='builtin:overview'))")
R=$(api PATCH "/api/project-tabs/$RID" '{"name":"E2E概要"}')
[[ "$(jget "$R" id)" == "$RID" ]] && ok "built-in tab rename api" || bad "built-in tab rename api" "$R"
RN=$(api GET '/api/project-tabs?project_id=1' | python3 -c "import json,sys; d=json.load(sys.stdin); print(next(x['name'] for x in d if x['id']==$RID))")
[[ "$RN" == "E2E概要" ]] && ok "built-in tab rename persisted" || bad "built-in tab rename persisted ($RN)"
api PATCH "/api/project-tabs/$RID" '{"name":"概要"}' >/dev/null
FT=$(api POST /api/project-tabs '{"project_id":1,"name":"E2Eフォームタブ","view_type":"forms"}')
FTID=$(jget "$FT" id)
[[ -n "$FTID" ]] && ok "forms tab create" || bad "forms tab create" "$FT"
api DELETE "/api/project-tabs/$FTID" >/dev/null
LTID=$(echo "$TABS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(next(x['id'] for x in d if x['tab_key']=='builtin:list'))")
R=$(api PATCH "/api/project-tabs/$LTID" '{"icon":"🚀"}')
[[ "$(jget "$R" icon)" == "🚀" ]] && ok "view icon update api" || bad "view icon update api" "$R"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/tab-icon.html"
grep -q '🚀' "$TMPD/tab-icon.html" && ok "view icon rendered" || bad "view icon rendered"
api PATCH "/api/project-tabs/$LTID" '{"icon":null}' >/dev/null
db_sql -q -c "DELETE FROM task_likes WHERE task_id=2 AND user_id=1;"
LK=$(api POST /api/tasks/2/like)
echo "$LK" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['count']==1 and d['liked'] is True, d" && ok "task like toggle on" || bad "task like toggle on" "$LK"
LK=$(api GET /api/tasks/2/like)
echo "$LK" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['count']==1 and d['liked'] is True, d" && ok "task like state" || bad "task like state" "$LK"
LK=$(api POST /api/tasks/2/like)
echo "$LK" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['count']==0 and d['liked'] is False, d" && ok "task like toggle off" || bad "task like toggle off" "$LK"
api PUT /api/view-state '{"project_id":1,"view":"tabs","state":{"default":"builtin:board"}}' >/dev/null
curl -s -m 10 -b "$JAR" "$BASE/projects/1" -o "$TMPD/tab-default-redirect.html"
grep -q 'NEXT_REDIRECT;replace;/projects/1?view=board' "$TMPD/tab-default-redirect.html" && ok "default tab redirect" || bad "default tab redirect"
grep -q 'tab=builtin%3Aboard' "$TMPD/tab-default-redirect.html" && ok "default tab redirect target" || bad "default tab redirect target"
api PUT /api/view-state '{"project_id":1,"view":"tabs","state":{}}' >/dev/null
page "/projects/1?view=board&hide=1&sort=name&assignee=none" "$TMPD/p-board-filter.html"
grep -q 'data-board-filter' "$TMPD/p-board-filter.html" && grep -q 'data-board-sort' "$TMPD/p-board-filter.html" && grep -q 'data-board-options' "$TMPD/p-board-filter.html" && grep -q 'data-board-filter-open' "$TMPD/p-board-filter.html" && grep -q 'data-board-sort-open' "$TMPD/p-board-filter.html" && grep -q 'data-board-options-open' "$TMPD/p-board-filter.html" && grep -q 'data-view-options-drawer="ボード"' "$TMPD/p-board-filter.html" && ok "board toolbar" || bad "board toolbar"

echo "== tasks CRUD =="
T=$(api POST /api/tasks '{"project_id":1,"section_id":3,"name":"E2E回帰タスク"}')
TID=$(jget "$T" id)
[[ -n "$TID" ]] && ok "task create ($TID)" || bad "task create" "$T"
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM tasks WHERE id=$TID AND created_by=1;")
[[ "$N" == "1" ]] && ok "task creator recorded" || bad "task creator ($N)"
R=$(api PATCH /api/tasks/$TID '{"completed":true,"progress":100}')
[[ "$(jget "$R" id)" == "$TID" ]] && ok "task patch" || bad "task patch" "$R"
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM tasks WHERE id=$TID AND completed_at IS NOT NULL;")
[[ "$N" == "1" ]] && ok "completed_at recorded" || bad "completed_at ($N)"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/l.html"
grep -q 'E2E回帰タスク' "$TMPD/l.html" && ok "task visible" || bad "task visible"
R=$(purge_task "$TID")
[[ "$(jget "$R" deleted)" == "$TID" ]] && ok "task delete" || bad "task delete" "$R"

echo "== task context menu =="
CM=$(api POST /api/tasks '{"project_id":1,"section_id":2,"name":"E2E右クリック元"}')
CMID=$(jget "$CM" id)
[[ -n "$CMID" ]] && ok "context task create ($CMID)" || bad "context task create" "$CM"
DU=$(api POST /api/tasks/$CMID/duplicate)
DUID=$(jget "$DU" id)
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM tasks WHERE id=$DUID AND name='E2E右クリック元' AND parent_task_id IS NULL AND section_id=2;")
[[ "$N" == "1" ]] && ok "task duplicate" || bad "task duplicate" "$DU"
FU=$(api POST /api/tasks/$CMID/follow-up)
FUID=$(jget "$FU" id)
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM tasks WHERE id=$FUID AND name='フォローアップ: E2E右クリック元' AND completed=false;")
[[ "$N" == "1" ]] && ok "task follow-up" || bad "task follow-up" "$FU"
C=$(curl -s -m 10 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tasks/$CMID/duplicate")
[[ "$C" == "401" ]] && ok "task duplicate auth" || bad "task duplicate auth ($C)"
C=$(curl -s -m 10 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tasks/$CMID/follow-up")
[[ "$C" == "401" ]] && ok "task follow-up auth" || bad "task follow-up auth ($C)"
purge_task "$DUID" >/dev/null
purge_task "$FUID" >/dev/null
purge_task "$CMID" >/dev/null
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM tasks WHERE id IN ($CMID,$DUID,$FUID) AND deleted_at IS NULL;")
[[ "$N" == "0" ]] && ok "task context menu cleanup" || bad "task context menu cleanup ($N)"

echo "== milestones =="
MT=$(api POST /api/tasks '{"project_id":1,"section_id":2,"name":"E2Eマイルストーン","due_on":"2026-11-20","is_milestone":true}')
MTID=$(jget "$MT" id)
[[ -n "$MTID" ]] && ok "milestone create ($MTID)" || bad "milestone create" "$MT"
D=$(db_sql -t -A -c "SELECT is_milestone::text||'/'||COALESCE(parent_task_id::text,'') FROM tasks WHERE id=$MTID;")
[[ "$D" == "true/" ]] && ok "milestone stored" || bad "milestone stored ($D)"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d '{"project_id":1,"name":"E2E文字列マイルストーン","is_milestone":"true"}')
[[ "$C" == "400" ]] && ok "milestone create validation" || bad "milestone create validation ($C)"
R=$(api PATCH /api/tasks/$MTID '{"is_milestone":false,"parent_task_id":null}')
D=$(db_sql -t -A -c "SELECT is_milestone::text FROM tasks WHERE id=$MTID;")
[[ "$(jget "$R" id)" == "$MTID" && "$D" == "false" ]] && ok "milestone revert" || bad "milestone revert" "$R/$D"
R=$(api PATCH /api/tasks/$MTID '{"is_milestone":true}')
D=$(db_sql -t -A -c "SELECT is_milestone::text||'/'||COALESCE(parent_task_id::text,'') FROM tasks WHERE id=$MTID;")
[[ "$(jget "$R" id)" == "$MTID" && "$D" == "true/" ]] && ok "milestone convert" || bad "milestone convert" "$R/$D"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/milestone.html"
grep -q 'E2Eマイルストーン' "$TMPD/milestone.html" && grep -q 'data-task-milestone' "$TMPD/milestone.html" && ok "milestone list marker" || bad "milestone list marker"
SD=$(api POST /api/tasks '{"project_id":1,"section_id":2,"name":"E2E同日タイムラインタスク","start_on":"2026-11-21","due_on":"2026-11-21"}')
SDID=$(jget "$SD" id)
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=timeline&from=2026-11-01" -o "$TMPD/milestone-timeline.html"
grep -q "data-timeline-milestone-line=\"$MTID\"" "$TMPD/milestone-timeline.html" && grep -Fq 'bg-[#46a75a] opacity-20' "$TMPD/milestone-timeline.html" && ok "milestone timeline line" || bad "milestone timeline line"
N=$(python3 - "$TMPD/milestone-timeline.html" "$MTID" "$SDID" <<'PY'
import re, sys
html = open(sys.argv[1], encoding="utf-8").read()
for task_id in sys.argv[2:]:
    match = re.search(r'data-timeline-bar="%s"[^>]*style="([^"]*)"' % task_id, html)
    if not match or "width:8px" not in match.group(1):
        print("fail")
        raise SystemExit
print("ok")
PY
)
[[ "$N" == "ok" ]] && ok "timeline single-day collapsed" || bad "timeline single-day collapsed ($N)"
DESC=$(api GET /api/projects/1/automation/descriptors)
N=$(python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(int(any(f['id']=='task.is_milestone' and any(o['value']=='true' for o in f.get('options',[])) for f in d['conditionFields'])), int(any(t['id']=='task.milestone_changed' for t in d['triggers'])))" <<<"$DESC")
[[ "$N" == "1 1" ]] && ok "milestone rule descriptors" || bad "milestone rule descriptors ($N)"
RULE=$(api POST /api/projects/1/rules '{"name":"E2Eマイルストーン条件","definition":{"version":1,"triggers":[{"event":"task.manual_rule"}],"conditions":[{"field":"task.is_milestone","op":"eq","value":"true"}],"actions":[{"capability":"task.add_comment","params":{"body":"E2Eマイルストーン一致"}}]}}')
RID=$(jget "$RULE" id)
[[ -n "$RID" ]] && ok "milestone rule create ($RID)" || bad "milestone rule create" "$RULE"
api POST /api/projects/1/rules/$RID/run "{\"task_id\":$MTID}" >/dev/null
sleep 1
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM comments WHERE task_id=$MTID AND body='E2Eマイルストーン一致';")
[[ "$N" == "1" ]] && ok "milestone rule condition matches" || bad "milestone rule condition matches ($N)"
NT=$(api POST /api/tasks '{"project_id":1,"section_id":2,"name":"E2E通常タスク"}')
NTID=$(jget "$NT" id)
api POST /api/projects/1/rules/$RID/run "{\"task_id\":$NTID}" >/dev/null
sleep 1
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM comments WHERE task_id=$NTID AND body='E2Eマイルストーン一致';")
[[ "$N" == "0" ]] && ok "milestone rule condition skips task" || bad "milestone rule condition skips task ($N)"
TRIG=$(api POST /api/projects/1/rules '{"name":"E2Eマイルストーン変換トリガー","definition":{"version":1,"triggers":[{"event":"task.milestone_changed"}],"actions":[{"capability":"task.add_comment","params":{"body":"E2Eマイルストーン変換イベント"}}]}}')
TRID=$(jget "$TRIG" id)
[[ -n "$TRID" ]] && ok "milestone trigger rule create ($TRID)" || bad "milestone trigger rule create" "$TRIG"
api PATCH /api/tasks/$MTID '{"is_milestone":false}' >/dev/null
curl -s -m 10 -X POST "$BASE/api/automation/process?limit=20" -H "x-automation-token: $ATLAS_E2E_WORKER_TOKEN" -o /dev/null
sleep 1
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM comments WHERE task_id=$MTID AND body='E2Eマイルストーン変換イベント';")
[[ "$N" == "1" ]] && ok "milestone trigger fires" || bad "milestone trigger fires ($N)"
api DELETE /api/projects/1/rules/$RID >/dev/null
api DELETE /api/projects/1/rules/$TRID >/dev/null
purge_task "$MTID" >/dev/null
purge_task "$NTID" >/dev/null
purge_task "$SDID" >/dev/null
db_sql -q -c "DELETE FROM rule_runs WHERE rule_name IN ('E2Eマイルストーン条件','E2Eマイルストーン変換トリガー'); DELETE FROM domain_events WHERE subject_type='task' AND subject_id IN ($MTID,$NTID,$SDID);"
N=$(db_sql -t -A -c "SELECT (SELECT COUNT(*) FROM project_rules WHERE id IN ($RID,$TRID))||'/'||(SELECT COUNT(*) FROM tasks WHERE id IN ($MTID,$NTID,$SDID))||'/'||(SELECT COUNT(*) FROM rule_runs WHERE rule_name IN ('E2Eマイルストーン条件','E2Eマイルストーン変換トリガー'));")
[[ "$N" == "0/0/0" ]] && ok "milestone cleanup" || bad "milestone cleanup ($N)"

echo "== timeline lanes =="
LS=$(api POST /api/sections '{"project_id":1,"name":"E2Eレーン"}')
LSID=$(jget "$LS" id)
[[ -n "$LSID" ]] && ok "lane section create ($LSID)" || bad "lane section create" "$LS"
LA=$(api POST /api/tasks "{\"project_id\":1,\"section_id\":$LSID,\"name\":\"A\",\"start_on\":\"2026-11-10\",\"due_on\":\"2026-11-11\"}")
LAID=$(jget "$LA" id)
LB=$(api POST /api/tasks "{\"project_id\":1,\"section_id\":$LSID,\"name\":\"B\",\"start_on\":\"2026-11-13\",\"due_on\":\"2026-11-14\"}")
LBID=$(jget "$LB" id)
LC=$(api POST /api/tasks "{\"project_id\":1,\"section_id\":$LSID,\"name\":\"C\",\"start_on\":\"2026-11-10\",\"due_on\":\"2026-11-11\"}")
LCID=$(jget "$LC" id)
LM=$(api POST /api/tasks "{\"project_id\":1,\"section_id\":$LSID,\"name\":\"M\",\"due_on\":\"2026-11-16\",\"is_milestone\":true}")
LMID=$(jget "$LM" id)
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=timeline&from=2026-11-01" -o "$TMPD/lanes.html"
N=$(python3 - "$TMPD/lanes.html" "$LAID" "$LBID" "$LCID" "$LMID" <<'PY'
import re, sys
html = open(sys.argv[1], encoding="utf-8").read()
lanes = []
for task_id in sys.argv[2:]:
    match = re.search(r'data-timeline-bar="%s"[^>]*data-timeline-lane="(\d+)"' % task_id, html)
    lanes.append(match.group(1) if match else "?")
print(" ".join(lanes))
PY
)
[[ "$N" == "0 0 1 0" ]] && ok "timeline lane packing" || bad "timeline lane packing ($N)"
grep -q "data-timeline-lane-spacer=\"$LSID-0\"" "$TMPD/lanes.html" && ok "timeline lane spacer" || bad "timeline lane spacer"
purge_task "$LAID" >/dev/null
purge_task "$LBID" >/dev/null
purge_task "$LCID" >/dev/null
purge_task "$LMID" >/dev/null
api DELETE /api/sections/$LSID >/dev/null
N=$(db_sql -t -A -c "SELECT (SELECT COUNT(*) FROM sections WHERE id=$LSID)||'/'||(SELECT COUNT(*) FROM tasks WHERE id IN ($LAID,$LBID,$LCID,$LMID));")
[[ "$N" == "0/0" ]] && ok "timeline lane cleanup" || bad "timeline lane cleanup ($N)"

echo "== timeline manual rows =="
RS=$(api POST /api/sections '{"project_id":1,"name":"E2E行固定"}')
RSID=$(jget "$RS" id)
RT=$(api POST /api/tasks "{\"project_id\":1,\"section_id\":$RSID,\"name\":\"E2E行固定タスク\",\"start_on\":\"2026-11-10\",\"due_on\":\"2026-11-11\"}")
RTID=$(jget "$RT" id)
R=$(api PUT /api/tasks/$RTID/timeline-row "{\"project_id\":1,\"row_index\":2}")
[[ "$(jget "$R" row_index)" == "2" ]] && ok "timeline row pin" || bad "timeline row pin" "$R"
D=$(db_sql -t -A -c "SELECT row_index FROM task_timeline_rows WHERE task_id=$RTID AND project_id=1;")
[[ "$D" == "2" ]] && ok "timeline row stored" || bad "timeline row stored ($D)"
C=$(curl -s -m 10 -o /dev/null -w "%{http_code}" -X PUT "$BASE/api/tasks/$RTID/timeline-row" -H 'Content-Type: application/json' -d "{\"project_id\":1,\"row_index\":1}")
[[ "$C" == "401" ]] && ok "timeline row auth" || bad "timeline row auth ($C)"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X PUT "$BASE/api/tasks/$RTID/timeline-row" -H 'Content-Type: application/json' -d "{\"project_id\":1,\"row_index\":999}")
[[ "$C" == "400" ]] && ok "timeline row validation" || bad "timeline row validation ($C)"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X PUT "$BASE/api/tasks/$RTID/timeline-row" -H 'Content-Type: application/json' -d "{\"project_id\":1,\"row_index\":3,\"expected_updated_at\":\"2000-01-01T00:00:00Z\"}")
[[ "$C" == "409" ]] && ok "timeline row optimistic lock" || bad "timeline row optimistic lock ($C)"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=timeline&from=2026-11-01" -o "$TMPD/rowpin.html"
N=$(python3 - "$TMPD/rowpin.html" "$RTID" <<'PY'
import re, sys
html = open(sys.argv[1], encoding="utf-8").read()
match = re.search(
    r'data-timeline-bar="%s"[^>]*data-timeline-lane="(\d+)"[^>]*data-timeline-row-locked="true"' % sys.argv[2],
    html,
)
print(match.group(1) if match else "?")
PY
)
[[ "$N" == "2" ]] && ok "timeline row pinned render" || bad "timeline row pinned render ($N)"
grep -q "data-timeline-lane-spacer=\"$RSID-0\"" "$TMPD/rowpin.html" && grep -q "data-timeline-lane-spacer=\"$RSID-1\"" "$TMPD/rowpin.html" && ok "timeline row empty lane spacers" || bad "timeline row empty lane spacers"
R=$(api PUT /api/tasks/$RTID/timeline-row "{\"project_id\":1,\"row_index\":null}")
D=$(db_sql -t -A -c "SELECT COUNT(*) FROM task_timeline_rows WHERE task_id=$RTID AND project_id=1;")
[[ "$D" == "0" ]] && ok "timeline row auto reset" || bad "timeline row auto reset" "$R/$D"
api PUT /api/tasks/$RTID/timeline-row "{\"project_id\":1,\"row_index\":2}" >/dev/null
api PATCH /api/tasks/$RTID '{"section_id":2}' >/dev/null
D=$(db_sql -t -A -c "SELECT COUNT(*) FROM task_timeline_rows WHERE task_id=$RTID AND project_id=1;")
[[ "$D" == "0" ]] && ok "timeline row cleared on section move" || bad "timeline row cleared on section move ($D)"
api PATCH /api/tasks/$RTID "{\"section_id\":$RSID}" >/dev/null
api PUT /api/tasks/$RTID/timeline-row "{\"project_id\":1,\"row_index\":2}" >/dev/null
R=$(api DELETE /api/projects/1/timeline-rows "{\"section_id\":$RSID}")
D=$(db_sql -t -A -c "SELECT COUNT(*) FROM task_timeline_rows WHERE task_id=$RTID AND project_id=1;")
[[ "$(jget "$R" deleted)" == "1" && "$D" == "0" ]] && ok "timeline section row reset" || bad "timeline section row reset" "$R/$D"
purge_task "$RTID" >/dev/null
api DELETE /api/sections/$RSID >/dev/null
N=$(db_sql -t -A -c "SELECT (SELECT COUNT(*) FROM sections WHERE id=$RSID)||'/'||(SELECT COUNT(*) FROM tasks WHERE id=$RTID)||'/'||(SELECT COUNT(*) FROM task_timeline_rows WHERE task_id=$RTID);")
[[ "$N" == "0/0/0" ]] && ok "timeline row cleanup" || bad "timeline row cleanup ($N)"

echo "== sections =="
S=$(api POST /api/sections '{"project_id":1,"name":"E2E区画"}')
SID=$(jget "$S" id)
[[ -n "$SID" ]] && ok "section create ($SID)" || bad "section create" "$S"
R=$(api PATCH /api/sections/$SID '{"name":"E2E区画改"}')
[[ "$(jget "$R" name)" == "E2E区画改" ]] && ok "section rename" || bad "section rename" "$R"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/sections/$SID" -H 'Content-Type: application/json' -d '{"name":"   "}')
[[ "$C" == "400" ]] && ok "section rename validation" || bad "section rename validation ($C)"
R=$(api DELETE /api/sections/$SID)
[[ "$(jget "$R" deleted)" == "$SID" ]] && ok "section delete" || bad "section delete" "$R"
ORIG=$(db_sql -t -A -c "SELECT string_agg(id::text, ',' ORDER BY position, id) FROM sections WHERE project_id=1;")
REV=$(python3 -c "print(','.join(reversed('$ORIG'.split(','))))")
R=$(api POST /api/sections/reorder "{\"project_id\":1,\"ids\":[$REV]}")
N=$(db_sql -t -A -c "SELECT string_agg(id::text, ',' ORDER BY position, id) FROM sections WHERE project_id=1;")
[[ "$N" == "$REV" ]] && ok "section reorder" || bad "section reorder ($N)"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/sections/reorder" -H 'Content-Type: application/json' -d '{"project_id":1,"ids":[1]}')
[[ "$C" == "400" ]] && ok "section reorder validation" || bad "section reorder validation ($C)"
api POST /api/sections/reorder "{\"project_id\":1,\"ids\":[$ORIG]}" >/dev/null
N=$(db_sql -t -A -c "SELECT string_agg(id::text, ',' ORDER BY position, id) FROM sections WHERE project_id=1;")
[[ "$N" == "$ORIG" ]] && ok "section order restored" || bad "section order restored ($N)"

echo "== subtasks/comments/dependencies =="
ST=$(api POST /api/tasks '{"project_id":1,"section_id":2,"parent_task_id":2,"name":"E2Eサブ"}')
STID=$(jget "$ST" id)
[[ -n "$STID" ]] && ok "subtask create" || bad "subtask create" "$ST"
C=$(api POST /api/comments '{"task_id":2,"body":"E2Eコメント @田中 太郎"}')
CID=$(jget "$C" id)
[[ -n "$CID" ]] && ok "comment create ($CID)" || bad "comment create" "$C"
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM comment_mentions WHERE comment_id=$CID AND user_id=2;")
[[ "$N" == "1" ]] && ok "comment mention stored" || bad "comment mention stored ($N)"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list&task=2" -o "$TMPD/comment-pane.html"
grep -q "data-comment-id=\"$CID\"" "$TMPD/comment-pane.html" && grep -q 'data-comment-mention="田中 太郎"' "$TMPD/comment-pane.html" && grep -q "data-comment-edit=\"$CID\"" "$TMPD/comment-pane.html" && grep -q "data-comment-delete=\"$CID\"" "$TMPD/comment-pane.html" && ok "comment mention/edit markup" || bad "comment mention/edit markup"
grep -q 'data-task-description' "$TMPD/comment-pane.html" && grep -q 'data-task-composer' "$TMPD/comment-pane.html" && grep -q 'atlas-rich-text' "$TMPD/comment-pane.html" && ok "task pane description/composer" || bad "task pane description/composer"
grep -q 'data-task-subtasks' "$TMPD/comment-pane.html" && grep -q 'data-task-attachments' "$TMPD/comment-pane.html" && grep -q 'data-task-feed' "$TMPD/comment-pane.html" && ok "task pane sections" || bad "task pane sections"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list&task=3" -o "$TMPD/desc-empty.html"
grep -q 'data-task-description' "$TMPD/desc-empty.html" && grep -q 'このタスクの内容を入力します' "$TMPD/desc-empty.html" && ok "task pane empty description" || bad "task pane empty description"
R=$(api PATCH /api/tasks/3 '{"description_doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"E2Eリッチ","marks":[{"type":"bold"}]}]}]}}')
N=$(db_sql -t -A -c "SELECT description||'|'||(description_doc->'content'->0->'content'->0->'marks'->0->>'type') FROM tasks WHERE id=3;")
[[ "$N" == "**E2Eリッチ**|bold" ]] && ok "rich description stored" || bad "rich description stored ($N)"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/tasks/3" -H 'Content-Type: application/json' -d '{"description_doc":{"type":"doc","content":[{"type":"script"}]}}')
[[ "$C" == "400" ]] && ok "rich description rejects unknown node" || bad "rich description rejects unknown node ($C)"
R=$(api PATCH /api/tasks/3 '{"description_doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"safe","marks":[{"type":"link","attrs":{"href":"javascript:alert(1)"}}]}]}]}}')
N=$(db_sql -t -A -c "SELECT (description_doc::text NOT LIKE '%javascript%')::text FROM tasks WHERE id=3;")
[[ "$N" == "true" ]] && ok "rich description strips unsafe link" || bad "rich description strips unsafe link ($N)"
api PATCH /api/tasks/3 '{"description_doc":{"type":"doc","content":[]}}' >/dev/null
R=$(api POST /api/comments '{"task_id":2,"body_doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"E2Eリッチ","marks":[{"type":"bold"}]},{"type":"text","text":" "},{"type":"mention","attrs":{"id":"2","label":"偽名"}}]}]}}')
RCID=$(jget "$R" id)
N=$(db_sql -t -A -c "SELECT body||'|'||(body_doc->'content'->0->'content'->0->'marks'->0->>'type') FROM comments WHERE id=$RCID;")
[[ "$N" == "**E2Eリッチ** @田中 太郎|bold" ]] && ok "rich comment stored" || bad "rich comment stored ($N)"
N=$(db_sql -t -A -c "SELECT body_doc->'content'->0->'content'->2->'attrs'->>'label' FROM comments WHERE id=$RCID;")
[[ "$N" == "田中 太郎" ]] && ok "rich mention label normalized" || bad "rich mention label normalized ($N)"
N=$(db_sql -t -A -c "SELECT user_id FROM comment_mentions WHERE comment_id=$RCID;")
[[ "$N" == "2" ]] && ok "rich comment mention stored" || bad "rich comment mention stored ($N)"
R=$(api PATCH /api/comments/$RCID '{"body_doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"E2E編集","marks":[{"type":"italic"}]}]}]}}')
N=$(db_sql -t -A -c "SELECT body||'|'||(body_doc->'content'->0->'content'->0->'marks'->0->>'type') FROM comments WHERE id=$RCID;")
[[ "$N" == "*E2E編集*|italic" ]] && ok "rich comment edit" || bad "rich comment edit ($N)"
api DELETE /api/comments/$RCID >/dev/null
curl -s -m 10 -b "$JAR" "$BASE/projects/1?view=list&task=2" -o "$TMPD/rich-pane.html"
grep -q 'atlas-rich-text' "$TMPD/rich-pane.html" && grep -q 'data-comment-mention="田中 太郎"' "$TMPD/rich-pane.html" && ok "rich text SSR" || bad "rich text SSR"
R=$(api PATCH /api/comments/$CID '{"body":"E2Eコメント編集済み @佐藤 花子"}')
[[ -n "$(jget "$R" edited_at)" ]] && ok "comment edit" || bad "comment edit" "$R"
N=$(db_sql -t -A -c "SELECT body||'|'||(edited_at IS NOT NULL)::text FROM comments WHERE id=$CID;")
[[ "$N" == "E2Eコメント編集済み @佐藤 花子|true" ]] && ok "comment edit persisted" || bad "comment edit persisted ($N)"
N=$(db_sql -t -A -c "SELECT string_agg(user_id::text, ',' ORDER BY user_id) FROM comment_mentions WHERE comment_id=$CID;")
[[ "$N" == "3" ]] && ok "comment mentions replaced" || bad "comment mentions replaced ($N)"
JARC="$TMPD/jar-comment-user"
curl -s -m 10 -c "$JARC" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"tanaka@example.com","password":"atlas-dev-2026"}' -o /dev/null
C=$(curl -s -m 10 -b "$JARC" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/comments/$CID" -H 'Content-Type: application/json' -d '{"body":"他人による編集"}')
[[ "$C" == "403" ]] && ok "comment edit author-only" || bad "comment edit author-only ($C)"
R=$(api DELETE /api/comments/$CID)
[[ "$(jget "$R" deleted)" == "$CID" ]] && ok "comment delete" || bad "comment delete" "$R"
N=$(db_sql -t -A -c "SELECT (SELECT COUNT(*) FROM comments WHERE id=$CID)||'/'||(SELECT COUNT(*) FROM comment_mentions WHERE comment_id=$CID);")
[[ "$N" == "0/0" ]] && ok "comment delete cascade" || bad "comment delete cascade ($N)"
D=$(api POST /api/dependencies '{"task_id":3,"depends_on_id":2}')
[[ "$D" == *ok* ]] && ok "dependency add" || bad "dependency add" "$D"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/dependencies" -H 'Content-Type: application/json' -d '{"task_id":2,"depends_on_id":3}')
[[ "$C" == "409" ]] && ok "dependency cycle guard" || bad "dependency cycle guard ($C)"
api DELETE "/api/dependencies?task_id=3&depends_on_id=2" >/dev/null
D=$(api POST /api/dependencies '{"task_id":2,"depends_on_id":3}')
[[ "$D" == *ok* ]] && ok "dependency reverse direction" || bad "dependency reverse direction" "$D"
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM task_dependencies WHERE task_id=2 AND depends_on_id=3;")
[[ "$N" == "1" ]] && ok "dependency reverse db" || bad "dependency reverse db ($N)"
api DELETE "/api/dependencies?task_id=2&depends_on_id=3" >/dev/null
purge_task "$STID" >/dev/null
db_sql -t -c "DELETE FROM comments WHERE id = $CID;" >/dev/null
echo "subtask/dependency/comment cleaned"

echo "== list subtask expand =="
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/list-expand.html"
[[ "$(grep -c 'サブタスクを開く' "$TMPD/list-expand.html")" == "1" ]] && ok "expand chevron (seed task 2)" || bad "expand chevron"
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM tasks WHERE parent_task_id=2 AND deleted_at IS NULL;")
[[ "$N" == "2" ]] && ok "seed subtask rows (2)" || bad "seed subtask rows ($N)"

echo "== list header sort/due filter =="
HD1=$(python3 -c "import datetime; print((datetime.date.today()-datetime.timedelta(days=3)).isoformat())")
HD0=$(python3 -c "import datetime; print(datetime.date.today().isoformat())")
HA=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d '{"project_id":1,"section_id":3,"name":"E2E過去見出し"}')
HA1=$(echo "$HA" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
HB=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d '{"project_id":1,"section_id":3,"name":"E2E今日見出し"}')
HB1=$(echo "$HB" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/$HA1" -H 'Content-Type: application/json' -d "{\"due_on\":\"$HD1\"}" -o /dev/null
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/$HB1" -H 'Content-Type: application/json' -d "{\"due_on\":\"$HD0\"}" -o /dev/null
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list&due=overdue" -o "$TMPD/hd-od.html"
grep -q '>E2E過去見出し<' "$TMPD/hd-od.html" && ! grep -q '>E2E今日見出し<' "$TMPD/hd-od.html" && ok "header due filter overdue" || bad "header due filter overdue"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list&due=today" -o "$TMPD/hd-td.html"
grep -q '>E2E今日見出し<' "$TMPD/hd-td.html" && ! grep -q '>E2E過去見出し<' "$TMPD/hd-td.html" && ok "header due filter today" || bad "header due filter today"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list&sort=due&sortdir=asc" -o "$TMPD/hd-a.html"
python3 -c "
h=open('$TMPD/hd-a.html',encoding='utf-8').read()
a=h.find('>E2E過去見出し<'); b=h.find('>E2E今日見出し<')
assert a!=-1 and b!=-1 and a<b, (a,b)
" && ok "header sort asc order" || bad "header sort asc order"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list&sort=due&sortdir=desc" -o "$TMPD/hd-d.html"
python3 -c "
h=open('$TMPD/hd-d.html',encoding='utf-8').read()
a=h.find('>E2E過去見出し<'); b=h.find('>E2E今日見出し<')
assert a!=-1 and b!=-1 and a>b, (a,b)
" && ok "header sort desc order" || bad "header sort desc order"
purge_task "$HA1" >/dev/null
purge_task "$HB1" >/dev/null

echo "== status options =="
R=$(curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/projects/1" -H 'Content-Type: application/json' -d '{"status_options":["未着手","進行中","レビュー中","完了"]}')
[[ "$R" == *'"id":1'* ]] && ok "status options update" || bad "status options update ($R)"
R=$(curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/projects/1" -H 'Content-Type: application/json' -d '{"status_options":[]}' -w " [%{http_code}]")
[[ "$R" == *"[400]"* ]] && ok "status options validation" || bad "status options validation ($R)"
D=$(db_sql -t -A -c "SELECT status_options FROM projects WHERE id=1;")
[[ "$D" == *レビュー中* ]] && ok "status options stored" || bad "status options stored ($D)"
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/3" -H 'Content-Type: application/json' -d '{"status":"レビュー中"}' -o /dev/null
D=$(db_sql -t -A -c "SELECT status FROM tasks WHERE id=3;")
[[ "$D" == "レビュー中" ]] && ok "status set to new option" || bad "status set ($D)"
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/3" -H 'Content-Type: application/json' -d '{"status":"未着手"}' -o /dev/null
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/projects/1" -H 'Content-Type: application/json' -d '{"status_options":["未着手","進行中","完了"]}' -o /dev/null
D=$(db_sql -t -A -c "SELECT status FROM tasks WHERE id=3; SELECT status_options FROM projects WHERE id=1;")
[[ "$D" == *未着手* && "$D" == *進行中* ]] && ok "status options restored" || bad "status restore ($D)"
# Status field metadata and option-rename migration
R=$(curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/projects/1" -H 'Content-Type: application/json' -d '{"status_field_name":"作業状態"}')
D=$(db_sql -t -A -c "SELECT status_field_name FROM projects WHERE id=1;")
[[ "$D" == "作業状態" ]] && ok "status field rename" || bad "status field rename ($D)"
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/projects/1" -H 'Content-Type: application/json' -d '{"status_field_name":"Status"}' -o /dev/null
T=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d '{"project_id":1,"section_id":3,"name":"E2E状態移行"}')
TID=$(echo "$T" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
R=$(curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/projects/1" -H 'Content-Type: application/json' -d '{"status_options":["未着手","進行中","完了","E2E状態A"]}')
STATUS_VERSION=$(jget "$R" status_options_version)
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/$TID" -H 'Content-Type: application/json' -d '{"status":"E2E状態A"}' -o /dev/null
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/projects/1" -H 'Content-Type: application/json' -d '{"status_options":["未着手","進行中","完了","E2E状態B"],"status_renames":[{"from":"E2E状態A","to":"E2E状態B"}],"expected_status_options_version":'"${STATUS_VERSION:-null}"'}' -o /dev/null
D=$(db_sql -t -A -c "SELECT status FROM tasks WHERE id=$TID;")
[[ "$D" == "E2E状態B" ]] && ok "status option rename migrates tasks" || bad "status value migration ($D)"
purge_task "$TID" >/dev/null
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/projects/1" -H 'Content-Type: application/json' -d '{"status_options":["未着手","進行中","完了"]}' -o /dev/null
D=$(db_sql -t -A -c "SELECT status_field_name||'/'||status_field_enabled::text FROM projects WHERE id=1;")
[[ "$D" == "Status/true" ]] && ok "status field metadata restored" || bad "status metadata restore ($D)"

echo "== custom fields =="
F=$(api POST /api/custom-fields '{"project_id":1,"name":"E2E優先度","field_type":"select","options":"高,低"}')
FID=$(jget "$F" id)
[[ -n "$FID" ]] && ok "field create" || bad "field create" "$F"
V=$(api POST /api/task-values "{\"task_id\":2,\"field_id\":$FID,\"value\":\"高\"}")
[[ "$V" == *ok* ]] && ok "value set" || bad "value set" "$V"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=calendar&month=2026-11&cf_$FID=%E9%AB%98" -o "$TMPD/cfcal.html"
grep -q 'data-calendar-multiday="2"' "$TMPD/cfcal.html" && ! grep -q 'data-calendar-multiday="4"' "$TMPD/cfcal.html" && ok "calendar custom-field filter" || bad "calendar custom-field filter"
V=$(api POST /api/task-values "{\"task_id\":2,\"field_id\":$FID,\"value\":\"未定義\"}")
[[ "$V" == *ok* ]] && ok "free-text select value (v1: no option validation)" || bad "value set free-text" "$V"
R=$(api DELETE /api/custom-fields/$FID)
[[ "$(jget "$R" deleted)" == "$FID" ]] && ok "field delete (cascade)" || bad "field delete" "$R"
NF=$(api POST /api/custom-fields '{"project_id":1,"name":"E2E数値列","field_type":"number","config":{"number_format":"currency","currency":"JPY","decimals":0,"column_function":"sum"}}')
NFID=$(jget "$NF" id)
N=$(db_sql -t -A -c "SELECT config->>'number_format'||'|'||(config->>'currency')||'|'||(config->>'column_function') FROM custom_fields WHERE id=$NFID;")
[[ "$N" == "currency|JPY|sum" ]] && ok "number field config stored" || bad "number field config stored ($N)"
api POST /api/task-values "{\"task_id\":1,\"field_id\":$NFID,\"value\":1000000}" >/dev/null
api POST /api/task-values "{\"task_id\":2,\"field_id\":$NFID,\"value\":2500000}" >/dev/null
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/nft.html"
grep -q '￥1,000,000' "$TMPD/nft.html" && grep -q '￥2,500,000' "$TMPD/nft.html" && python3 -c "import re; h=open('$TMPD/nft.html',encoding='utf-8').read(); assert h.count('合計')>=2, h.count('合計')" && ok "number formatting and section totals" || bad "number formatting and section totals"
R=$(api PATCH /api/custom-fields/$NFID '{"config":{"number_format":"currency","currency":"JPY","decimals":0,"column_function":"none"}}')
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/nft-none.html"
! grep -q '合計' "$TMPD/nft-none.html" && ok "column function none hides totals" || bad "column function none hides totals"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/custom-fields" -H 'Content-Type: application/json' -d '{"project_id":1,"name":"E2E不正数値","field_type":"number","config":{"number_format":"invalid"}}')
[[ "$C" == "400" ]] && ok "number config validation" || bad "number config validation ($C)"
R=$(api DELETE /api/custom-fields/$NFID)
[[ "$(jget "$R" deleted)" == "$NFID" ]] && ok "number field cleanup" || bad "number field cleanup" "$R"
MF=$(api POST /api/custom-fields '{"project_id":1,"name":"E2E複数","field_type":"multi_select","options":["A","B","C"]}')
MFID=$(jget "$MF" id)
api POST /api/task-values "{\"task_id\":2,\"field_id\":$MFID,\"value\":[\"A\",\"B\"]}" >/dev/null
N=$(db_sql -t -A -c "SELECT (value_json->>0)||'|'||(value_json->>1) FROM task_custom_values WHERE task_id=2 AND field_id=$MFID;")
[[ "$N" == "A|B" ]] && ok "multi-select value stored" || bad "multi-select value stored ($N)"
DF=$(api POST /api/custom-fields '{"project_id":1,"name":"E2E日付","field_type":"date"}')
DFID=$(jget "$DF" id)
api POST /api/task-values "{\"task_id\":2,\"field_id\":$DFID,\"value\":\"2026-11-08\"}" >/dev/null
N=$(db_sql -t -A -c "SELECT value_date::text FROM task_custom_values WHERE task_id=2 AND field_id=$DFID;")
[[ "$N" == "2026-11-08" ]] && ok "date value stored" || bad "date value stored ($N)"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/mdf.html"
grep -q 'A, B' "$TMPD/mdf.html" && grep -q '2026/11/08' "$TMPD/mdf.html" && ok "multi-select/date rendered" || bad "multi-select/date rendered"
curl -s -m 15 -b "$JAR" "$BASE/search?q=%E8%A6%81%E4%BB%B6%E5%AE%9A%E7%BE%A9&cf_$MFID=A" -o "$TMPD/ms-search.html"
grep -q '>要件定義<' "$TMPD/ms-search.html" && ok "multi-select search filter" || bad "multi-select search filter"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/task-values" -H 'Content-Type: application/json' -d "{\"task_id\":2,\"field_id\":$DFID,\"value\":\"not-a-date\"}")
[[ "$C" == "400" ]] && ok "date value validation" || bad "date value validation ($C)"
api DELETE /api/custom-fields/$MFID >/dev/null
api DELETE /api/custom-fields/$DFID >/dev/null
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM custom_fields WHERE project_id=1 AND deleted_at IS NULL AND (name LIKE 'E2E複数%' OR name LIKE 'E2E日付%');")
[[ "$N" == "0" ]] && ok "multi/date field cleanup" || bad "multi/date field cleanup ($N)"
PF=$(api POST /api/custom-fields '{"project_id":1,"name":"E2Eメンバー","field_type":"people"}')
PFID=$(jget "$PF" id)
api POST /api/task-values "{\"task_id\":1,\"field_id\":$PFID,\"value\":[1,2]}" >/dev/null
N=$(db_sql -t -A -c "SELECT (value_json->>0)||'|'||(value_json->>1) FROM task_custom_values WHERE task_id=1 AND field_id=$PFID;")
[[ "$N" == "1|2" ]] && ok "people value stored" || bad "people value stored ($N)"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/task-values" -H 'Content-Type: application/json' -d "{\"task_id\":1,\"field_id\":$PFID,\"value\":[999999]}")
[[ "$C" == "400" ]] && ok "invalid member rejected" || bad "invalid member rejected ($C)"
AF=$(api POST /api/custom-fields '{"project_id":1,"name":"E2E自動ID","field_type":"auto_id","config":{"prefix":"E2EID-"}}')
AFID=$(jget "$AF" id)
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM task_custom_values WHERE field_id=$AFID AND value_text LIKE 'E2EID-%';")
[[ "$N" -ge 1 ]] && ok "auto ID backfilled" || bad "auto ID backfilled ($N)"
N=$(db_sql -t -A -c "SELECT COUNT(*) = COUNT(DISTINCT value_number) FROM task_custom_values WHERE field_id=$AFID;")
[[ "$N" == "t" ]] && ok "auto ID numbers unique" || bad "auto ID numbers unique ($N)"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/task-values" -H 'Content-Type: application/json' -d "{\"task_id\":1,\"field_id\":$AFID,\"value\":\"x\"}")
[[ "$C" == "400" ]] && ok "auto ID read-only" || bad "auto ID read-only ($C)"
VF=$(api POST /api/custom-fields '{"project_id":1,"name":"E2E所属","field_type":"project"}')
VFID=$(jget "$VF" id)
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/task-values" -H 'Content-Type: application/json' -d "{\"task_id\":1,\"field_id\":$VFID,\"value\":\"x\"}")
[[ "$C" == "400" ]] && ok "virtual field read-only" || bad "virtual field read-only ($C)"
N1=$(api POST /api/custom-fields '{"project_id":1,"name":"E2E数値A","field_type":"number"}')
N1ID=$(jget "$N1" id)
api POST /api/task-values "{\"task_id\":2,\"field_id\":$N1ID,\"value\":100}" >/dev/null
FF=$(api POST /api/custom-fields "{\"project_id\":1,\"name\":\"E2E数式\",\"field_type\":\"formula\",\"config\":{\"expression\":\"{$N1ID} + 10\",\"number_format\":\"number\",\"decimals\":0}}")
FFID=$(jget "$FF" id)
RF=$(api POST /api/custom-fields '{"project_id":1,"name":"E2E参照","field_type":"reference","config":{"source_project_ids":[1]}}')
RFID=$(jget "$RF" id)
api POST /api/task-values "{\"task_id\":1,\"field_id\":$RFID,\"value\":[2]}" >/dev/null
LF=$(api POST /api/custom-fields "{\"project_id\":1,\"name\":\"E2E参照値\",\"field_type\":\"lookup\",\"config\":{\"reference_field_id\":$RFID,\"lookup_field_id\":$N1ID}}")
LFID=$(jget "$LF" id)
UF=$(api POST /api/custom-fields "{\"project_id\":1,\"name\":\"E2E参照集計\",\"field_type\":\"rollup\",\"config\":{\"rollup_source\":\"reference\",\"reference_field_id\":$RFID,\"rollup_field_id\":$N1ID,\"rollup_function\":\"sum\"}}")
UFID=$(jget "$UF" id)
W1=$(api POST /api/custom-fields '{"project_id":1,"name":"E2Eサブ数値","field_type":"number"}')
W1ID=$(jget "$W1" id)
api POST /api/task-values "{\"task_id\":6,\"field_id\":$W1ID,\"value\":3}" >/dev/null
api POST /api/task-values "{\"task_id\":7,\"field_id\":$W1ID,\"value\":4}" >/dev/null
SU=$(api POST /api/custom-fields "{\"project_id\":1,\"name\":\"E2Eサブ集計\",\"field_type\":\"rollup\",\"config\":{\"rollup_source\":\"subtasks\",\"rollup_field_id\":$W1ID,\"rollup_function\":\"sum\"}}")
SUID=$(jget "$SU" id)
R=$(api PATCH /api/custom-fields/$UFID "{\"config\":{\"rollup_source\":\"reference\",\"reference_field_id\":$RFID,\"rollup_field_id\":$N1ID,\"rollup_function\":\"sum\",\"column_function\":\"average\"}}")
N=$(db_sql -t -A -c "SELECT config->>'column_function' FROM custom_fields WHERE id=$UFID;")
[[ "$N" == "average" ]] && ok "rollup column function stored" || bad "rollup column function stored ($N)"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/custom-fields" -H 'Content-Type: application/json' -d "{\"project_id\":1,\"name\":\"E2E不正参照\",\"field_type\":\"lookup\",\"config\":{\"reference_field_id\":$RFID,\"lookup_field_id\":$FFID}}")
[[ "$C" == "400" ]] && ok "invalid lookup target rejected" || bad "invalid lookup target rejected ($C)"
R=$(api PATCH /api/custom-fields/$AFID '{"config":{"prefix":"E2EIDX-"}}')
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM task_custom_values WHERE field_id=$AFID AND value_text LIKE 'E2EIDX-%';")
[[ "$N" -ge 1 ]] && ok "auto ID prefix updates values" || bad "auto ID prefix updates values ($N)"
rm -f "$TMPD/jar-t"
curl -s -m 10 -c "$TMPD/jar-t" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"tanaka@example.com","password":"atlas-dev-2026"}' -o /dev/null
PA=$(api POST /api/custom-fields '{"project_id":1,"name":"E2E権限管理者","field_type":"text","access_level":"admins"}')
PAID=$(jget "$PA" id)
C=$(curl -s -m 10 -b "$TMPD/jar-t" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/task-values" -H 'Content-Type: application/json' -d "{\"task_id\":2,\"field_id\":$PAID,\"value\":\"editor\"}")
[[ "$C" == "403" ]] && ok "field admin-only blocks editor" || bad "field admin-only blocks editor ($C)"
PC=$(api POST /api/custom-fields '{"project_id":1,"name":"E2E権限個人","field_type":"text","access_level":"custom","editor_ids":[2]}')
PCID=$(jget "$PC" id)
C=$(curl -s -m 10 -b "$TMPD/jar-t" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/task-values" -H 'Content-Type: application/json' -d "{\"task_id\":2,\"field_id\":$PCID,\"value\":\"editor\"}")
[[ "$C" == "201" ]] && ok "field custom access allows editor" || bad "field custom access allows editor ($C)"
api DELETE /api/custom-fields/$PAID >/dev/null
api DELETE /api/custom-fields/$PCID >/dev/null
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/custom-fields/$PAID" -H 'Content-Type: application/json' -d '{"name":"E2E権限管理者X"}')
[[ "$C" == "404" ]] && ok "deleted field patch rejected" || bad "deleted field patch rejected ($C)"
TF=$(api POST /api/custom-fields '{"project_id":1,"name":"E2Eタイマー","field_type":"timer","config":{"timer_format":"hours_minutes"}}')
TFID=$(jget "$TF" id)
TT=$(api POST /api/custom-fields '{"project_id":1,"name":"E2E時間合計","field_type":"time_tracking"}')
TTID=$(jget "$TT" id)
TS=$(api POST /api/timers "{\"task_id\":2,\"field_id\":$TFID,\"action\":\"start\"}")
[[ "$TS" == *ok* ]] && ok "timer start" || bad "timer start" "$TS"
TS=$(api POST /api/timers "{\"task_id\":2,\"field_id\":$TFID,\"action\":\"stop\"}")
[[ "$TS" == *ok* ]] && ok "timer stop" || bad "timer stop" "$TS"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/task-values" -H 'Content-Type: application/json' -d "{\"task_id\":2,\"field_id\":$TFID,\"value\":10}")
[[ "$C" == "400" ]] && ok "timer direct write rejected" || bad "timer direct write rejected ($C)"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/advanced-fields.html"
grep -q '管理者, 田中 太郎' "$TMPD/advanced-fields.html" && ok "people rendered" || bad "people rendered"
grep -q 'E2EIDX-' "$TMPD/advanced-fields.html" && ok "auto ID rendered" || bad "auto ID rendered"
grep -q '>110<' "$TMPD/advanced-fields.html" && ok "formula rendered" || bad "formula rendered"
grep -q 'E2E参照値' "$TMPD/advanced-fields.html" && grep -q 'E2E参照集計' "$TMPD/advanced-fields.html" && ok "lookup/rollup fields rendered" || bad "lookup/rollup fields rendered"
grep -q '0 時間 00 分' "$TMPD/advanced-fields.html" && ok "timer/time tracking rendered" || bad "timer/time tracking rendered"
for fid in $PFID $AFID $VFID $N1ID $FFID $RFID $LFID $UFID $W1ID $SUID $TFID $TTID; do
  api DELETE /api/custom-fields/$fid >/dev/null
done
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM custom_fields WHERE deleted_at IS NULL AND (name LIKE 'E2Eメンバー%' OR name LIKE 'E2E自動ID%' OR name LIKE 'E2E所属%' OR name LIKE 'E2E数値A%' OR name LIKE 'E2E数式%' OR name LIKE 'E2E参照%' OR name LIKE 'E2Eサブ%' OR name LIKE 'E2Eタイマー%' OR name LIKE 'E2E時間合計%');")
[[ "$N" == "0" ]] && ok "advanced field cleanup" || bad "advanced field cleanup ($N)"
SF=$(api POST /api/custom-fields '{"project_id":1,"name":"E2E復元","field_type":"text"}')
SFID=$(jget "$SF" id)
api POST /api/task-values "{\"task_id\":2,\"field_id\":$SFID,\"value\":\"復元値\"}" >/dev/null
R=$(api DELETE /api/custom-fields/$SFID)
[[ "$(jget "$R" soft)" == "True" ]] && ok "field soft delete" || bad "field soft delete" "$R"
N=$(api GET '/api/custom-fields?project_id=1' | python3 -c "import json,sys; print(sum(1 for f in json.load(sys.stdin) if f['name']=='E2E復元'))")
[[ "$N" == "0" ]] && ok "soft-deleted field hidden" || bad "soft-deleted field hidden ($N)"
N=$(api GET '/api/custom-fields/deleted?project_id=1' | python3 -c "import json,sys; print(sum(1 for f in json.load(sys.stdin) if f['name']=='E2E復元'))")
[[ "$N" == "1" ]] && ok "deleted field listed" || bad "deleted field listed ($N)"
R=$(api POST /api/custom-fields/$SFID/restore)
[[ "$(jget "$R" restored)" == "$SFID" ]] && ok "field restore" || bad "field restore" "$R"
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM task_custom_values WHERE field_id=$SFID AND value_text='復元値';")
[[ "$N" == "1" ]] && ok "restored field keeps values" || bad "restored field keeps values ($N)"
R=$(api DELETE /api/custom-fields/$SFID)
PF2=$(api POST /api/custom-fields '{"project_id":1,"name":"E2E権限","field_type":"text","access_level":"admins"}')
PF2ID=$(jget "$PF2" id)
N=$(db_sql -t -A -c "SELECT access_level FROM custom_fields WHERE id=$PF2ID;")
[[ "$N" == "admins" ]] && ok "field access policy stored" || bad "field access policy stored ($N)"
N=$(api GET '/api/custom-fields?project_id=1' | python3 -c "import json,sys; d=[f for f in json.load(sys.stdin) if f['name']=='E2E権限']; print(d[0]['access_level'] if d else 'missing')")
[[ "$N" == "admins" ]] && ok "field access policy exposed" || bad "field access policy exposed ($N)"
api DELETE /api/custom-fields/$PF2ID >/dev/null
LB=$(api POST /api/field-library '{"project_id":1,"name":"E2Eライブラリ","field_type":"text","description":"再利用フィールド"}')
LID=$(jget "$LB" id)
[[ -n "$LID" ]] && ok "field library create" || bad "field library create" "$LB"
N=$(api GET '/api/field-library?project_id=1' | python3 -c "import json,sys; print(sum(1 for f in json.load(sys.stdin) if f['name']=='E2Eライブラリ'))")
[[ "$N" == "1" ]] && ok "field library listed" || bad "field library listed ($N)"
R=$(api DELETE /api/field-library/$LID)
[[ "$(jget "$R" deleted)" == "$LID" ]] && ok "field library delete" || bad "field library delete" "$R"
db_sql -q -c "DELETE FROM custom_fields WHERE deleted_at IS NOT NULL AND (name LIKE 'E2E%' OR name='E2E復元' OR name='E2E権限');"

echo "== multi-homing =="
P=$(api POST /api/projects '{"workspace_id":1,"name":"E2E一時PJ"}')
PID=$(jget "$P" id)
SEC=$(curl -s -m 15 -b "$JAR" "$BASE/api/lookup?project_id=$PID" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
M=$(api POST /api/memberships "{\"task_id\":2,\"project_id\":$PID,\"section_id\":$SEC}")
[[ "$M" == *ok* ]] && ok "membership add" || bad "membership add" "$M"
curl -s -m 15 -b "$JAR" "$BASE/projects/$PID?view=list" -o "$TMPD/mh.html"
grep -q '要件定義' "$TMPD/mh.html" && ok "member visible" || bad "member visible"
G=$(api POST /api/memberships '{"task_id":2,"project_id":1}')
[[ "$G" == *primary* ]] && ok "primary guard" || bad "primary guard" "$G"

# A user who can edit project B but not the task's primary project must be
# able to edit the multi-homed task from B, while global delete stays primary-only.
MH=$(api POST /api/admin/users '{"name":"E2Eマルチホーム","email":"e2e-mh@example.com","password":"e2e-pass1","role":"member"}')
MHID=$(jget "$MH" id)
api POST "/api/projects/$PID/members" "{\"user_id\":$MHID,\"role\":\"editor\"}" >/dev/null
MT=$(api POST /api/tasks '{"project_id":1,"section_id":2,"name":"E2Eマルチホーム認可"}')
MTID=$(jget "$MT" id)
api POST /api/memberships "{\"task_id\":$MTID,\"project_id\":$PID,\"section_id\":$SEC}" >/dev/null
rm -f "$TMPD/jar-mh"
curl -s -m 10 -c "$TMPD/jar-mh" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"e2e-mh@example.com","password":"e2e-pass1"}' -o /dev/null
C=$(curl -s -m 10 -b "$TMPD/jar-mh" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/tasks/$MTID" -H 'Content-Type: application/json' -d '{"progress":30}')
[[ "$C" == "200" ]] && ok "multi-home editor patch ($C)" || bad "multi-home editor patch ($C)"
C=$(curl -s -m 10 -b "$TMPD/jar-mh" -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/tasks/$MTID?force=1")
[[ "$C" == "403" ]] && ok "multi-home delete requires primary ($C)" || bad "multi-home delete requires primary ($C)"
purge_task "$MTID" >/dev/null
api DELETE "/api/admin/users/$MHID" >/dev/null
api DELETE "/api/memberships?task_id=2&project_id=$PID" >/dev/null
R=$(api DELETE /api/projects/$PID)
[[ "$(jget "$R" deleted)" == "$PID" ]] && ok "project delete" || bad "project delete" "$R"

echo "== messages/attachments =="
M=$(api POST /api/messages '{"project_id":1,"title":"E2E件名","body":"E2E本文"}')
MID=$(jget "$M" id)
[[ -n "$MID" ]] && ok "message post" || bad "message post" "$M"
echo "E2E添付" > "$TMPD/up.txt"
A=$(curl -s -m 15 -b "$JAR" -X POST "$BASE/api/attachments" -F "task_id=2" -F "file=@$TMPD/up.txt;type=text/plain")
AID=$(jget "$A" id)
[[ -n "$AID" ]] && ok "attachment upload ($AID)" || bad "attachment upload" "$A"
curl -s -m 15 -b "$JAR" "$BASE/api/attachments/$AID" -o "$TMPD/dl.txt"
diff "$TMPD/up.txt" "$TMPD/dl.txt" >/dev/null && ok "attachment bytes" || bad "attachment bytes"
api DELETE /api/attachments/$AID >/dev/null
db_sql -t -c "DELETE FROM project_messages WHERE id = $MID;" >/dev/null
echo "message/attachment cleaned"

echo "== knowledge =="
K=$(api POST /api/knowledge '{"project_id":1,"title":"E2E知識","body":"# 見出し\nE2E本文"}')
KID=$(jget "$K" id)
[[ -n "$KID" ]] && ok "knowledge create ($KID)" || bad "knowledge create" "$K"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=knowledge" -o "$TMPD/knowledge.html"
grep -q 'E2E知識' "$TMPD/knowledge.html" && grep -q 'data-knowledge' "$TMPD/knowledge.html" && ok "knowledge visible" || bad "knowledge visible"
R=$(api PATCH /api/knowledge/$KID '{"title":"E2E知識更新","body":"更新本文"}')
[[ "$(jget "$R" id)" == "$KID" ]] && ok "knowledge update" || bad "knowledge update" "$R"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=knowledge" -o "$TMPD/knowledge2.html"
grep -q 'E2E知識更新' "$TMPD/knowledge2.html" && ok "knowledge update visible" || bad "knowledge update visible"
R=$(api DELETE "/api/knowledge/$KID?revision=1")
[[ "$(jget "$R" deleted)" == "$KID" ]] && ok "knowledge delete" || bad "knowledge delete" "$R"
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM project_knowledge WHERE id=$KID AND deleted_at IS NOT NULL;")
[[ "$N" == "1" ]] && ok "knowledge retained in trash" || bad "knowledge retained in trash ($N)"

echo "== project email =="
EM=$(api GET /api/projects/1/email)
ADDR=$(echo "$EM" | python3 -c "import json,sys; print(json.load(sys.stdin).get('address',''))")
[[ "$ADDR" == *"@inbox.atlas.local" ]] && ok "project email address" || bad "project email address" "$ADDR"
R=$(api PATCH /api/projects/1/email '{"enabled":false}')
[[ "$R" == *'"enabled":false'* ]] && ok "project email disable" || bad "project email disable" "$R"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/projects/1/email/intake" -H 'Content-Type: application/json' -d '{"from":"e2e@example.com","subject":"E2Eメールタスク","body":"メール本文"}')
[[ "$C" == "403" ]] && ok "project email disabled rejects" || bad "project email disabled ($C)"
R=$(api PATCH /api/projects/1/email '{"enabled":true}')
[[ "$R" == *'"enabled":true'* ]] && ok "project email enable" || bad "project email enable" "$R"
MAIL=$(api POST /api/projects/1/email/intake '{"from":"e2e@example.com","subject":"E2Eメールタスク","body":"メール本文"}')
ETID=$(jget "$MAIL" task_id)
[[ -n "$ETID" ]] && ok "project email intake task ($ETID)" || bad "project email intake" "$MAIL"
D=$(db_sql -t -A -c "SELECT name||'/'||status||'/'||(description LIKE '%e2e@example.com%' AND description LIKE '%メール本文%') FROM tasks WHERE id=$ETID;")
[[ "$D" == "E2Eメールタスク/未着手/true" ]] && ok "project email task fields" || bad "project email task fields ($D)"
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM project_email_messages WHERE task_id=$ETID;")
[[ "$N" == "1" ]] && ok "project email message stored" || bad "project email message stored ($N)"
db_sql -t -c "DELETE FROM project_email_messages WHERE task_id=$ETID;" >/dev/null
purge_task "$ETID" >/dev/null
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM project_email_messages WHERE task_id=$ETID;")
[[ "$N" == "0" ]] && ok "project email cleaned" || bad "project email cleaned ($N)"

echo "== project apps =="
N=$(api GET /api/projects/1/apps | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
[[ "$N" == "0" ]] && ok "project apps empty" || bad "project apps empty ($N)"
A=$(api POST /api/projects/1/apps '{"app_key":"webhook","config":{"url":"https://example.com/e2e-hook"}}')
AID=$(jget "$A" id)
[[ -n "$AID" ]] && ok "project app install ($AID)" || bad "project app install" "$A"
A2=$(api POST /api/projects/1/apps '{"app_key":"webhook","config":{"url":"https://example.com/dup"}}')
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/projects/1/apps" -H 'Content-Type: application/json' -d '{"app_key":"webhook","config":{"url":"https://example.com/dup"}}')
[[ "$C" == "409" ]] && ok "project app duplicate guard" || bad "project app duplicate ($C)"
N=$(api GET /api/projects/1/apps | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d), d[0]['app_key'], d[0]['config'].get('url',''))")
[[ "$N" == "1 webhook https://example.com/e2e-hook" ]] && ok "project app stored" || bad "project app stored ($N)"
R=$(api PATCH /api/projects/1/apps/$AID '{"enabled":false}')
[[ "$(jget "$R" id)" == "$AID" ]] && ok "project app disable" || bad "project app disable" "$R"
N=$(api GET /api/projects/1/apps | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['enabled'])")
[[ "$N" == "False" ]] && ok "project app disabled state" || bad "project app disabled state ($N)"
R=$(api DELETE /api/projects/1/apps/$AID)
[[ "$(jget "$R" deleted)" == "$AID" ]] && ok "project app remove" || bad "project app remove" "$R"
N=$(api GET /api/projects/1/apps | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
[[ "$N" == "0" ]] && ok "project app cleaned" || bad "project app cleaned ($N)"

echo "== bundles =="
N=$(api GET '/api/bundles?project_id=1' | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
[[ "$N" == "0" ]] && ok "bundles empty" || bad "bundles empty ($N)"
B=$(api POST /api/bundles '{"workspace_id":1,"name":"E2Eバンドル","description":"共通フィールド","fields":[{"name":"E2Eバンドル優先度","field_type":"select","options":["高","中","低"]},{"name":"E2Eバンドル工数","field_type":"number","options":[]}]}')
BID=$(jget "$B" id)
[[ -n "$BID" ]] && ok "bundle create ($BID)" || bad "bundle create" "$B"
N=$(api GET '/api/bundles?project_id=1' | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d), d[0]['name'], len(d[0]['fields']), d[0]['applied'])")
[[ "$N" == "1 E2Eバンドル 2 False" ]] && ok "bundle stored" || bad "bundle stored ($N)"
R=$(api POST /api/bundles/$BID/apply '{"project_id":1}')
CREATED=$(jget "$R" created_fields)
[[ "$CREATED" == "2" ]] && ok "bundle apply fields ($CREATED)" || bad "bundle apply" "$R"
D=$(db_sql -t -A -c "SELECT COUNT(*) FROM custom_fields WHERE project_id=1 AND deleted_at IS NULL AND name IN ('E2Eバンドル優先度','E2Eバンドル工数');")
[[ "$D" == "2" ]] && ok "bundle fields created" || bad "bundle fields created ($D)"
N=$(api GET '/api/bundles?project_id=1' | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['applied'], d[0]['applied_count'])")
[[ "$N" == "True 1" ]] && ok "bundle applied state" || bad "bundle applied state ($N)"
R=$(api POST /api/bundles/$BID/apply '{"project_id":1}')
CREATED=$(jget "$R" created_fields)
[[ "$CREATED" == "0" ]] && ok "bundle apply idempotent" || bad "bundle idempotent" "$R"
R=$(api PATCH /api/bundles/$BID '{"name":"E2Eバンドル改"}')
[[ "$(jget "$R" id)" == "$BID" ]] && ok "bundle update" || bad "bundle update" "$R"
R=$(api DELETE /api/bundles/$BID)
[[ "$(jget "$R" deleted)" == "$BID" ]] && ok "bundle delete" || bad "bundle delete" "$R"
db_sql -t -c "DELETE FROM custom_fields WHERE project_id=1 AND name IN ('E2Eバンドル優先度','E2Eバンドル工数');" >/dev/null
N=$(db_sql -t -A -c "SELECT (SELECT COUNT(*) FROM bundles)||'/'||(SELECT COUNT(*) FROM bundle_applications)||'/'||(SELECT COUNT(*) FROM custom_fields WHERE project_id=1 AND deleted_at IS NULL AND name LIKE 'E2Eバンドル%');")
[[ "$N" == "0/0/0" ]] && ok "bundle cleaned" || bad "bundle cleaned ($N)"

echo "== automations =="
N=$(api GET /api/projects/1/automations | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
[[ "$N" == "0" ]] && ok "automations empty" || bad "automations empty ($N)"
AR=$(api POST /api/projects/1/automations '{"name":"E2E新規進行中","trigger":"task_created","action_type":"set_status","action_value":"進行中"}')
ARID=$(jget "$AR" id)
[[ -n "$ARID" ]] && ok "automation status rule" || bad "automation status rule" "$AR"
AC=$(api POST /api/projects/1/automations '{"name":"E2E完了コメント","trigger":"task_completed","action_type":"add_comment","action_value":"E2E完了おめでとう"}')
ACID=$(jget "$AC" id)
[[ -n "$ACID" ]] && ok "automation comment rule" || bad "automation comment rule" "$AC"
N=$(api GET /api/projects/1/automations | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
[[ "$N" == "2" ]] && ok "automations stored" || bad "automations stored ($N)"
AT=$(api POST /api/tasks '{"project_id":1,"section_id":2,"name":"E2E自動化タスク"}')
ATID=$(jget "$AT" id)
D=$(db_sql -t -A -c "SELECT status FROM tasks WHERE id=$ATID;")
[[ "$D" == "進行中" ]] && ok "automation set status on create" || bad "automation create status ($D)"
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM automation_runs WHERE automation_id=$ARID AND task_id=$ATID;")
[[ "$N" == "1" ]] && ok "automation run recorded" || bad "automation run recorded ($N)"
api PATCH /api/tasks/$ATID '{"completed":true}' >/dev/null
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM comments WHERE task_id=$ATID AND body='E2E完了おめでとう';")
[[ "$N" == "1" ]] && ok "automation comment on complete" || bad "automation completion comment ($N)"
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM automation_runs WHERE automation_id=$ACID AND task_id=$ATID;")
[[ "$N" == "1" ]] && ok "automation completion run" || bad "automation completion run ($N)"
R=$(api PATCH /api/projects/1/automations/$ARID '{"name":"E2E新規進行中改","enabled":false}')
[[ "$(jget "$R" id)" == "$ARID" ]] && ok "automation update" || bad "automation update" "$R"
D=$(db_sql -t -A -c "SELECT enabled::text FROM project_automations WHERE id=$ARID;")
[[ "$D" == "false" ]] && ok "automation disabled state" || bad "automation disabled state ($D)"
R=$(api DELETE /api/projects/1/automations/$ARID)
[[ "$(jget "$R" deleted)" == "$ARID" ]] && ok "automation status rule delete" || bad "automation status delete" "$R"
R=$(api DELETE /api/projects/1/automations/$ACID)
[[ "$(jget "$R" deleted)" == "$ACID" ]] && ok "automation comment rule delete" || bad "automation comment delete" "$R"
purge_task "$ATID" >/dev/null
N=$(db_sql -t -A -c "SELECT (SELECT COUNT(*) FROM project_automations)||'/'||(SELECT COUNT(*) FROM automation_runs);")
[[ "$N" == "0/0" ]] && ok "automations cleaned" || bad "automations cleaned ($N)"

echo "== forms =="
FORM=$(api POST /api/forms '{"project_id":1,"name":"E2Eフォーム","description":"回答テスト","fields":[{"key":"title","label":"タスク名","type":"text","required":true},{"key":"details","label":"詳細","type":"textarea"},{"key":"due_on","label":"期日","type":"date"}]}')
FID=$(jget "$FORM" id)
[[ -n "$FID" ]] && ok "form create ($FID)" || bad "form create" "$FORM"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=forms" -o "$TMPD/forms.html"
grep -q 'E2Eフォーム' "$TMPD/forms.html" && grep -q 'data-forms' "$TMPD/forms.html" && ok "form visible" || bad "form visible"
R=$(api PATCH /api/forms/$FID '{"published":true}')
[[ "$(jget "$R" id)" == "$FID" ]] && ok "form publish" || bad "form publish" "$R"
SUB=$(api POST /api/forms/$FID/submit '{"answers":{"title":"E2Eフォーム回答","details":"詳細テスト","due_on":"2026-11-20"}}')
FTID=$(jget "$SUB" task_id)
[[ -n "$FTID" ]] && ok "form submit task ($FTID)" || bad "form submit" "$SUB"
D=$(db_sql -t -A -c "SELECT name||'/'||due_on::text||'/'||status FROM tasks WHERE id=$FTID;")
[[ "$D" == "E2Eフォーム回答/2026-11-20/未着手" ]] && ok "form task fields" || bad "form task fields ($D)"
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM form_responses WHERE form_id=$FID;")
[[ "$N" == "1" ]] && ok "form response stored" || bad "form response stored ($N)"
N=$(api GET "/api/forms?project_id=1" | python3 -c "import json,sys; d=json.load(sys.stdin); print(next((x['response_count'] for x in d if x['id']==$FID), -1))")
[[ "$N" == "1" ]] && ok "form response counted" || bad "form response counted ($N)"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/forms/$FID/submit" -H 'Content-Type: application/json' -d '{"answers":{"title":""}}')
[[ "$C" == "400" ]] && ok "form required validation" || bad "form required validation ($C)"
purge_task "$FTID" >/dev/null
R=$(api DELETE /api/forms/$FID)
[[ "$(jget "$R" deleted)" == "$FID" ]] && ok "form delete" || bad "form delete" "$R"
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM project_forms WHERE id=$FID;")
[[ "$N" == "0" ]] && ok "form cleaned" || bad "form cleaned ($N)"

echo "== saved views =="
SV=$(api POST /api/saved-views '{"project_id":1,"name":"E2Eビュー","filters":{"hide_completed":true},"sort_key":"due","group_by":"section"}')
SVID=$(jget "$SV" id)
[[ -n "$SVID" ]] && ok "saved view create" || bad "saved view create" "$SV"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list&saved=$SVID" -o "$TMPD/svv.html"
grep -q 'E2Eビュー' "$TMPD/svv.html" && ok "saved view applied" || bad "saved view applied"
R=$(api DELETE /api/saved-views/$SVID)
[[ "$(jget "$R" deleted)" == "$SVID" ]] && ok "saved view delete" || bad "saved view delete" "$R"

echo "== inbox/events/multi-user =="
rm -f "$TMPD/jar2"
curl -s -m 10 -c "$TMPD/jar2" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"tanaka@example.com","password":"atlas-dev-2026"}' -o /dev/null
T=$(curl -s -m 10 -b "$TMPD/jar2" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d '{"project_id":1,"section_id":2,"name":"E2Eイベント用"}')
TID=$(jget "$T" id)
curl -s -m 10 -b "$TMPD/jar" -X PATCH "$BASE/api/tasks/$TID" -H 'Content-Type: application/json' -d '{"completed":true}' -o /dev/null
curl -s -m 10 -b "$JAR" "$BASE/inbox?filter=all" -o "$TMPD/ibe.html"
grep -q 'タスクを完了しました' "$TMPD/ibe.html" && ok "event in inbox" || bad "event in inbox"
EID=$(db_sql -t -c "SELECT id FROM task_events WHERE task_id = $TID AND kind = 'completed';")
R=$(api POST /api/inbox/read "{\"event_id\":$EID}")
[[ "$R" == *ok* ]] && ok "event read" || bad "event read" "$R"
purge_task "$TID" >/dev/null
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM task_events WHERE task_id = $TID;")
[[ "$N" == "0" ]] && ok "event cascade (hard delete)" || bad "event cascade ($N left)"

echo "== advanced search =="
curl -s -m 15 -b "$JAR" "$BASE/search?assignee=2" -o "$TMPD/adv.html"
grep -q '>要件定義<' "$TMPD/adv.html" && grep -q '>設計レビュー<' "$TMPD/adv.html" && bad "assignee filter" || ok "assignee filter"
DT=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d '{"project_id":1,"section_id":2,"name":"E2E期間内"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
D0=$(python3 -c "import datetime; print((datetime.date.today()+datetime.timedelta(days=2)).isoformat())")
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/$DT" -H 'Content-Type: application/json' -d "{\"due_on\":\"$D0\"}" -o /dev/null
DOUT=$(api POST /api/tasks '{"project_id":1,"section_id":2,"name":"E2E期間外","due_on":"2000-01-01"}')
DOUT_ID=$(jget "$DOUT" id)
D1=$(python3 -c "import datetime; print((datetime.date.today()+datetime.timedelta(days=1)).isoformat())")
D9=$(python3 -c "import datetime; print((datetime.date.today()+datetime.timedelta(days=9)).isoformat())")
curl -s -m 15 -b "$JAR" "$BASE/search?from=$D1&to=$D9" -o "$TMPD/adv2.html"
grep -q '>E2E期間内<' "$TMPD/adv2.html" && ! grep -q '>E2E期間外<' "$TMPD/adv2.html" && ok "due range filter" || bad "due range filter"
purge_task "$DT" >/dev/null
purge_task "$DOUT_ID" >/dev/null
db_sql -q -c "DELETE FROM search_history;"
curl -s -m 15 -b "$JAR" "$BASE/search?completed=done" -o "$TMPD/adv3.html"
grep -q '>キックオフ<' "$TMPD/adv3.html" && ! grep -q '>要件定義<' "$TMPD/adv3.html" && ok "completed filter" || bad "completed filter"

echo "== advanced search filters =="
CFID=$(db_sql -t -A -c "SELECT id FROM custom_fields WHERE project_id=1 AND field_type='number' ORDER BY id LIMIT 1;")
TODAY=$(python3 -c "import datetime; print(datetime.date.today().isoformat())")
ST=$(api POST /api/tasks "{\"project_id\":1,\"section_id\":2,\"name\":\"E2E拡張検索\",\"start_on\":\"$TODAY\",\"due_on\":\"$TODAY\"}")
STID=$(jget "$ST" id)
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/$STID" -H 'Content-Type: application/json' -d '{"status":"未着手"}' -o /dev/null
curl -s -m 10 -b "$JAR" -X POST "$BASE/api/task-values" -H 'Content-Type: application/json' -d "{\"task_id\":$STID,\"field_id\":$CFID,\"value\":777}" -o /dev/null
curl -s -m 15 -b "$JAR" "$BASE/search?q=E2E%E6%8B%A1%E5%BC%B5%E6%A4%9C%E7%B4%A2&status=%E6%9C%AA%E7%9D%80%E6%89%8B&cf_$CFID=777&from=$TODAY&to=$TODAY&created_from=$TODAY" -o "$TMPD/adv4.html"
grep -q '>E2E拡張検索<' "$TMPD/adv4.html" && ! grep -q '>設計レビュー<' "$TMPD/adv4.html" && ok "status/custom/date filter" || bad "status/custom/date filter"
curl -s -m 15 -b "$JAR" "$BASE/search?q=E2E%E6%8B%A1%E5%BC%B5%E6%A4%9C%E7%B4%A2&status=%E5%AE%8C%E4%BA%86" -o "$TMPD/adv5.html"
! grep -q '>E2E拡張検索<' "$TMPD/adv5.html" && ok "status mismatch excludes" || bad "status mismatch excludes"
SS=$(api POST /api/saved-searches "{\"workspace_id\":1,\"name\":\"E2E保存検索\",\"params\":{\"q\":\"E2E拡張検索\",\"status\":\"未着手\",\"cf_$CFID\":\"777\"}}")
SSID=$(jget "$SS" id)
[[ -n "$SSID" ]] && ok "saved search create ($SSID)" || bad "saved search create" "$SS"
curl -s -m 15 -b "$JAR" "$BASE/search?q=E2E%E6%8B%A1%E5%BC%B5%E6%A4%9C%E7%B4%A2&status=%E6%9C%AA%E7%9D%80%E6%89%8B&cf_$CFID=777" -o "$TMPD/adv6.html"
grep -q 'E2E保存検索' "$TMPD/adv6.html" && ok "saved search visible" || bad "saved search visible"
curl -s -m 10 -b "$JAR" -X DELETE "$BASE/api/saved-searches/$SSID" -o /dev/null
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM saved_searches WHERE id=$SSID;")
[[ "$N" == "0" ]] && ok "saved search delete" || bad "saved search delete ($N)"
purge_task "$STID" >/dev/null

echo "== global search scope/ranking =="
R1=$(api POST /api/tasks '{"project_id":1,"section_id":2,"name":"S01RankE2E"}')
R2=$(api POST /api/tasks '{"project_id":1,"section_id":2,"name":"S01RankE2E alpha"}')
R3=$(api POST /api/tasks '{"project_id":1,"section_id":2,"name":"x S01RankE2E"}')
R4=$(api POST /api/tasks '{"project_id":1,"section_id":2,"name":"S01DescE2E"}')
R1ID=$(jget "$R1" id); R2ID=$(jget "$R2" id); R3ID=$(jget "$R3" id); R4ID=$(jget "$R4" id)
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/$R4ID" -H 'Content-Type: application/json' -d '{"description":"S01RankE2E in description"}' -o /dev/null
curl -s -m 15 -b "$JAR" "$BASE/search?q=S01RankE2E" -o "$TMPD/rank.html"
ORDER=$(python3 - "$TMPD/rank.html" <<'PYEOF'
import sys
h=open(sys.argv[1],encoding='utf-8').read()
names=["S01RankE2E","S01RankE2E alpha","x S01RankE2E","S01DescE2E"]
pos=[h.find(">"+n+"<") for n in names]
print("ok" if all(p>=0 for p in pos) and pos==sorted(pos) else "bad:"+",".join(map(str,pos)))
PYEOF
)
[[ "$ORDER" == "ok" ]] && ok "search ranking exact/prefix/contains/description" || bad "search ranking" "$ORDER"
for id in $R1ID $R2ID $R3ID $R4ID; do purge_task "$id" >/dev/null; done

GP=$(api POST /api/projects '{"workspace_id":1,"name":"E2E-SCOPE-PJ"}')
GPID=$(jget "$GP" id)
curl -s -m 15 -b "$JAR" "$BASE/search?q=E2E-SCOPE-PJ" -o "$TMPD/scope-pj.html"
grep -q 'data-search-section="projects"' "$TMPD/scope-pj.html" && grep -q 'E2E-SCOPE-PJ' "$TMPD/scope-pj.html" && ok "search scope projects" || bad "search scope projects"
api DELETE /api/projects/$GPID >/dev/null

GM=$(api POST /api/messages '{"project_id":1,"title":"E2E-SCOPE-MSG","body":"message scope body"}')
curl -s -m 15 -b "$JAR" "$BASE/search?q=E2E-SCOPE-MSG" -o "$TMPD/scope-msg.html"
grep -q 'data-search-section="messages"' "$TMPD/scope-msg.html" && grep -q 'E2E-SCOPE-MSG' "$TMPD/scope-msg.html" && ok "search scope messages" || bad "search scope messages"
db_sql -q -c "DELETE FROM project_messages WHERE title='E2E-SCOPE-MSG';"

GK=$(api POST /api/knowledge '{"project_id":1,"title":"E2E-SCOPE-NOTE","body":"knowledge scope body"}')
GKID=$(jget "$GK" id)
curl -s -m 15 -b "$JAR" "$BASE/search?q=E2E-SCOPE-NOTE" -o "$TMPD/scope-note.html"
grep -q 'data-search-section="knowledge"' "$TMPD/scope-note.html" && grep -q 'E2E-SCOPE-NOTE' "$TMPD/scope-note.html" && ok "search scope knowledge" || bad "search scope knowledge"
api DELETE "/api/knowledge/$GKID?revision=0" >/dev/null

echo "E2E search file" > "$TMPD/searchfile.txt"
GA=$(curl -s -m 15 -b "$JAR" -X POST "$BASE/api/attachments" -F "task_id=2" -F "file=@$TMPD/searchfile.txt;filename=E2E-SCOPE-FILE.txt;type=text/plain")
GAID=$(jget "$GA" id)
curl -s -m 15 -b "$JAR" "$BASE/search?q=E2E-SCOPE-FILE" -o "$TMPD/scope-file.html"
grep -q 'data-search-section="files"' "$TMPD/scope-file.html" && grep -q 'E2E-SCOPE-FILE.txt' "$TMPD/scope-file.html" && ok "search scope files" || bad "search scope files"
api DELETE /api/attachments/$GAID >/dev/null

GC=$(api POST /api/comments '{"task_id":2,"body":"E2E-SCOPE-COMMENT"}')
curl -s -m 15 -b "$JAR" "$BASE/search?q=E2E-SCOPE-COMMENT" -o "$TMPD/scope-comment.html"
grep -q 'data-search-section="tasks"' "$TMPD/scope-comment.html" && grep -q '>要件定義<' "$TMPD/scope-comment.html" && ok "search scope comments" || bad "search scope comments"
db_sql -q -c "DELETE FROM comments WHERE body='E2E-SCOPE-COMMENT';"

echo "== global search shell =="
db_sql -q -c "DELETE FROM search_history WHERE user_id=1;"
curl -s -m 15 -b "$JAR" "$BASE/search?q=%E8%A6%81%E4%BB%B6%E5%AE%9A%E7%BE%A9" -o "$TMPD/gs-search.html"
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM search_history WHERE user_id=1 AND query='要件定義';")
[[ "$N" == "1" ]] && ok "search history recorded" || bad "search history recorded ($N)"
curl -s -m 15 -b "$JAR" "$BASE/api/search/suggest?q=%E8%A6%81%E4%BB%B6%E5%AE%9A%E7%BE%A9" -o "$TMPD/gs-suggest.json"
python3 -c "import json; d=json.load(open('$TMPD/gs-suggest.json')); assert any(t['id']==2 for t in d['groups']['tasks']), d" && ok "search suggest tasks" || bad "search suggest tasks"
curl -s -m 15 -b "$JAR" "$BASE/api/search/suggest" -o "$TMPD/gs-history.json"
python3 -c "import json; d=json.load(open('$TMPD/gs-history.json')); assert '要件定義' in d['history'], d" && ok "search suggest history" || bad "search suggest history"
curl -s -m 15 -b "$JAR" "$BASE/search" -o "$TMPD/gs-empty.html"
grep -q 'data-search-history' "$TMPD/gs-empty.html" && grep -q 'data-search-history-item="要件定義"' "$TMPD/gs-empty.html" && grep -q 'data-search-history-clear' "$TMPD/gs-empty.html" && ok "search history page" || bad "search history page"
curl -s -m 15 -b "$JAR" "$BASE/" -o "$TMPD/gs-home.html"
grep -q 'data-sidebar-actions' "$TMPD/gs-home.html" && grep -q 'data-command-palette-open' "$TMPD/gs-home.html" && ! grep -q 'data-global-search-input' "$TMPD/gs-home.html" && ok "command palette entry markup" || bad "command palette entry markup"
curl -s -m 10 -b "$JAR" -X DELETE "$BASE/api/search/history" -o /dev/null
curl -s -m 15 -b "$JAR" "$BASE/search" -o "$TMPD/gs-cleared.html"
! grep -q 'data-search-history' "$TMPD/gs-cleared.html" && ok "search history clear" || bad "search history clear"

echo "== search permissions =="
P10=$(api POST /api/projects '{"workspace_id":1,"name":"E2E_PRIVATE_S10 PJ"}')
P10ID=$(jget "$P10" id)
T10=$(api POST /api/tasks "{\"project_id\":$P10ID,\"name\":\"E2E_PRIVATE_S10 task\"}")
T10ID=$(jget "$T10" id)
curl -s -m 10 -b "$JAR" -X POST "$BASE/api/messages" -H 'Content-Type: application/json' -d "{\"project_id\":$P10ID,\"title\":\"E2E_PRIVATE_S10 message\",\"body\":\"private\"}" -o /dev/null
K10=$(api POST /api/knowledge "{\"project_id\":$P10ID,\"title\":\"E2E_PRIVATE_S10 note\",\"body\":\"private\"}")
K10ID=$(jget "$K10" id)
F10=$(api POST /api/custom-fields "{\"project_id\":$P10ID,\"name\":\"S10秘密\",\"field_type\":\"select\",\"options\":\"A,B\"}")
F10ID=$(jget "$F10" id)
db_sql -q -c "DELETE FROM users WHERE email IN ('e2e-s10-viewer@example.com','e2e-s10-guest@example.com');"
V10=$(api POST /api/admin/users '{"name":"E2E S10 Viewer","email":"e2e-s10-viewer@example.com","password":"e2e-pass1","role":"member"}')
V10ID=$(jget "$V10" id)
G10=$(api POST /api/admin/users '{"name":"E2E S10 Guest","email":"e2e-s10-guest@example.com","password":"e2e-pass1","role":"guest"}')
G10ID=$(jget "$G10" id)
JARV10="$TMPD/jar-s10-v"
JARG10="$TMPD/jar-s10-g"
curl -s -m 10 -c "$JARV10" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"e2e-s10-viewer@example.com","password":"e2e-pass1"}' -o /dev/null
curl -s -m 10 -c "$JARG10" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"e2e-s10-guest@example.com","password":"e2e-pass1"}' -o /dev/null
curl -s -m 15 -b "$JARV10" "$BASE/search?q=E2E_PRIVATE_S10" -o "$TMPD/s10-before.html"
grep -q 'data-search-empty' "$TMPD/s10-before.html" && ! grep -q 'E2E_PRIVATE_S10 PJ' "$TMPD/s10-before.html" && ! grep -q 'E2E_PRIVATE_S10 task' "$TMPD/s10-before.html" && ok "search blocks private results" || bad "search blocks private results"
curl -s -m 15 -b "$JARV10" "$BASE/search?project=$P10ID" -o "$TMPD/s10-project.html"
grep -q 'data-search-empty' "$TMPD/s10-project.html" && ! grep -q 'E2E_PRIVATE_S10 task' "$TMPD/s10-project.html" && ok "search blocks private project filter" || bad "search blocks private project filter"
curl -s -m 15 -b "$JARG10" "$BASE/search" -o "$TMPD/s10-guest.html"
grep -q "data-search-assignee-option=\"$G10ID\"" "$TMPD/s10-guest.html" && ! grep -q 'data-search-assignee-option="1"' "$TMPD/s10-guest.html" && ok "guest assignee directory scoped" || bad "guest assignee directory scoped"
api POST /api/projects/$P10ID/members "{\"user_id\":$V10ID,\"role\":\"viewer\"}" >/dev/null
curl -s -m 15 -b "$JARV10" "$BASE/search?q=E2E_PRIVATE_S10" -o "$TMPD/s10-after.html"
grep -q 'data-search-section="tasks"' "$TMPD/s10-after.html" && grep -q 'E2E_PRIVATE_S10 task' "$TMPD/s10-after.html" && grep -q 'data-search-section="projects"' "$TMPD/s10-after.html" && grep -q 'E2E_PRIVATE_S10 PJ' "$TMPD/s10-after.html" && grep -q 'data-search-section="messages"' "$TMPD/s10-after.html" && grep -q 'data-search-section="knowledge"' "$TMPD/s10-after.html" && ok "viewer search sees granted project" || bad "viewer search sees granted project"
grep -q "name=\"cf_$F10ID\"" "$TMPD/s10-after.html" && ok "viewer search sees granted custom field" || bad "viewer search sees granted custom field"
api DELETE /api/projects/$P10ID >/dev/null
api DELETE /api/admin/users/$V10ID >/dev/null
api DELETE /api/admin/users/$G10ID >/dev/null
N=$(db_sql -t -A -c "SELECT (SELECT COUNT(*) FROM users WHERE email IN ('e2e-s10-viewer@example.com','e2e-s10-guest@example.com'))||'/'||(SELECT COUNT(*) FROM projects WHERE id=$P10ID);")
[[ "$N" == "0/0" ]] && ok "search permission fixtures cleaned" || bad "search permission fixtures cleaned ($N)"

echo "== logout =="
curl -s -m 10 -b "$JAR" -X POST "$BASE/api/auth/logout" -o /dev/null -c "$TMPD/jar3"
C=$(curl -s -m 10 -b "$TMPD/jar3" -o /dev/null -w "%{http_code}" "$BASE/")
[[ "$C" == "307" || "$C" == "308" ]] && ok "logout clears ($C)" || bad "logout ($C)"
# Server-side logout revokes the token, so establish a fresh session for the
# rest of the suite.
rm -f "$JAR"
C=$(curl -s -m 10 -c "$JAR" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"atlas-dev-2026"}' -o /dev/null -w "%{http_code}")
[[ "$C" == "200" ]] && ok "re-login after logout" || bad "re-login after logout ($C)"

echo "== assignment notice =="
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/3" -H 'Content-Type: application/json' -d '{"assignee_id":2}' -o /dev/null
rm -f "$TMPD/jart"
curl -s -m 10 -c "$TMPD/jart" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"tanaka@example.com","password":"atlas-dev-2026"}' -o /dev/null
curl -s -m 10 -b "$TMPD/jart" "$BASE/inbox" -o "$TMPD/iban.html"
grep -q '担当者を田中 太郎に変更しました' "$TMPD/iban.html" && ok "assignee notified" || bad "assignee notified"
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/3" -H 'Content-Type: application/json' -d '{"assignee_id":3}' -o /dev/null
db_sql -t -c "DELETE FROM task_events WHERE task_id = 3;" >/dev/null

echo "== my-tasks buckets =="
D1=$(python3 -c "import datetime; print((datetime.date.today()-datetime.timedelta(days=3)).isoformat())")
D0=$(python3 -c "import datetime; print(datetime.date.today().isoformat())")
A=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d '{"project_id":1,"section_id":3,"name":"E2E期限超過"}')
A1=$(echo "$A" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
B=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d '{"project_id":1,"section_id":3,"name":"E2E今日"}')
B1=$(echo "$B" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/$A1" -H 'Content-Type: application/json' -d "{\"due_on\":\"$D1\",\"assignee_id\":1}" -o /dev/null
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/$B1" -H 'Content-Type: application/json' -d "{\"due_on\":\"$D0\",\"assignee_id\":1}" -o /dev/null
curl -s -m 10 -b "$JAR" "$BASE/my-tasks" -o "$TMPD/mtb.html"
grep -q '>E2E期限超過<' "$TMPD/mtb.html" && grep -q '>E2E今日<' "$TMPD/mtb.html" && ok "buckets show" || bad "buckets show"
purge_task "$A1" >/dev/null
purge_task "$B1" >/dev/null

echo "== my-tasks order =="
MT1=$(api POST /api/tasks "{\"project_id\":1,\"section_id\":2,\"name\":\"E2E並びA\",\"assignee_id\":1,\"due_on\":\"$D0\"}")
MT2=$(api POST /api/tasks "{\"project_id\":1,\"section_id\":2,\"name\":\"E2E並びB\",\"assignee_id\":1,\"due_on\":\"$D0\"}")
MT3=$(api POST /api/tasks "{\"project_id\":1,\"section_id\":2,\"name\":\"E2E並びC\",\"assignee_id\":1,\"due_on\":\"$D0\"}")
MT1ID=$(jget "$MT1" id); MT2ID=$(jget "$MT2" id); MT3ID=$(jget "$MT3" id)
R=$(api PUT /api/my-tasks "{\"items\":[{\"task_id\":$MT3ID,\"position\":1000,\"due_on\":\"$D0\"},{\"task_id\":$MT2ID,\"position\":2000,\"due_on\":\"$D0\"},{\"task_id\":$MT1ID,\"position\":3000,\"due_on\":\"$D0\"}]}")
[[ "$(jget "$R" count)" == "3" ]] && ok "my-tasks reorder api" || bad "my-tasks reorder api" "$R"
curl -s -m 15 -b "$JAR" "$BASE/my-tasks" -o "$TMPD/mto.html"
ORDER=$(python3 - "$TMPD/mto.html" "$MT3ID" "$MT2ID" "$MT1ID" <<'PYEOF'
import re,sys
h=open(sys.argv[1],encoding='utf-8').read()
ids=re.findall(r'data-my-task-bucket="today"[\s\S]*?(?=data-my-task-bucket="week")',h)
rows=re.findall(r'data-my-task-row="(\d+)"',ids[0] if ids else '')
want=[sys.argv[2],sys.argv[3],sys.argv[4]]
pos=[rows.index(x) for x in want if x in rows]
print("ok" if len(pos)==3 and pos==sorted(pos) else "bad:"+",".join(rows))
PYEOF
)
[[ "$ORDER" == "ok" ]] && ok "my-tasks order persisted" || bad "my-tasks order persisted" "$ORDER"
D=$(db_sql -t -A -c "SELECT string_agg(task_id::text,',' ORDER BY position) FROM my_task_orders WHERE user_id=1 AND task_id IN ($MT1ID,$MT2ID,$MT3ID);")
[[ "$D" == "$MT3ID,$MT2ID,$MT1ID" ]] && ok "my-tasks order db" || bad "my-tasks order db ($D)"
MT3STAMP=$(db_sql -t -A -c "SELECT updated_at::text FROM tasks WHERE id=$MT3ID;")
R=$(api PATCH "/api/tasks/$MT3ID" "{\"due_on\":null,\"expected_updated_at\":\"$MT3STAMP\"}")
[[ "$(jget "$R" id)" == "$MT3ID" ]] && ok "my-tasks bucket date uses versioned task update" || bad "my-tasks bucket date uses versioned task update" "$R"
R=$(api PUT /api/my-tasks "{\"items\":[{\"task_id\":$MT3ID,\"position\":1000,\"due_on\":null},{\"task_id\":$MT2ID,\"position\":2000,\"due_on\":\"$D0\"},{\"task_id\":$MT1ID,\"position\":3000,\"due_on\":\"$D0\"}]}")
curl -s -m 15 -b "$JAR" "$BASE/my-tasks" -o "$TMPD/mto2.html"
grep -q 'data-my-task-bucket="later"[\s\S]*' "$TMPD/mto2.html" || true
IN_LATER=$(python3 - "$TMPD/mto2.html" "$MT3ID" <<'PYEOF'
import re,sys
h=open(sys.argv[1],encoding='utf-8').read()
m=re.search(r'data-my-task-bucket="later"[\s\S]*?(?=</div>\s*</div>\s*</div>|$)',h)
rows=re.findall(r'data-my-task-row="(\d+)"',m.group(0) if m else '')
print("ok" if sys.argv[2] in rows else "bad:"+",".join(rows[:10]))
PYEOF
)
[[ "$IN_LATER" == "ok" ]] && ok "my-tasks cross bucket due change" || bad "my-tasks cross bucket due change" "$IN_LATER"
D=$(db_sql -t -A -c "SELECT COALESCE(due_on::text,'null') FROM tasks WHERE id=$MT3ID;")
[[ "$D" == "null" ]] && ok "my-tasks due cleared" || bad "my-tasks due cleared ($D)"
purge_task "$MT1ID" >/dev/null
purge_task "$MT2ID" >/dev/null
purge_task "$MT3ID" >/dev/null
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM my_task_orders WHERE task_id IN ($MT1ID,$MT2ID,$MT3ID);")
[[ "$N" == "0" ]] && ok "my-tasks fixtures cleaned" || bad "my-tasks fixtures cleaned ($N)"

echo "== timeline move =="
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=timeline" -o "$TMPD/tlui.html"
grep -q 'data-timeline-bar=' "$TMPD/tlui.html" && grep -q 'data-timeline-handle="start"' "$TMPD/tlui.html" && grep -q 'data-timeline-handle="end"' "$TMPD/tlui.html" && grep -q 'data-timeline-zoom-in' "$TMPD/tlui.html" && grep -q 'data-timeline-undated' "$TMPD/tlui.html" && grep -q 'W40' "$TMPD/tlui.html" && ok "timeline controls" || bad "timeline controls"
grep -q 'data-timeline-dependency-direction="precedent"' "$TMPD/tlui.html" && grep -q 'data-timeline-dependency-direction="dependent"' "$TMPD/tlui.html" && grep -q 'data-timeline-dependency-placement="top"' "$TMPD/tlui.html" && grep -q 'data-timeline-dependency-placement="bottom"' "$TMPD/tlui.html" && grep -q 'ドラッグして依存関係を作成' "$TMPD/tlui.html" && ok "timeline dependency handles" || bad "timeline dependency handles"
grep -q 'data-timeline-bar-name=' "$TMPD/tlui.html" && ok "timeline bar tooltip name marker" || bad "timeline bar tooltip name marker"

echo "== timeline zoom presets =="
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=timeline" -o "$TMPD/tz-default.html"
grep -q 'data-timeline-zoom="2"' "$TMPD/tz-default.html" && grep -q 'data-timeline-zoom-level="週"' "$TMPD/tz-default.html" && grep -q 'data-timeline-zoom-preset="week"' "$TMPD/tz-default.html" && ok "timeline default week" || bad "timeline default week"
python3 - "$TMPD/tz-default.html" <<'PYEOF'
import re,sys
h=open(sys.argv[1],encoding='utf-8').read()
labels=re.findall(r'<span[^>]*data-timeline-bar-label="[^"]*"[^>]*>',h)
assert labels, 'no outside labels at week'
for tag in labels:
    assert 'bg-white' not in tag and 'shadow' not in tag and 'border' not in tag, tag
PYEOF
[[ $? == 0 ]] && ok "timeline week plain labels" || bad "timeline week plain labels"
api PUT /api/view-state '{"project_id":1,"view":"timeline","state":{"zoom":1}}' >/dev/null
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=timeline" -o "$TMPD/tz-day.html"
grep -q 'data-timeline-zoom-level="日"' "$TMPD/tz-day.html" && grep -q 'data-timeline-zoom-preset="day"' "$TMPD/tz-day.html" && ok "timeline day preset" || bad "timeline day preset"
api PUT /api/view-state '{"project_id":1,"view":"timeline","state":{"zoom":4}}' >/dev/null
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=timeline" -o "$TMPD/tz-quarter.html"
grep -q 'data-timeline-zoom-level="四半期"' "$TMPD/tz-quarter.html" && grep -q 'data-timeline-zoom-preset="quarter"' "$TMPD/tz-quarter.html" && ok "timeline quarter preset" || bad "timeline quarter preset"
COARSE_TASK=$(api POST /api/tasks '{"project_id":1,"section_id":2,"name":"E2Eズームラベル","start_on":"2026-11-04","due_on":"2026-11-04"}')
COARSE_ID=$(jget "$COARSE_TASK" id)
api PUT /api/view-state '{"project_id":1,"view":"timeline","state":{"zoom":6}}' >/dev/null
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=timeline" -o "$TMPD/tz-year.html"
grep -q 'data-timeline-zoom-level="年"' "$TMPD/tz-year.html" && grep -q 'data-timeline-zoom-preset="year"' "$TMPD/tz-year.html" && grep -q "data-timeline-bar-label=\"$COARSE_ID\"" "$TMPD/tz-year.html" && ok "timeline year preset" || bad "timeline year preset"
api PUT /api/view-state '{"project_id":1,"view":"timeline","state":{"zoom":5}}' >/dev/null
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=timeline" -o "$TMPD/tz-half.html"
python3 - "$TMPD/tz-half.html" "$COARSE_ID" <<'PYEOF'
import re,sys
h=open(sys.argv[1],encoding='utf-8').read()
assert sys.argv[2].isdigit(), 'missing one-day test task'
labels=re.findall(r'<span[^>]*data-timeline-bar-label="'+sys.argv[2]+r'"[^>]*>',h)
assert labels, 'no outside labels'
for tag in labels:
    assert 'bg-white' not in tag and 'shadow' not in tag and 'border' not in tag, tag
PYEOF
[[ $? == 0 ]] && ok "timeline half plain labels" || bad "timeline half plain labels"
purge_task "$COARSE_ID" >/dev/null
api PUT /api/view-state '{"project_id":1,"view":"timeline","state":{}}' >/dev/null
grep -q 'data-timeline-group-line' "$TMPD/tlui.html" && grep -q 'data-timeline-weekend' "$TMPD/tlui.html" && grep -q 'data-timeline-filter-open' "$TMPD/tlui.html" && grep -q 'data-timeline-sort-open' "$TMPD/tlui.html" && grep -q 'data-timeline-options-open' "$TMPD/tlui.html" && grep -q 'data-view-options-drawer="タイムライン"' "$TMPD/tlui.html" && grep -q 'data-timeline-bar-state=' "$TMPD/tlui.html" && grep -q 'aria-expanded="true"' "$TMPD/tlui.html" && ok "timeline parity chrome" || bad "timeline parity chrome"
grep -q 'data-timeline-section-row="1"' "$TMPD/tlui.html" && ok "timeline section header row" || bad "timeline section header row"
T=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d '{"project_id":1,"section_id":2,"name":"E2E移動"}')
TID=$(echo "$T" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/$TID" -H 'Content-Type: application/json' -d '{"start_on":"2026-11-10","due_on":"2026-11-12"}' -o /dev/null
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/$TID" -H 'Content-Type: application/json' -d '{"start_on":"2026-11-17","due_on":"2026-11-19"}' -o /dev/null
D=$(db_sql -t -A -c "SELECT start_on::text||'/'||due_on::text FROM tasks WHERE id = $TID;")
[[ "$D" == "2026-11-17/2026-11-19" ]] && ok "dates shifted ($D)" || bad "dates shifted ($D)"
purge_task "$TID" >/dev/null

echo "== timeline resize =="
T=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d '{"project_id":1,"section_id":2,"name":"E2E伸縮"}')
TID=$(echo "$T" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/$TID" -H 'Content-Type: application/json' -d '{"start_on":"2026-11-10","due_on":"2026-11-12"}' -o /dev/null
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/$TID" -H 'Content-Type: application/json' -d '{"due_on":"2026-11-18"}' -o /dev/null
D=$(db_sql -t -A -c "SELECT start_on::text||'/'||due_on::text FROM tasks WHERE id = $TID;")
[[ "$D" == "2026-11-10/2026-11-18" ]] && ok "resize end ($D)" || bad "resize end ($D)"
purge_task "$TID" >/dev/null

echo "== bulk ops =="
B1=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d '{"project_id":1,"section_id":3,"name":"E2E一括A"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
B2=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d '{"project_id":1,"section_id":3,"name":"E2E一括B"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
R=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/tasks/bulk" -H 'Content-Type: application/json' -d "{\"ids\":[$B1,$B2],\"op\":\"complete\"}")
[[ "$R" == *'"updated":2'* ]] && ok "bulk complete" || bad "bulk complete ($R)"
R=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/tasks/bulk" -H 'Content-Type: application/json' -d "{\"ids\":[$B1,$B2],\"op\":\"move\",\"section_id\":2}")
[[ "$R" == *'"updated":2'* ]] && ok "bulk move" || bad "bulk move ($R)"
R=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/tasks/bulk" -H 'Content-Type: application/json' -d "{\"ids\":[$B1],\"op\":\"explode\"}")
[[ "$R" == *'unknown op'* ]] && ok "bulk validation" || bad "bulk validation ($R)"
R=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/tasks/bulk" -H 'Content-Type: application/json' -d "{\"ids\":[$B1,$B2],\"op\":\"delete\",\"force\":true}")
[[ "$R" == *'"updated":2'* ]] && ok "bulk delete" || bad "bulk delete ($R)"

echo "== recurrence =="
T=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d '{"project_id":1,"section_id":2,"name":"E2E繰返"}')
TID=$(echo "$T" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/$TID" -H 'Content-Type: application/json' -d '{"due_on":"2026-11-10","recurrence":"weekly"}' -o /dev/null
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/$TID" -H 'Content-Type: application/json' -d '{"completed":true}' -o /dev/null
N=$(db_sql -t -A -c "SELECT due_on::text||'/'||completed::text||'/'||recurrence FROM tasks WHERE name = 'E2E繰返' AND id <> $TID;")
[[ "$N" == "2026-11-17/false/weekly" ]] && ok "weekly spawn ($N)" || bad "weekly spawn ($N)"
purge_task "$TID" >/dev/null
db_sql -t -c "DELETE FROM tasks WHERE name = 'E2E繰返';" >/dev/null

echo "== task templates =="
TP=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/task-templates" -H 'Content-Type: application/json' -d '{"project_id":1,"name":"E2E定型","title_template":"E2E定型作業","assignee_id":2,"due_offset_days":3,"section_id":2,"subtasks":[{"name":"手順1"},{"name":"手順2"}]}')
TPID=$(echo "$TP" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
[[ -n "$TPID" ]] && ok "template create ($TPID)" || bad "template create ($TP)"
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/task-templates/$TPID" -H 'Content-Type: application/json' -d '{"name":"E2E定型改","due_offset_days":5}' -o /dev/null
N=$(db_sql -t -A -c "SELECT name||'/'||due_offset_days FROM task_templates WHERE id=$TPID;")
[[ "$N" == "E2E定型改/5" ]] && ok "template patch" || bad "template patch ($N)"
TI=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/task-templates/$TPID" -H 'Content-Type: application/json' -d '{}')
TID=$(echo "$TI" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM tasks WHERE (id = $TID OR parent_task_id = $TID);")
[[ "$N" == "3" ]] && ok "instantiate task+2subs" || bad "instantiate ($N)"
curl -s -m 10 -b "$JAR" -X DELETE "$BASE/api/task-templates/$TPID" -o /dev/null
db_sql -t -c "DELETE FROM tasks WHERE name IN ('E2E定型作業','手順1','手順2');" >/dev/null

echo "== project templates =="
PT=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/project-templates" -H 'Content-Type: application/json' -d '{"project_id":1,"name":"E2E雛形"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
[[ -n "$PT" ]] && ok "snapshot ($PT)" || bad "snapshot"
PI=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/project-templates/$PT" -H 'Content-Type: application/json' -d '{"name":"E2E複製PJ"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
SRC=$(db_sql -t -A -c "SELECT COUNT(*) FROM tasks WHERE project_id = 1 AND parent_task_id IS NULL AND deleted_at IS NULL;")
N=$(db_sql -t -A -c "SELECT (SELECT COUNT(*) FROM sections WHERE project_id = $PI)::text||'/'||(SELECT COUNT(*) FROM tasks WHERE project_id = $PI)::text;")
[[ "$N" == "4/$SRC" ]] && ok "instantiate ($N)" || bad "instantiate ($N, expected 4/$SRC)"
curl -s -m 10 -b "$JAR" -X DELETE "$BASE/api/projects/$PI" -o /dev/null
curl -s -m 10 -b "$JAR" -X DELETE "$BASE/api/project-templates/$PT" -o /dev/null

echo "== audit log =="
T=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d '{"project_id":1,"section_id":3,"name":"E2E監査"}')
TID=$(echo "$T" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
curl -s -m 10 -b "$JAR" "$BASE/audit" -o "$TMPD/au.html"
grep -q 'task.create' "$TMPD/au.html" && grep -q 'E2E監査' "$TMPD/au.html" && ok "audit row" || bad "audit row"
purge_task "$TID" >/dev/null
db_sql -t -c "DELETE FROM audit_log;" >/dev/null

echo "== export =="
TCOUNT=$(db_sql -t -A -c "SELECT COUNT(*) FROM tasks WHERE project_id = 1 AND deleted_at IS NULL;")
curl -s -m 15 -b "$JAR" "$BASE/api/projects/1/export?format=json" -o "$TMPD/ex.json"
python3 -c "import json; d=json.load(open('$TMPD/ex.json')); assert len(d['tasks'])==$TCOUNT and len(d['sections'])==4, d" && ok "json export" || bad "json export"
curl -s -m 15 -b "$JAR" "$BASE/api/projects/1/export?format=csv" -o "$TMPD/ex.csv"
python3 -c "import csv; rows=list(csv.reader(open('$TMPD/ex.csv', encoding='utf-8-sig'))); assert len(rows)==$TCOUNT+1, len(rows)" && ok "csv export" || bad "csv export"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" "$BASE/api/projects/1/export?format=xml")
[[ "$C" == "400" ]] && ok "export validation" || bad "export validation ($C)"

echo "== csv import =="
curl -s -m 15 -b "$JAR" "$BASE/api/projects/1/export?format=csv" -o "$TMPD/rt.csv"
P=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/projects" -H 'Content-Type: application/json' -d '{"workspace_id":1,"name":"E2E取込先"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
R=$(curl -s -m 15 -b "$JAR" -X POST "$BASE/api/projects/$P/import" -F "file=@$TMPD/rt.csv;type=text/csv")
echo "$R" | grep -q "\"created\":$TCOUNT" && echo "$R" | grep -q '"skipped":0' && ok "roundtrip ($R)" || bad "roundtrip ($R, expected $TCOUNT)"
printf 'セクション,種別,名前,完了,担当者,開始日,期日,進捗,Status,繰返し,コメント\n不良,サブタスク,孤立,,,,,,,,\n' > "$TMPD/bad.csv"
R=$(curl -s -m 15 -b "$JAR" -X POST "$BASE/api/projects/$P/import" -F "file=@$TMPD/bad.csv;type=text/csv")
echo "$R" | grep -q 'subtask without parent' && ok "orphan skipped" || bad "orphan ($R)"
curl -s -m 10 -b "$JAR" -X DELETE "$BASE/api/projects/$P" -o /dev/null

echo "== dashboard export =="
MCOUNT=$(db_sql -t -A -c "SELECT COUNT(*) FROM tasks WHERE project_id = 1 AND parent_task_id IS NULL AND deleted_at IS NULL;")
curl -s -m 15 -b "$JAR" "$BASE/api/projects/1/dashboard/export?format=json&days=7" -o "$TMPD/dj.json"
python3 -c "import json; d=json.load(open('$TMPD/dj.json')); assert d['totals']['total']==$MCOUNT and len(d['trend'])==7, d" && ok "dashboard json" || bad "dashboard json"
curl -s -m 15 -b "$JAR" "$BASE/api/projects/1/dashboard/export?format=csv&days=7" -o "$TMPD/dc.csv"
python3 -c "import csv; rows=list(csv.reader(open('$TMPD/dc.csv', encoding='utf-8-sig'))); assert len([r for r in rows[1:] if r[0]=='日別完了'])==7, len(rows)" && ok "dashboard csv" || bad "dashboard csv"

echo "== dashboard status field lifecycle =="
curl -s -m 15 -b "$JAR" "$BASE/api/projects/1/dashboard/export?format=json&days=7" -o "$TMPD/d05-before.json"
python3 -c "import json; d=json.load(open('$TMPD/d05-before.json')); assert d['status_field_enabled'] is True and len(d['byStatus'])>0, d" && ok "dashboard status baseline" || bad "dashboard status baseline"
BEFORE_STATUS=$(db_sql -qAtc 'SELECT status FROM tasks WHERE id IN (1,3) ORDER BY id')
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/projects/1" -H 'Content-Type: application/json' -d '{"status_field_enabled":false}' -o /dev/null
curl -s -m 15 -b "$JAR" "$BASE/api/projects/1/dashboard/export?format=json&days=7" -o "$TMPD/d05-off.json"
python3 -c "import json; d=json.load(open('$TMPD/d05-off.json')); assert d['status_field_enabled'] is False and d['byStatus']==[], d" && ok "dashboard hides status history" || bad "dashboard hides status history"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=dashboard" -o "$TMPD/d05-off.html"
grep -q 'data-dashboard-status-disabled' "$TMPD/d05-off.html" && ! grep -q 'data-dashboard-widget-title="Status別タスク数"' "$TMPD/d05-off.html" && ok "dashboard status disabled state" || bad "dashboard status disabled state"
D=$(db_sql -qAtc 'SELECT status FROM tasks WHERE id IN (1,3) ORDER BY id')
[[ -n "$BEFORE_STATUS" && "$D" == "$BEFORE_STATUS" ]] && ok "status values retained in db" || bad "status values retained ($D)"
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/projects/1" -H 'Content-Type: application/json' -d '{"status_field_enabled":true}' -o /dev/null
curl -s -m 15 -b "$JAR" "$BASE/api/projects/1/dashboard/export?format=json&days=7" -o "$TMPD/d05-on.json"
python3 -c "import json; d=json.load(open('$TMPD/d05-on.json')); assert d['status_field_enabled'] is True and len(d['byStatus'])>0, d" && ok "dashboard status restored" || bad "dashboard status restored"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=dashboard" -o "$TMPD/d05-on.html"
grep -q 'data-dashboard-widget-title="Status別タスク数"' "$TMPD/d05-on.html" && ok "dashboard status widget restored" || bad "dashboard status widget restored"

echo "== share links =="
SH=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/projects/1/share" -H 'Content-Type: application/json' -d '{"label":"E2E共有"}')
TOK=$(echo "$SH" | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")
TID=$(echo "$SH" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
curl -s -m 15 "$BASE/share/$TOK" -o "$TMPD/sh.html"
grep -q 'デモプロジェクト' "$TMPD/sh.html" && grep -q '読み取り専用' "$TMPD/sh.html" && ok "public share" || bad "public share"
curl -s -m 10 -b "$JAR" -X DELETE "$BASE/api/projects/1/share?token_id=$TID" -o /dev/null
curl -s -m 15 "$BASE/share/$TOK" -o "$TMPD/sh2.html"
grep -q 'data-not-found' "$TMPD/sh2.html" && ok "revoke" || bad "revoke"
SH=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/projects/1/share" -H 'Content-Type: application/json' -d '{"label":"E2E期限","expires_in_days":7}')
TOK2=$(echo "$SH" | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")
db_sql -t -c "UPDATE project_share_tokens SET expires_at = NOW() - interval '1 hour' WHERE token = '$TOK2';" >/dev/null
curl -s -m 15 "$BASE/share/$TOK2" -o "$TMPD/sh3.html"
grep -q 'data-not-found' "$TMPD/sh3.html" && ok "expiry enforced" || bad "expiry enforced"
bash scripts/janitor.sh >/dev/null || e2e_abort 'test janitor failed'
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM project_share_tokens WHERE token = '$TOK2';")
[[ "$N" == "0" ]] && ok "expired purged" || bad "expired kept ($N)"

echo "== weekly report =="
docker exec "$E2E_APP_ID" node scripts/weekly-report.cjs >/dev/null
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM project_messages WHERE project_id=1 AND title LIKE '[自動]%';")
[[ "$N" == "1" ]] && ok "report posted" || bad "report posted ($N)"
docker exec "$E2E_APP_ID" node scripts/weekly-report.cjs >/dev/null
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM project_messages WHERE project_id=1 AND title LIKE '[自動]%';")
[[ "$N" == "1" ]] && ok "report idempotent" || bad "report dup ($N)"
db_sql -t -c "DELETE FROM project_messages WHERE title LIKE '[自動]%';" >/dev/null

echo "== row reorder =="
ST=$(db_sql -t -A -c "SELECT updated_at::text FROM tasks WHERE id = 3;")
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/3" -H 'Content-Type: application/json' -d "{\"position\":0,\"expected_updated_at\":\"$ST\"}" -o /dev/null
curl -s -m 10 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/ro.html"
python3 -c "
h=open('$TMPD/ro.html').read()
a=h.find('>設計レビュー<'); b=h.find('>要件定義<')
assert a!=-1 and b!=-1 and a<b, (a,b)
print('order flipped ok')
" && ok "reorder" || bad "reorder"
ST=$(db_sql -t -A -c "SELECT updated_at::text FROM tasks WHERE id = 3;")
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/3" -H 'Content-Type: application/json' -d "{\"position\":2000,\"expected_updated_at\":\"$ST\"}" -o /dev/null

echo "== markdown =="
C=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/comments" -H 'Content-Type: application/json' -d '{"task_id":2,"body":"**E2E太字**と<script>x</script>"}')
CID=$(echo "$C" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
curl -s -m 10 -b "$JAR" "$BASE/projects/1?view=list&task=2" -o "$TMPD/md.html"
grep -q '<strong>E2E太字</strong>' "$TMPD/md.html" && ! grep -q '<script>x</script>' "$TMPD/md.html" && ok "md render+escape" || bad "md render"
db_sql -t -c "DELETE FROM comments WHERE id = $CID;" >/dev/null

echo "== attachment preview =="
python3 -c "import base64; open('$TMPD/px.png','wb').write(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='))"
P=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/attachments" -F "task_id=2" -F "file=@$TMPD/px.png;type=image/png" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
curl -s -m 10 -b "$JAR" -o "$TMPD/px.out" -D "$TMPD/px.hdr" "$BASE/api/attachments/$P?inline=1"
grep -qi "content-disposition: inline" "$TMPD/px.hdr" && cmp -s "$TMPD/px.png" "$TMPD/px.out" && ok "png inline" || bad "png inline"
printf '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' > "$TMPD/x.svg"
S=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/attachments" -F "task_id=2" -F "file=@$TMPD/x.svg;type=image/svg+xml" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
curl -s -m 10 -b "$JAR" -o /dev/null -D "$TMPD/sv.hdr" "$BASE/api/attachments/$S?inline=1"
grep -qi "content-disposition: attachment" "$TMPD/sv.hdr" && ok "svg forced attachment" || bad "svg inline leaked"
curl -s -m 10 -b "$JAR" -X DELETE "$BASE/api/attachments/$P" -o /dev/null
curl -s -m 10 -b "$JAR" -X DELETE "$BASE/api/attachments/$S" -o /dev/null

echo "== calendar week =="
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=calendar&zoom=week&week=2026-11-04" -o "$TMPD/cw.html"
grep -q '2026-11-01' "$TMPD/cw.html" && grep -q '>開発環境の準備<' "$TMPD/cw.html" && ok "week view" || bad "week view"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=calendar&zoom=week&week=2026-11-08" -o "$TMPD/cw-next.html"
grep -Eq 'data-calendar-multiday="2"[^>]*data-calendar-continues="right"' "$TMPD/cw.html" && grep -Eq 'data-calendar-multiday="2"[^>]*data-calendar-continues="left"' "$TMPD/cw-next.html" && ok "calendar range bar" || bad "calendar range bar"
grep -q 'data-calendar-add' "$TMPD/cw.html" && grep -q 'data-calendar-zoom' "$TMPD/cw.html" && grep -q 'data-calendar-filter-open' "$TMPD/cw.html" && grep -q 'data-calendar-options-open' "$TMPD/cw.html" && grep -q 'data-view-options-drawer="カレンダー"' "$TMPD/cw.html" && grep -q 'フィルター' "$TMPD/cw.html" && ok "calendar toolbar" || bad "calendar toolbar"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=calendar&month=2026-11" -o "$TMPD/cm.html"
grep -q 'data-calendar-day="2026-11-30"' "$TMPD/cm.html" && grep -q 'data-calendar-multiday="3"' "$TMPD/cm.html" && ok "month grid + bars" || bad "month grid + bars"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=calendar&month=2026-11&hide=1" -o "$TMPD/cmh.html"
grep -q 'data-calendar-multiday="2"' "$TMPD/cmh.html" && ! grep -q 'data-calendar-multiday="5"' "$TMPD/cmh.html" && ok "calendar hide completed" || bad "calendar hide completed"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=calendar&zoom=week&week=2026-11-01&weekends=0" -o "$TMPD/cwo.html"
grep -q 'data-calendar-day="2026-11-02"' "$TMPD/cwo.html" && ! grep -q 'data-calendar-day="2026-11-01"' "$TMPD/cwo.html" && ok "calendar hide weekends" || bad "calendar hide weekends"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=calendar&zoom=week&week=2026-11-08&multi=0" -o "$TMPD/cwm.html"
grep -q 'data-calendar-single="2"' "$TMPD/cwm.html" && ! grep -q 'data-calendar-multiday="2"' "$TMPD/cwm.html" && ok "calendar multi-day off" || bad "calendar multi-day off"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=calendar&month=2026-11&start=1&weekends=0" -o "$TMPD/cm-ms.html"
grep -q 'data-calendar-day="2026-10-26"' "$TMPD/cm-ms.html" && ! grep -q 'data-calendar-day="2026-11-01"' "$TMPD/cm-ms.html" && ok "calendar monday start" || bad "calendar monday start"
grep -q 'data-calendar-multi-grid' "$TMPD/p-calendar.html" && grep -q 'data-calendar-resize="start"' "$TMPD/p-calendar.html" && grep -q 'data-calendar-resize="end"' "$TMPD/p-calendar.html" && ok "calendar resize handles" || bad "calendar resize handles"
grep -q 'touch-none' "$TMPD/p-calendar.html" && grep -q 'touch-pan-y' "$TMPD/p-calendar.html" && grep -q 'touch-none' "$TMPD/p-timeline.html" && ok "touch interaction classes" || bad "touch interaction classes"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=calendar&zoom=week&week=2026-11-01&completed=done" -o "$TMPD/cwc.html"
grep -q 'data-calendar-multiday="5"' "$TMPD/cwc.html" && ! grep -q 'data-calendar-multiday="2"' "$TMPD/cwc.html" && ok "calendar quick completed" || bad "calendar quick completed"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=calendar&month=2026-11&status=%E6%9C%AA%E7%9D%80%E6%89%8B" -o "$TMPD/cms.html"
grep -q 'data-calendar-multiday="3"' "$TMPD/cms.html" && ! grep -q 'data-calendar-multiday="2"' "$TMPD/cms.html" && ok "calendar status filter" || bad "calendar status filter"

echo "== calendar color legend =="
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=calendar&month=2026-11&color=status" -o "$TMPD/cal-color-status.html"
grep -q 'data-calendar-legend' "$TMPD/cal-color-status.html" && grep -q 'data-calendar-legend-item="進行中"' "$TMPD/cal-color-status.html" && grep -q 'data-calendar-legend-item="unset"' "$TMPD/cal-color-status.html" && ok "calendar status legend" || bad "calendar status legend"
grep -q 'data-calendar-color-key="進行中" data-calendar-color-tone="set"' "$TMPD/cal-color-status.html" && ok "calendar status tone" || bad "calendar status tone"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=calendar&month=2026-11&color=default" -o "$TMPD/cal-color-section.html"
grep -q 'data-calendar-legend-item="計画中"' "$TMPD/cal-color-section.html" && grep -q 'data-calendar-color-key="計画中" data-calendar-color-tone="set"' "$TMPD/cal-color-section.html" && ok "calendar section colors" || bad "calendar section colors"
CF=$(api POST /api/custom-fields '{"project_id":1,"name":"E2Eカラー","field_type":"select","options":"赤,青"}')
CFID=$(jget "$CF" id)
api POST /api/task-values "{\"task_id\":2,\"field_id\":$CFID,\"value\":\"赤\"}" >/dev/null
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=calendar&month=2026-11&color=cf:$CFID" -o "$TMPD/cal-color-cf.html"
grep -q 'data-calendar-legend-item="赤"' "$TMPD/cal-color-cf.html" && grep -q 'data-calendar-legend-item="青"' "$TMPD/cal-color-cf.html" && grep -q 'data-calendar-legend-item="unset"' "$TMPD/cal-color-cf.html" && ok "calendar custom field legend" || bad "calendar custom field legend"
grep -q 'data-calendar-color-key="赤" data-calendar-color-tone="set"' "$TMPD/cal-color-cf.html" && grep -q 'data-calendar-color-key="" data-calendar-color-tone="unset"' "$TMPD/cal-color-cf.html" && ok "calendar unset neutral color" || bad "calendar unset neutral color"
api DELETE /api/custom-fields/$CFID >/dev/null

echo "== calendar overflow =="
CALIDS=()
for i in 1 2 3 4 5; do
  CT=$(api POST /api/tasks "{\"project_id\":1,\"section_id\":2,\"name\":\"E2Eカレンダー$i\",\"due_on\":\"2026-11-20\"}")
  CALIDS+=("$(jget "$CT" id)")
done
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=calendar&month=2026-11" -o "$TMPD/cal-many.html"
grep -q 'data-calendar-day-count="5"' "$TMPD/cal-many.html" && grep -q 'data-calendar-more="2026-11-20"' "$TMPD/cal-many.html" && ok "calendar +N overflow" || bad "calendar +N overflow"
N=$(grep -o '>E2Eカレンダー[0-9]<' "$TMPD/cal-many.html" | wc -l | tr -d ' ')
[[ "$N" == "3" ]] && ok "calendar shows 3 of 5" || bad "calendar shows 3 of 5 ($N)"
python3 -c "import re; h=open('$TMPD/cal-many.html',encoding='utf-8').read(); t=re.sub('<[^>]+>','',h); assert '+2 件' in t" && ok "calendar +N label" || bad "calendar +N label"
for id in "${CALIDS[@]}"; do purge_task "$id" >/dev/null; done
TODAY=$(python3 -c "import datetime; print(datetime.date.today().isoformat())")
START=$(python3 -c "import datetime; print((datetime.date.today()-datetime.timedelta(days=2)).isoformat())")
DUE_TASK=$(api POST /api/tasks "{\"project_id\":1,\"section_id\":2,\"name\":\"E2E期日フィルタ\",\"start_on\":\"$START\",\"due_on\":\"$TODAY\"}")
DUE_ID=$(jget "$DUE_TASK" id)
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=calendar&zoom=week&week=$TODAY&due=today" -o "$TMPD/cdue.html"
grep -q "data-calendar-multiday=\"$DUE_ID\"" "$TMPD/cdue.html" && ! grep -q 'data-calendar-multiday="3"' "$TMPD/cdue.html" && ok "calendar due filter" || bad "calendar due filter"
purge_task "$DUE_ID" >/dev/null
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=calendar&month=2026-11&completed_on=7" -o "$TMPD/ccom.html"
grep -q 'data-calendar-multiday="5"' "$TMPD/ccom.html" && ! grep -q 'data-calendar-multiday="2"' "$TMPD/ccom.html" && ok "calendar completion date" || bad "calendar completion date"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=calendar&month=2026-11&creator=none" -o "$TMPD/ccr.html"
grep -q 'data-calendar-multiday="2"' "$TMPD/ccr.html" && ok "calendar creator filter" || bad "calendar creator filter"
D10=$(python3 -c "import datetime; print((datetime.date.today()+datetime.timedelta(days=10)).isoformat())")
CT1R=$(api POST /api/tasks "{\"project_id\":1,\"section_id\":2,\"name\":\"E2E作成日今日\",\"start_on\":\"$D10\",\"due_on\":\"$D10\"}")
CT1=$(jget "$CT1R" id)
CT2R=$(api POST /api/tasks "{\"project_id\":1,\"section_id\":2,\"name\":\"E2E作成日過去\",\"start_on\":\"$D10\",\"due_on\":\"$D10\"}")
CT2=$(jget "$CT2R" id)
db_sql -q -c "UPDATE tasks SET created_at = now() - interval '10 days' WHERE id=$CT2;"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=calendar&month=${D10:0:7}&created=today" -o "$TMPD/ccreate.html"
grep -Eq "data-calendar-(multiday|single)=\"$CT1\"" "$TMPD/ccreate.html" && ! grep -Eq "data-calendar-(multiday|single)=\"$CT2\"" "$TMPD/ccreate.html" && ok "calendar created date" || bad "calendar created date"
purge_task "$CT1" >/dev/null
purge_task "$CT2" >/dev/null
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/sadd.html"
grep -q 'data-sidebar-add-project' "$TMPD/sadd.html" && ok "sidebar add project" || bad "sidebar add project"
grep -q 'data-sidebar-footer' "$TMPD/sadd.html" && grep -q 'data-sidebar-user-menu' "$TMPD/sadd.html" && grep -q 'data-sidebar-help' "$TMPD/sadd.html" && grep -q 'data-theme-toggle' "$TMPD/sadd.html" && grep -q 'data-sidebar-invite' "$TMPD/sadd.html" && ! grep -q 'data-sidebar-rail' "$TMPD/sadd.html" && ok "sidebar footer controls" || bad "sidebar footer controls"
cp "$JAR" "$TMPD/jar-collapsed"
printf '127.0.0.1\tFALSE\t/\tFALSE\t0\tatlas_sidebar\tcollapsed\n' >> "$TMPD/jar-collapsed"
curl -s -m 15 -b "$TMPD/jar-collapsed" "$BASE/projects/1?view=list" -o "$TMPD/scollapse.html"
grep -q 'サイドバーを展開' "$TMPD/scollapse.html" && grep -q 'data-sidebar-rail-actions' "$TMPD/scollapse.html" && grep -q 'data-command-palette-open' "$TMPD/scollapse.html" && grep -q 'data-sidebar-rail-footer' "$TMPD/scollapse.html" && ! grep -q 'data-sidebar-footer' "$TMPD/scollapse.html" && ! grep -q 'data-sidebar-actions' "$TMPD/scollapse.html" && ! grep -q 'data-sidebar-add-project' "$TMPD/scollapse.html" && ok "sidebar collapsed SSR" || bad "sidebar collapsed SSR"
grep -q 'data-sidebar-rail-footer' "$TMPD/scollapse.html" && grep -q 'data-sidebar-user-menu' "$TMPD/scollapse.html" && grep -q 'data-sidebar-help' "$TMPD/scollapse.html" && grep -q 'data-theme-toggle' "$TMPD/scollapse.html" && ! grep -q 'data-sidebar-invite' "$TMPD/scollapse.html" && ok "collapsed rail footer" || bad "collapsed rail footer"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=calendar&zoom=week&week=bogus" -o "$TMPD/cw2.html"
grep -q '2026年' "$TMPD/cw2.html" && ok "week fallback" || bad "week fallback"

echo "== reactions =="
R=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/comments/1/reactions" -H 'Content-Type: application/json' -d '{"emoji":"👍"}')
echo "$R" | grep -q '"added":true' && ok "react on" || bad "react on ($R)"
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM comment_reactions WHERE comment_id=1 AND user_id=1 AND emoji='👍';")
[[ "$N" == "1" ]] && ok "reaction stored" || bad "reaction stored ($N)"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list&task=2" -o "$TMPD/react-pane.html"
grep -q 'data-comment-reaction="👍"' "$TMPD/react-pane.html" && grep -q 'aria-pressed="true"' "$TMPD/react-pane.html" && ok "reaction markup" || bad "reaction markup"
R=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/comments/1/reactions" -H 'Content-Type: application/json' -d '{"emoji":"👍"}')
echo "$R" | grep -q '"added":false' && ok "react off" || bad "react off ($R)"
C=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/comments/1/reactions" -H 'Content-Type: application/json' -d '{"emoji":""}' -o /dev/null -w "%{http_code}")
[[ "$C" == "400" ]] && ok "react validation" || bad "react validation ($C)"

echo "== favorites =="
R=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/favorites" -H 'Content-Type: application/json' -d '{"project_id":1}')
[[ "$R" == *'"starred":true'* ]] && ok "star on" || bad "star on ($R)"
curl -s -m 10 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/fv.html"
grep -q 'お気に入り' "$TMPD/fv.html" && ok "sidebar fav" || bad "sidebar fav"
R=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/favorites" -H 'Content-Type: application/json' -d '{"project_id":1}')
[[ "$R" == *'"starred":false'* ]] && ok "star off" || bad "star off ($R)"

echo "== recents =="
db_sql -t -c "DELETE FROM user_recent_projects;" >/dev/null
curl -s -m 10 -b "$JAR" "$BASE/projects/1?view=list" -o /dev/null
curl -s -m 10 -b "$JAR" "$BASE/" -o "$TMPD/rct.html"
grep -q '最近開いた項目' "$TMPD/rct.html" && grep -q 'デモプロジェクト' "$TMPD/rct.html" && ok "recents shown" || bad "recents"
db_sql -t -c "DELETE FROM user_recent_projects;" >/dev/null

echo "== dashboard prefs =="
curl -s -m 10 -b "$JAR" -X PUT "$BASE/api/dashboard-prefs" -H 'Content-Type: application/json' -d '{"project_id":1,"widgets":[{"key":"overdue","visible":true},{"key":"donut","visible":false}]}' -o "$TMPD/dbp.json"
python3 -c "import json, sys; d=json.load(open(sys.argv[1])); assert len(d['widgets'])==6 and d['widgets'][0]['key']=='overdue', d" "$TMPD/dbp.json" && ok "prefs save+normalize" || bad "prefs save"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=dashboard" -o "$TMPD/dbp.html"
python3 -c "
import re, sys
h=open(sys.argv[1]).read()
txt=re.sub(r'<!--.*?-->','',h)
assert '期限超過' in txt and '進捗率' not in txt, 'order/visibility'
print('prefs applied ok')
" "$TMPD/dbp.html" && ok "prefs applied" || bad "prefs applied"
curl -s -m 10 -b "$JAR" -X PUT "$BASE/api/dashboard-prefs" -H 'Content-Type: application/json' -d '{"project_id":1,"widgets":[{"key":"donut","visible":true},{"key":"trend","visible":true},{"key":"sections","visible":true},{"key":"assignees","visible":true},{"key":"status","visible":true},{"key":"overdue","visible":true}]}' -o /dev/null
db_sql -t -c "DELETE FROM dashboard_prefs;" >/dev/null

echo "== dashboard widgets =="
R=$(api POST /api/projects/1/dashboard/widgets '{"title":"E2Eダッシュボード","widget_type":"chart","chart_type":"bar","group_by":"section","metric":"count","filters":{"completion":"open"},"options":{"data_labels":true}}')
WID=$(echo "$R" | python3 -c "import json,sys; d=json.load(sys.stdin); print([w['id'] for w in d.get('widgets',[]) if w['title']=='E2Eダッシュボード'][0] if any(w['title']=='E2Eダッシュボード' for w in d.get('widgets',[])) else '')")
[[ -n "$WID" ]] && ok "dashboard widget create" || bad "dashboard widget create" "$R"
R=$(api PATCH /api/projects/1/dashboard/widgets/$WID '{"title":"E2Eダッシュボード改","chart_type":"donut","options":{"data_labels":true}}')
[[ "$R" == *'"title":"E2Eダッシュボード改"'* && "$R" == *'"chart_type":"donut"'* ]] && ok "dashboard widget update" || bad "dashboard widget update" "$R"
curl -s -m 10 -b "$JAR" "$BASE/projects/1?view=dashboard" -o "$TMPD/dbw.html"
grep -q 'data-dashboard-widget-title="E2Eダッシュボード改"' "$TMPD/dbw.html" && ok "dashboard widget rendered" || bad "dashboard widget rendered"
R=$(api DELETE /api/projects/1/dashboard/widgets/$WID)
echo "$R" | python3 -c "import json,sys; d=json.load(sys.stdin); assert not any(w['title']=='E2Eダッシュボード改' for w in d['widgets']), d" && ok "dashboard widget delete" || bad "dashboard widget delete" "$R"
R=$(api POST /api/projects/1/dashboard/widgets '{"title":"E2Eダッシュボードメモ","widget_type":"text","body":"E2E本文"}')
TID=$(echo "$R" | python3 -c "import json,sys; d=json.load(sys.stdin); print([w['id'] for w in d.get('widgets',[]) if w['title']=='E2Eダッシュボードメモ'][0] if any(w['title']=='E2Eダッシュボードメモ' for w in d.get('widgets',[])) else '')")
[[ -n "$TID" ]] && ok "dashboard text widget create" || bad "dashboard text widget create" "$R"
curl -s -m 10 -b "$JAR" "$BASE/projects/1?view=dashboard" -o "$TMPD/dbwt.html"
grep -q 'data-dashboard-widget-title="E2Eダッシュボードメモ"' "$TMPD/dbwt.html" && grep -q 'E2E本文' "$TMPD/dbwt.html" && ok "dashboard text rendered" || bad "dashboard text rendered"
api DELETE /api/projects/1/dashboard/widgets/$TID >/dev/null
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM project_dashboard_widgets WHERE project_id=1 AND (title LIKE 'E2Eダッシュボード%');")
[[ "$N" == "0" ]] && ok "dashboard widgets cleaned" || bad "dashboard widgets cleaned ($N)"

echo "== view state persistence =="
EMPTY_EXPECTED=$(db_sql -t -A -c "SELECT COUNT(*) FROM tasks WHERE project_id=1 AND parent_task_id IS NULL AND assignee_id IS NULL AND completed=false AND deleted_at IS NULL;")
api PUT /api/view-state '{"project_id":1,"view":"list","state":{"hide_completed":true,"assignee":"none","status":"","due":"","sort":"name","sortdir":"desc","group":"assignee"}}' >/dev/null
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/vs-list.html"
grep -q 'data-list-group="assignee"' "$TMPD/vs-list.html" && grep -q 'data-list-assignee="none"' "$TMPD/vs-list.html" && grep -q 'data-list-hide-completed="true"' "$TMPD/vs-list.html" && [[ "$(grep -o 'data-list-row="[0-9]*"' "$TMPD/vs-list.html" | wc -l | tr -d ' ')" == "$EMPTY_EXPECTED" ]] && ok "view state list applied" || bad "view state list applied (expected $EMPTY_EXPECTED)"
api PUT /api/view-state '{"project_id":1,"view":"board","state":{"group":"status","hide_completed":true,"assignee":"none","status":"","sort":"name","sortdir":"asc"}}' >/dev/null
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=board" -o "$TMPD/vs-board.html"
grep -q 'data-board-group="status"' "$TMPD/vs-board.html" && grep -q 'data-board-assignee="none"' "$TMPD/vs-board.html" && [[ "$(grep -o 'data-board-card="[0-9]*"' "$TMPD/vs-board.html" | wc -l | tr -d ' ')" == "$EMPTY_EXPECTED" ]] && ok "view state board independent" || bad "view state board independent (expected $EMPTY_EXPECTED)"
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/vs-list2.html"
grep -q 'data-list-group="assignee"' "$TMPD/vs-list2.html" && [[ "$(grep -o 'data-list-row="[0-9]*"' "$TMPD/vs-list2.html" | wc -l | tr -d ' ')" == "$EMPTY_EXPECTED" ]] && ok "view state list retained after board" || bad "view state list retained (expected $EMPTY_EXPECTED)"
api PUT /api/view-state '{"project_id":1,"view":"timeline","state":{"zoom":3,"hide_completed":true,"assignee":"all","sort":"name","weekends":false,"dependencies":false,"critical":false}}' >/dev/null
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=timeline" -o "$TMPD/vs-tl.html"
grep -q 'data-timeline-zoom="3"' "$TMPD/vs-tl.html" && grep -q 'data-timeline-weekends="false"' "$TMPD/vs-tl.html" && grep -q 'data-timeline-dependencies="false"' "$TMPD/vs-tl.html" && ok "view state timeline applied" || bad "view state timeline applied"
api PUT /api/view-state '{"project_id":1,"view":"list","state":{}}' >/dev/null
api PUT /api/view-state '{"project_id":1,"view":"board","state":{}}' >/dev/null
api PUT /api/view-state '{"project_id":1,"view":"timeline","state":{}}' >/dev/null
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/vs-reset.html"
grep -q 'data-list-group="section"' "$TMPD/vs-reset.html" && grep -q 'data-list-hide-completed="false"' "$TMPD/vs-reset.html" && ok "view state reset" || bad "view state reset"

echo "== help and out-of-office =="
curl -s -m 15 -b "$JAR" "$BASE/help" -o "$TMPD/help.html"
grep -q 'data-help-page' "$TMPD/help.html" && grep -q 'data-help-section="integrations"' "$TMPD/help.html" && grep -q 'data-help-section="privacy"' "$TMPD/help.html" && grep -q 'data-help-section="shortcuts"' "$TMPD/help.html" && ok "help page" || bad "help page"
D0=$(python3 -c "import datetime; print(datetime.date.today().isoformat())")
D2=$(python3 -c "import datetime; print((datetime.date.today()+datetime.timedelta(days=2)).isoformat())")
R=$(api PATCH /api/me/out-of-office "{\"from\":\"$D0\",\"to\":\"$D2\",\"note\":\"E2E不在\"}")
[[ "$(jget "$R" from)" == "$D0" ]] && ok "out-of-office save" || bad "out-of-office save" "$R"
curl -s -m 15 -b "$JAR" "$BASE/" -o "$TMPD/ooo-home.html"
grep -q "data-user-out-of-office=\"不在: $D0 〜 $D2\"" "$TMPD/ooo-home.html" && ok "out-of-office rendered" || bad "out-of-office rendered"
N=$(db_sql -t -A -c "SELECT out_of_office_from::text||'/'||out_of_office_to::text||'/'||out_of_office_note FROM users WHERE id=1;")
[[ "$N" == "$D0/$D2/E2E不在" ]] && ok "out-of-office db" || bad "out-of-office db ($N)"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/me/out-of-office" -H 'Content-Type: application/json' -d "{\"from\":\"$D2\",\"to\":\"$D0\"}")
[[ "$C" == "400" ]] && ok "out-of-office range validation" || bad "out-of-office range validation ($C)"
R=$(api PATCH /api/me/out-of-office '{"from":null,"to":null,"note":""}')
curl -s -m 15 -b "$JAR" "$BASE/" -o "$TMPD/ooo-cleared.html"
grep -q 'data-user-out-of-office=""' "$TMPD/ooo-cleared.html" && ok "out-of-office cleared" || bad "out-of-office cleared"

echo "== overview parity =="
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=overview" -o "$TMPD/ov.html"
grep -q 'data-overview-hero' "$TMPD/ov.html" && grep -q 'data-overview-status-option="順調"' "$TMPD/ov.html" && grep -q 'data-project-description' "$TMPD/ov.html" && grep -q 'data-project-activity' "$TMPD/ov.html" && grep -q 'data-project-share' "$TMPD/ov.html" && ok "overview hero/description/activity" || bad "overview hero/description/activity"
grep -q 'data-project-activity-item=' "$TMPD/ov.html" && ok "overview activity feed" || bad "overview activity feed"
R=$(api PATCH /api/projects/1 '{"description":"E2E概要説明 **太字**"}')
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=overview" -o "$TMPD/ov-desc.html"
grep -q 'E2E概要説明' "$TMPD/ov-desc.html" && grep -q '<strong>太字</strong>' "$TMPD/ov-desc.html" && ok "overview description rendered" || bad "overview description rendered"
R=$(api PATCH /api/projects/1 '{"status":"順調","status_color":"green"}')
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=overview" -o "$TMPD/ov-status.html"
grep -q 'data-overview-status-current="順調"' "$TMPD/ov-status.html" && ok "overview status quick update" || bad "overview status quick update"
api PATCH /api/projects/1 '{"name":"デモプロジェクト","description":"","status":"active","status_color":"none"}' >/dev/null

echo "== timezone boundary =="
curl -s -m 15 -b "$JAR" "$BASE/api/time?at=2026-11-06T14:59:59Z" -o "$TMPD/tz1.json"
python3 -c "import json; d=json.load(open('$TMPD/tz1.json')); assert d['today']=='2026-11-06', d" && ok "JST before boundary" || bad "JST before boundary"
curl -s -m 15 -b "$JAR" "$BASE/api/time?at=2026-11-06T15:00:00Z" -o "$TMPD/tz2.json"
python3 -c "import json; d=json.load(open('$TMPD/tz2.json')); assert d['today']=='2026-11-07', d" && ok "JST after boundary" || bad "JST after boundary"
curl -s -m 15 -b "$JAR" "$BASE/api/time" -o "$TMPD/tz3.json"
python3 -c "import json; d=json.load(open('$TMPD/tz3.json')); assert d['today']==d['db_today'] and d['session_timezone']=='Asia/Tokyo', d" && ok "JST app/db agree" || bad "JST app/db agree"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" "$BASE/api/time?at=not-a-date")
[[ "$C" == "400" ]] && ok "timezone validation" || bad "timezone validation ($C)"

echo "== unicode long names =="
D0=$(python3 -c "import datetime; print(datetime.date.today().isoformat())")
N1=$(python3 -c "print('E2E長い名前'+'あ'*120)")
N2=$(python3 -c "print('E2E🚀👩‍🚀'+'🚀'*20)")
N3="E2Eمهمة طويلة جداً لاختبار الاتجاه"
python3 - "$N1" "$D0" > "$TMPD/n1.json" <<'PYEOF'
import json,sys
print(json.dumps({"project_id":1,"section_id":2,"name":sys.argv[1],"assignee_id":1,"due_on":sys.argv[2]}))
PYEOF
python3 - "$N2" "$D0" > "$TMPD/n2.json" <<'PYEOF'
import json,sys
print(json.dumps({"project_id":1,"section_id":2,"name":sys.argv[1],"assignee_id":1,"due_on":sys.argv[2]}))
PYEOF
python3 - "$N3" "$D0" > "$TMPD/n3.json" <<'PYEOF'
import json,sys
print(json.dumps({"project_id":1,"section_id":2,"name":sys.argv[1],"assignee_id":1,"due_on":sys.argv[2]}))
PYEOF
U1=$(api POST /api/tasks "$(cat "$TMPD/n1.json")"); U1ID=$(jget "$U1" id)
U2=$(api POST /api/tasks "$(cat "$TMPD/n2.json")"); U2ID=$(jget "$U2" id)
U3=$(api POST /api/tasks "$(cat "$TMPD/n3.json")"); U3ID=$(jget "$U3" id)
for view in list board timeline calendar; do
  curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=$view" -o "$TMPD/uni-$view.html"
done
curl -s -m 15 -b "$JAR" "$BASE/my-tasks" -o "$TMPD/uni-my.html"
UNI=1
for f in "$TMPD/uni-list.html" "$TMPD/uni-board.html" "$TMPD/uni-timeline.html" "$TMPD/uni-calendar.html" "$TMPD/uni-my.html"; do
  grep -q 'dir="auto"' "$f" || UNI=0
  grep -q '__next_error__' "$f" && UNI=0
done
[[ "$UNI" == "1" ]] && ok "unicode dir/title across views" || bad "unicode dir/title across views"
grep -q 'line-clamp-2' "$TMPD/uni-board.html" && grep -q "title=\"$N1\"" "$TMPD/uni-board.html" && ok "long name wrap/tooltip" || bad "long name wrap/tooltip"
for id in $U1ID $U2ID $U3ID; do purge_task "$id" >/dev/null; done
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM tasks WHERE id IN ($U1ID,$U2ID,$U3ID);")
[[ "$N" == "0" ]] && ok "unicode fixtures cleaned" || bad "unicode fixtures cleaned ($N)"

echo "== profile =="
R=$(curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/me" -H 'Content-Type: application/json' -d '{"name":"E2E管理者"}')
[[ "$R" == *'E2E管理者'* ]] && ok "rename" || bad "rename ($R)"
C=$(curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/me" -H 'Content-Type: application/json' -d '{"current_password":"wrong","new_password":"newpass123"}' -o /dev/null -w "%{http_code}")
[[ "$C" == "401" ]] && ok "wrong current 401" || bad "wrong current ($C)"
C=$(curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/me" -H 'Content-Type: application/json' -d '{"current_password":"atlas-dev-2026","new_password":"e2e-rotated"}' -o /dev/null -w "%{http_code}")
[[ "$C" == "200" ]] && ok "password change" || bad "password change ($C)"
C=$(curl -s -m 10 -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"e2e-rotated"}' -o /dev/null -w "%{http_code}")
[[ "$C" == "200" ]] && ok "login with new" || bad "login with new ($C)"
curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/me" -H 'Content-Type: application/json' -d '{"name":"管理者","current_password":"e2e-rotated","new_password":"atlas-dev-2026"}' -o /dev/null
curl -s -m 10 -b "$JAR" "$BASE/profile" -o "$TMPD/pf.html"
grep -q 'パスワード変更' "$TMPD/pf.html" && ok "profile page" || bad "profile page"

echo "== admin =="
C=$(curl -s -m 10 -b "$TMPD/jar2" -o /dev/null -w "%{http_code}" "$BASE/api/admin/users")
[[ "$C" == "403" ]] && ok "non-admin forbidden" || bad "non-admin ($C)"
U=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/admin/users" -H 'Content-Type: application/json' -d '{"name":"E2E新人","email":"e2e-new@example.com","password":"e2e-pass1"}')
NUID=$(echo "$U" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
[[ -n "$NUID" ]] && ok "user create ($NUID)" || bad "user create ($U)"
C=$(curl -s -m 10 -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"e2e-new@example.com","password":"e2e-pass1"}' -o /dev/null -w "%{http_code}")
[[ "$C" == "200" ]] && ok "login as new" || bad "login as new ($C)"
C=$(curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/admin/users/1" -H 'Content-Type: application/json' -d '{"is_admin":false}' -o /dev/null -w "%{http_code}")
[[ "$C" == "400" ]] && ok "self-demote guard" || bad "self-demote ($C)"
curl -s -m 10 -b "$JAR" -X DELETE "$BASE/api/admin/users/$NUID" -o /dev/null
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM users;")
[[ "$N" == "4" ]] && ok "user delete" || bad "user delete ($N)"

echo "== admin console: workspace / teams / roles / SAML =="
R=$(api PATCH /api/admin/workspace '{"name":"E2E組織"}')
[[ "$R" == *'"name":"E2E組織"'* ]] && ok "org rename" || bad "org rename" "$R"
R=$(api PATCH /api/admin/workspace '{"name":"Atlas Demo"}')
[[ "$R" == *'"name":"Atlas Demo"'* ]] && ok "org rename restore" || bad "org rename restore" "$R"
R=$(api POST /api/admin/teams '{"name":"E2E管理チーム","privacy":"private","members":[{"user_id":2,"role":"manager"}]}')
TTID=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('team',{}).get('id',''))")
[[ -n "$TTID" ]] && ok "team create" || bad "team create" "$R"
R=$(api PATCH /api/admin/teams/$TTID '{"name":"E2E管理チーム改","members":[{"user_id":1,"role":"manager"}]}')
[[ "$R" == *'"name":"E2E管理チーム改"'* ]] && ok "team update" || bad "team update" "$R"
R=$(api DELETE /api/admin/teams/$TTID)
[[ "$R" != *'"error"'* ]] && ok "team delete" || bad "team delete" "$R"
R=$(api POST /api/admin/roles '{"name":"E2E管理ロール","base_level":"member","permissions":["projects.create"]}')
RRID=$(echo "$R" | python3 -c "import json,sys; d=json.load(sys.stdin); print([r['id'] for r in d.get('roles',[]) if r['name']=='E2E管理ロール'][0] if any(r['name']=='E2E管理ロール' for r in d.get('roles',[])) else '')")
[[ -n "$RRID" ]] && ok "role create" || bad "role create" "$R"
R=$(api PATCH /api/admin/roles/$RRID '{"name":"E2E管理ロール改","base_level":"admin","permissions":["teams.manage"]}')
[[ "$R" == *'"name":"E2E管理ロール改"'* ]] && ok "role update" || bad "role update" "$R"
R=$(api DELETE /api/admin/roles/$RRID)
[[ "$R" != *'"error"'* ]] && ok "role delete" || bad "role delete" "$R"
C=$(curl -s -m 10 -b "$JAR" -o "$TMPD/saml.xml" -w "%{http_code}" "$BASE/api/auth/saml/metadata")
[[ "$C" == "200" ]] && grep -q 'EntityDescriptor' "$TMPD/saml.xml" && ok "saml metadata" || bad "saml metadata ($C)"
db_sql -q -c "DELETE FROM teams WHERE name LIKE 'E2E管理チーム%'; DELETE FROM workspace_roles WHERE name LIKE 'E2E管理ロール%'; UPDATE workspaces SET name='Atlas Demo' WHERE id=1;" >/dev/null

echo "== project members & roles =="
MP=$(api POST /api/projects '{"workspace_id":1,"name":"E2Eメンバー管理"}')
MPID=$(jget "$MP" id)
R=$(api GET /api/projects/$MPID/members)
echo "$R" | python3 -c "import json,sys; d=json.load(sys.stdin); m={x['id']:x['role'] for x in d['members']}; assert m.get(1)=='admin' and d.get('can_manage') is True, d" && ok "creator is project admin" || bad "creator project admin" "$R"
MU=$(api POST /api/admin/users '{"name":"E2Eロール","email":"e2e-role@example.com","password":"e2e-pass1","role":"member"}')
MNUID=$(jget "$MU" id)
[[ -n "$MNUID" ]] && ok "role test user create" || bad "role test user create" "$MU"
JARV="$TMPD/jar-v"
curl -s -m 10 -c "$JARV" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"e2e-role@example.com","password":"e2e-pass1"}' -o /dev/null
curl -s -m 10 -b "$JARV" -o "$TMPD/nonmember.html" "$BASE/projects/$MPID?view=list"
grep -q 'data-not-found' "$TMPD/nonmember.html" && ok "non-member project denied" || bad "non-member project"
R=$(api POST /api/projects/$MPID/members "{\"user_id\":$MNUID,\"role\":\"viewer\"}")
[[ "$R" == *viewer* ]] && ok "member add viewer" || bad "member add viewer" "$R"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" "$BASE/projects/$MPID?view=list")
[[ "$C" == "200" ]] && ok "member can view project" || bad "member view project ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d "{\"project_id\":$MPID,\"name\":\"x\"}")
[[ "$C" == "403" ]] && ok "viewer cannot create task" || bad "viewer create task ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/projects/$MPID/members" -H 'Content-Type: application/json' -d "{\"user_id\":2,\"role\":\"viewer\"}")
[[ "$C" == "403" ]] && ok "viewer cannot add member" || bad "viewer add member ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/custom-fields" -H 'Content-Type: application/json' -d "{\"project_id\":$MPID,\"name\":\"E2E権限\",\"field_type\":\"text\"}")
[[ "$C" == "403" ]] && ok "viewer cannot create custom field" || bad "viewer create field ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/task-templates" -H 'Content-Type: application/json' -d "{\"project_id\":$MPID,\"name\":\"E2E権限\",\"title_template\":\"x\"}")
[[ "$C" == "403" ]] && ok "viewer cannot create template" || bad "viewer create template ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" "$BASE/api/custom-fields?project_id=$MPID")
[[ "$C" == "200" ]] && ok "viewer can read custom fields" || bad "viewer read fields ($C)"
AF=$(api POST /api/custom-fields "{\"project_id\":$MPID,\"name\":\"E2E権限PATCH\",\"field_type\":\"text\"}")
AFID=$(jget "$AF" id)
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/custom-fields/$AFID" -H 'Content-Type: application/json' -d '{"name":"x"}')
[[ "$C" == "403" ]] && ok "viewer cannot patch custom field" || bad "viewer patch field ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/custom-fields/$AFID")
[[ "$C" == "403" ]] && ok "viewer cannot delete custom field" || bad "viewer delete field ($C)"
api DELETE /api/custom-fields/$AFID >/dev/null
AT=$(api POST /api/task-templates "{\"project_id\":$MPID,\"name\":\"E2E権限T\",\"title_template\":\"x\"}")
ATID=$(jget "$AT" id)
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/task-templates/$ATID" -H 'Content-Type: application/json' -d '{"name":"x"}')
[[ "$C" == "403" ]] && ok "viewer cannot patch template" || bad "viewer patch template ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/task-templates/$ATID")
[[ "$C" == "403" ]] && ok "viewer cannot delete template" || bad "viewer delete template ($C)"
api DELETE /api/task-templates/$ATID >/dev/null
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/knowledge" -H 'Content-Type: application/json' -d "{\"project_id\":$MPID,\"title\":\"E2E権限\",\"body\":\"x\"}")
[[ "$C" == "403" ]] && ok "viewer cannot create knowledge" || bad "viewer create knowledge ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" "$BASE/api/knowledge?project_id=$MPID")
[[ "$C" == "200" ]] && ok "viewer can read knowledge" || bad "viewer read knowledge ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/project-tabs" -H 'Content-Type: application/json' -d "{\"project_id\":$MPID,\"name\":\"E2E権限\",\"view_type\":\"list\"}")
[[ "$C" == "403" ]] && ok "viewer cannot create tab" || bad "viewer create tab ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" "$BASE/api/project-tabs?project_id=$MPID")
[[ "$C" == "200" ]] && ok "viewer can read tabs" || bad "viewer read tabs ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/forms" -H 'Content-Type: application/json' -d "{\"project_id\":$MPID,\"name\":\"E2E権限\",\"fields\":[{\"label\":\"タスク名\",\"type\":\"text\"}]}")
[[ "$C" == "403" ]] && ok "viewer cannot create form" || bad "viewer create form ($C)"
MF=$(api POST /api/forms "{\"project_id\":$MPID,\"name\":\"E2E回答フォーム\",\"fields\":[{\"key\":\"title\",\"label\":\"タスク名\",\"type\":\"text\",\"required\":true}]}")
MFID=$(jget "$MF" id)
api PATCH /api/forms/$MFID '{"published":true}' >/dev/null
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/forms/$MFID/submit" -H 'Content-Type: application/json' -d '{"answers":{"title":"E2Eビューア回答"}}')
[[ "$C" == "201" ]] && ok "viewer can submit form" || bad "viewer submit form ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" "$BASE/api/projects/$MPID/email")
[[ "$C" == "200" ]] && ok "viewer can read project email" || bad "viewer read project email ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/projects/$MPID/email" -H 'Content-Type: application/json' -d '{"enabled":false}')
[[ "$C" == "403" ]] && ok "viewer cannot update project email" || bad "viewer update project email ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/projects/$MPID/email/intake" -H 'Content-Type: application/json' -d '{"subject":"x"}')
[[ "$C" == "403" ]] && ok "viewer cannot intake email" || bad "viewer intake email ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" "$BASE/api/projects/$MPID/apps")
[[ "$C" == "200" ]] && ok "viewer can read apps" || bad "viewer read apps ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/projects/$MPID/apps" -H 'Content-Type: application/json' -d '{"app_key":"webhook","config":{"url":"https://example.com/x"}}')
[[ "$C" == "403" ]] && ok "viewer cannot install app" || bad "viewer install app ($C)"
VA=$(api POST /api/projects/$MPID/apps '{"app_key":"slack","config":{"channel":"#e2e"}}')
VAID=$(jget "$VA" id)
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/projects/$MPID/apps/$VAID" -H 'Content-Type: application/json' -d '{"enabled":false}')
[[ "$C" == "403" ]] && ok "viewer cannot update app" || bad "viewer update app ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/projects/$MPID/apps/$VAID")
[[ "$C" == "403" ]] && ok "viewer cannot remove app" || bad "viewer remove app ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/bundles" -H 'Content-Type: application/json' -d '{"workspace_id":1,"name":"E2E権限","fields":[{"name":"x","field_type":"text"}]}')
[[ "$C" == "403" ]] && ok "viewer cannot create bundle" || bad "viewer create bundle ($C)"
VB=$(api POST /api/bundles '{"workspace_id":1,"name":"E2E権限バンドル","fields":[{"name":"E2E権限フィールド","field_type":"text"}]}')
VBID=$(jget "$VB" id)
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/bundles/$VBID/apply" -H 'Content-Type: application/json' -d "{\"project_id\":$MPID}")
[[ "$C" == "403" ]] && ok "viewer cannot apply bundle" || bad "viewer apply bundle ($C)"
api DELETE /api/bundles/$VBID >/dev/null
MA=$(api POST /api/projects/$MPID/automations '{"name":"E2E権限ルール","trigger":"task_created","action_type":"set_status","action_value":"未着手"}')
MAID=$(jget "$MA" id)
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" "$BASE/api/projects/$MPID/automations")
[[ "$C" == "200" ]] && ok "viewer can read automations" || bad "viewer read automations ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/projects/$MPID/automations" -H 'Content-Type: application/json' -d '{"name":"x","trigger":"task_created","action_type":"set_status","action_value":"未着手"}')
[[ "$C" == "403" ]] && ok "viewer cannot create automation" || bad "viewer create automation ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/projects/$MPID/automations/$MAID" -H 'Content-Type: application/json' -d '{"enabled":false}')
[[ "$C" == "403" ]] && ok "viewer cannot update automation" || bad "viewer update automation ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/projects/$MPID/automations/$MAID")
[[ "$C" == "403" ]] && ok "viewer cannot delete automation" || bad "viewer delete automation ($C)"
MT=$(api POST /api/tasks "{\"project_id\":$MPID,\"name\":\"E2Eメンバー課題\"}")
MTID=$(jget "$MT" id)
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/comments" -H 'Content-Type: application/json' -d "{\"task_id\":$MTID,\"body\":\"viewer comment\"}")
[[ "$C" == "403" ]] && ok "viewer cannot comment" || bad "viewer comment ($C)"
R=$(api PATCH /api/projects/$MPID/members/$MNUID '{"role":"commenter"}')
[[ "$R" == *commenter* ]] && ok "member role commenter" || bad "member role commenter" "$R"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/comments" -H 'Content-Type: application/json' -d "{\"task_id\":$MTID,\"body\":\"commenter ok\"}")
[[ "$C" == "201" ]] && ok "commenter can comment" || bad "commenter comment ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d "{\"project_id\":$MPID,\"name\":\"x\"}")
[[ "$C" == "403" ]] && ok "commenter cannot create task" || bad "commenter create task ($C)"
R=$(api PATCH /api/projects/$MPID/members/$MNUID '{"role":"editor"}')
[[ "$R" == *editor* ]] && ok "member role editor" || bad "member role editor" "$R"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d "{\"project_id\":$MPID,\"name\":\"E2E editor task\"}")
[[ "$C" == "201" ]] && ok "editor can create task" || bad "editor create task ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/projects/$MPID" -H 'Content-Type: application/json' -d '{"name":"x"}')
[[ "$C" == "200" ]] && ok "editor can configure project by default" || bad "editor default project patch ($C)"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/projects/$MPID" -H 'Content-Type: application/json' -d '{"settings":{"who_can_edit":"admins"}}')
[[ "$C" == "200" ]] && ok "admin restricts project configuration" || bad "admin restrict project configuration ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/projects/$MPID" -H 'Content-Type: application/json' -d '{"name":"x"}')
[[ "$C" == "403" ]] && ok "editor cannot configure admins-only project" || bad "editor admins-only project patch ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/projects/$MPID" -H 'Content-Type: application/json' -d '{"settings":{"who_can_edit":"editors"}}')
[[ "$C" == "403" ]] && ok "editor cannot unlock project permissions" || bad "editor unlock project permissions ($C)"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/projects/$MPID" -H 'Content-Type: application/json' -d '{"settings":{"who_can_edit":"editors"}}')
[[ "$C" == "200" ]] && ok "admin restores editor configuration policy" || bad "admin restore editor configuration policy ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/projects/$MPID" -H 'Content-Type: application/json' -d '{"name":"x"}')
[[ "$C" == "200" ]] && ok "editor can configure after policy restoration" || bad "editor restored project patch ($C)"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/projects/$MPID/members/1")
[[ "$C" == "400" ]] && ok "last admin guard" || bad "last admin guard ($C)"
R=$(api DELETE /api/projects/$MPID/members/$MNUID)
[[ "$R" == *removed* ]] && ok "member remove" || bad "member remove" "$R"
curl -s -m 10 -b "$JARV" -o "$TMPD/removed-member.html" "$BASE/projects/$MPID?view=list"
grep -q 'data-not-found' "$TMPD/removed-member.html" && ok "removed member denied" || bad "removed member project"
R=$(curl -s -m 10 -b "$JARV" -X PATCH "$BASE/api/me" -H 'Content-Type: application/json' -d '{"name":"E2Eロール改","email":"e2e-role2@example.com","title":"PM","avatar_url":"https://example.com/a.png"}')
echo "$R" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['name']=='E2Eロール改' and d['email']=='e2e-role2@example.com' and d['title']=='PM' and d['avatar_url'].endswith('a.png'), d" && ok "profile fields" || bad "profile fields" "$R"
C=$(curl -s -m 10 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"e2e-role2@example.com","password":"e2e-pass1"}')
[[ "$C" == "200" ]] && ok "login with new email" || bad "login new email ($C)"
C=$(curl -s -m 10 -b "$JARV" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/me" -H 'Content-Type: application/json' -d '{"email":"admin@example.com"}')
[[ "$C" == "409" ]] && ok "duplicate email guard" || bad "duplicate email ($C)"
R=$(api PATCH /api/admin/users/$MNUID '{"role":"guest"}')
[[ "$R" == *'"is_guest":true'* ]] && ok "admin role guest" || bad "admin role guest" "$R"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/admin/users/$MNUID" -H 'Content-Type: application/json' -d '{"role":"bogus"}')
[[ "$C" == "400" ]] && ok "invalid role guard" || bad "invalid role ($C)"
purge_task "$MTID" >/dev/null
api DELETE "/api/projects/$MPID" >/dev/null
api DELETE "/api/admin/users/$MNUID" >/dev/null
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM users WHERE email LIKE 'e2e-role%';")
[[ "$N" == "0" ]] && ok "role test cleanup" || bad "role test cleanup ($N)"

echo "== invitations & deactivation =="
INV=$(api POST /api/admin/invitations '{"email":"e2e-invite@example.com","role":"guest"}')
ITOK=$(echo "$INV" | python3 -c "import json,sys; print(json.load(sys.stdin).get('invitation',{}).get('token',''))")
IURL=$(echo "$INV" | python3 -c "import json,sys; print(json.load(sys.stdin).get('invitation',{}).get('url',''))")
[[ -n "$ITOK" && "$IURL" == *"/invite/$ITOK"* ]] && ok "invitation create" || bad "invitation create" "$INV"
C=$(curl -s -m 10 -o "$TMPD/invite.html" -w "%{http_code}" "$BASE/invite/$ITOK")
[[ "$C" == "200" ]] && ok "invite page public" || bad "invite page ($C)"
R=$(curl -s -m 10 "$BASE/api/invitations/$ITOK")
[[ "$R" == *'"role":"guest"'* && "$R" == *'"workspace_name"'* ]] && ok "invitation lookup" || bad "invitation lookup" "$R"
R=$(curl -s -m 10 -X POST "$BASE/api/invitations/$ITOK" -H 'Content-Type: application/json' -d '{"name":"E2E招待","password":"e2e-pass1"}')
IUID=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))")
[[ -n "$IUID" ]] && ok "invitation accept" || bad "invitation accept" "$R"
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM users WHERE id=$IUID AND email='e2e-invite@example.com' AND is_guest AND NOT is_admin;")
[[ "$N" == "1" ]] && ok "invited user role" || bad "invited user role ($N)"
C=$(curl -s -m 10 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"e2e-invite@example.com","password":"e2e-pass1"}')
[[ "$C" == "200" ]] && ok "invited user login" || bad "invited user login ($C)"
C=$(curl -s -m 10 -o /dev/null -w "%{http_code}" "$BASE/api/invitations/$ITOK")
[[ "$C" == "410" ]] && ok "invitation single-use" || bad "invitation reuse ($C)"
DU=$(api POST /api/admin/users '{"name":"E2E停止","email":"e2e-deactivate@example.com","password":"e2e-pass1","role":"member"}')
DNUID=$(jget "$DU" id)
JARD="$TMPD/jar-d"
curl -s -m 10 -c "$JARD" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"e2e-deactivate@example.com","password":"e2e-pass1"}' -o /dev/null
R=$(api PATCH /api/admin/users/$DNUID '{"deactivated":true}')
[[ "$R" == *'"deactivated_at":"'* ]] && ok "user deactivate" || bad "user deactivate" "$R"
C=$(curl -s -m 10 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"e2e-deactivate@example.com","password":"e2e-pass1"}')
[[ "$C" == "403" ]] && ok "deactivated login blocked" || bad "deactivated login ($C)"
C=$(curl -s -m 10 -b "$JARD" -o /dev/null -w "%{http_code}" "$BASE/api/me")
[[ "$C" == "404" ]] && ok "deactivated session blocked" || bad "deactivated session ($C)"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/admin/users/1" -H 'Content-Type: application/json' -d '{"deactivated":true}')
[[ "$C" == "400" ]] && ok "self-deactivate guard" || bad "self-deactivate ($C)"
R=$(api PATCH /api/admin/users/$DNUID '{"deactivated":false}')
[[ "$R" == *'"deactivated_at":null'* ]] && ok "user reactivate" || bad "user reactivate" "$R"
C=$(curl -s -m 10 -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"e2e-deactivate@example.com","password":"e2e-pass1"}')
[[ "$C" == "200" ]] && ok "reactivated login" || bad "reactivated login ($C)"
api DELETE /api/admin/users/$IUID >/dev/null
api DELETE /api/admin/users/$DNUID >/dev/null
db_sql -t -c "DELETE FROM invitations WHERE email='e2e-invite@example.com';" >/dev/null
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM users WHERE email IN ('e2e-invite@example.com','e2e-deactivate@example.com');")
[[ "$N" == "0" ]] && ok "invite/deactivate cleanup" || bad "invite/deactivate cleanup ($N)"

echo "== usage stats =="
curl -s -m 10 -b "$JAR" "$BASE/api/admin/stats" -o "$TMPD/us.json"
python3 -c "import json; d=json.load(open('$TMPD/us.json')); assert len(d['created'])==14 and len(d['completed'])==14 and len(d['comments'])==14, d" && ok "usage series" || bad "usage series"
rm -f "$TMPD/jarx"
curl -s -m 10 -c "$TMPD/jarx" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"tanaka@example.com","password":"atlas-dev-2026"}' -o /dev/null
C=$(curl -s -m 10 -b "$TMPD/jarx" -o /dev/null -w "%{http_code}" "$BASE/api/admin/stats")
[[ "$C" == "403" ]] && ok "usage forbidden" || bad "usage forbidden ($C)"

echo "== audit export =="
T=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d '{"project_id":1,"section_id":3,"name":"E2E監査EX"}')
TID=$(echo "$T" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
curl -s -m 15 -b "$JAR" "$BASE/api/admin/audit/export?format=json" -o "$TMPD/ax.json"
python3 -c "import json; d=json.load(open('$TMPD/ax.json')); assert any(r['action']=='task.create' for r in d['rows']), d" && ok "audit json" || bad "audit json"
curl -s -m 15 -b "$JAR" "$BASE/api/admin/audit/export?format=csv" -o "$TMPD/ax.csv"
python3 -c "import csv; rows=list(csv.reader(open('$TMPD/ax.csv', encoding='utf-8-sig'))); assert len(rows)>=2 and rows[0][0]=='id', rows[0]" && ok "audit csv" || bad "audit csv"
purge_task "$TID" >/dev/null

echo "== trash retention =="
T=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d '{"project_id":1,"section_id":3,"name":"E2E古ゴミ"}')
TID=$(echo "$T" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
curl -s -m 10 -b "$JAR" -X DELETE "$BASE/api/tasks/$TID" -o /dev/null
db_sql -t -c "UPDATE tasks SET deleted_at = NOW() - interval '31 days' WHERE id = $TID;" >/dev/null
bash scripts/janitor.sh 90 90 30 >/dev/null || e2e_abort 'test janitor failed'
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM tasks WHERE id = $TID;")
[[ "$N" == "0" ]] && ok "old trash purged" || bad "old trash kept ($N)"

echo "== optimistic locking =="
STAMP=$(db_sql -t -A -c "SELECT updated_at::text FROM tasks WHERE id = 2;")
C=$(curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/2" -H 'Content-Type: application/json' -d '{"progress":21,"expected_updated_at":"2000-01-01 00:00:00+00"}' -o /dev/null -w "%{http_code}")
[[ "$C" == "409" ]] && ok "stale conflict 409" || bad "stale conflict ($C)"
C=$(curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/2" -H 'Content-Type: application/json' -d "{\"progress\":21,\"expected_updated_at\":\"$STAMP\"}")
[[ "$C" == *'"id":2'* ]] && ok "fresh stamp 200" || bad "fresh stamp ($C)"
S2=$(curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/2" -H 'Content-Type: application/json' -d '{"progress":22,"expected_updated_at":"2000-01-01 00:00:00+00"}')
echo "$S2" | grep -q '"current"' && echo "$S2" | grep -q '"progress":21' && ok "409 carries snapshot" || bad "409 snapshot ($S2)"
NS=$(echo "$S2" | python3 -c "import json,sys; print(json.load(sys.stdin)['updated_at'])")
C=$(curl -s -m 10 -b "$JAR" -X PATCH "$BASE/api/tasks/2" -H 'Content-Type: application/json' -d "{\"progress\":22,\"expected_updated_at\":\"$NS\"}")
[[ "$C" == *'"id":2'* ]] && ok "overwrite with snapshot stamp" || bad "overwrite ($C)"
api PATCH /api/tasks/2 '{"progress":20}' >/dev/null

echo "== websocket live =="
node --input-type=module -e "
const login = await (await fetch('$BASE/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email:'admin@example.com', password:'atlas-dev-2026'})}));
const cookie = login.headers.get('set-cookie').split(';')[0];
const wsUrl = new URL('/api/ws?project=1', '$BASE');
wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(wsUrl, {headers: {Cookie: cookie, Origin: new URL('$BASE').origin}});
const got = await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('timeout')), 15000);
  ws.onopen = async () => {
    await fetch('$BASE/api/tasks', {method:'POST', headers:{'Content-Type':'application/json', Cookie: cookie}, body: JSON.stringify({project_id:1, section_id:3, name:'E2E WS用'})});
  };
  ws.onmessage = (ev) => { clearTimeout(to); resolve(String(ev.data)); };
  ws.onerror = () => reject(new Error('ws-error'));
});
if (!got.includes('invalidate')) { console.error('unexpected:', got); process.exit(1); }
console.log('invalidate pushed:', got);
ws.close();
" && ok "ws invalidate" || bad "ws invalidate"
db_sql -t -c "DELETE FROM tasks WHERE name='E2E WS用';" >/dev/null
node --input-type=module -e "
const denied = await new Promise((resolve) => {
  const wsUrl = new URL('/api/ws?project=1', '$BASE');
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(wsUrl);
  ws.onopen = () => resolve('open-unexpected');
  ws.onerror = () => resolve('denied');
  setTimeout(() => resolve('timeout'), 8000);
});
if (denied !== 'denied') { console.error(denied); process.exit(1); }
console.log('unauth ws denied');
" && ok "ws auth gate" || bad "ws auth gate"

echo "== trash/restore =="
T=$(curl -s -m 10 -b "$JAR" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d '{"project_id":1,"section_id":2,"name":"E2Eゴミ箱"}')
TID=$(echo "$T" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
curl -s -m 10 -b "$JAR" -X DELETE "$BASE/api/tasks/$TID" -o /dev/null
curl -s -m 10 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/tr.html"
grep -q '>E2Eゴミ箱<' "$TMPD/tr.html" && bad "soft-deleted hidden" || ok "soft-deleted hidden"
curl -s -m 10 -b "$JAR" "$BASE/trash" -o "$TMPD/trash.html"
grep -q 'E2Eゴミ箱' "$TMPD/trash.html" && ok "trash lists" || bad "trash lists"
curl -s -m 10 -b "$JAR" -X POST "$BASE/api/tasks/$TID/restore" -o /dev/null
curl -s -m 10 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/tr2.html"
grep -q '>E2Eゴミ箱<' "$TMPD/tr2.html" && ok "restored visible" || bad "restored visible"
purge_task "$TID" >/dev/null
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM tasks WHERE id = $TID;")
[[ "$N" == "0" ]] && ok "purged" || bad "purge ($N left)"

echo "== large project rendering =="
LP=$(api POST /api/projects '{"workspace_id":1,"name":"E2E大量データ"}')
LPID=$(jget "$LP" id)
LS=$(api POST /api/sections "{\"project_id\":$LPID,\"name\":\"Bulk\"}")
LSID=$(jget "$LS" id)
db_sql -q -c "INSERT INTO tasks (project_id, section_id, name, status, position, created_by) SELECT $LPID, $LSID, 'Bulk '||i, '未着手', i*1000, 1 FROM generate_series(1,150) i;"
curl -s -m 15 -b "$JAR" "$BASE/projects/$LPID?view=list" -o "$TMPD/large-list.html"
curl -s -m 15 -b "$JAR" "$BASE/projects/$LPID?view=board" -o "$TMPD/large-board.html"
grep -q 'data-list-show-more' "$TMPD/large-list.html" && grep -q 'data-board-show-more' "$TMPD/large-board.html" && ok "large project pagination" || bad "large project pagination"
R=$(api DELETE /api/projects/$LPID)
[[ "$(jget "$R" deleted)" == "$LPID" ]] && ok "large project cleaned" || bad "large project cleaned" "$R"

echo "== empty/loading/error states =="
[[ ! -f app/loading.tsx ]] && grep -q 'useLinkStatus' components/NavPending.tsx && grep -q 'data-nav-pending' components/NavPending.tsx && grep -q 'data-error-retry' components/ErrorState.tsx && grep -q 'data-not-found' app/not-found.tsx && ok "navigation pending + error/not-found files" || bad "navigation pending + error/not-found files"
curl -s -m 15 -b "$JAR" "$BASE/projects/999999" -o "$TMPD/nf.html"
grep -q 'data-not-found' "$TMPD/nf.html" && ok "not-found page" || bad "not-found page"
EP=$(api POST /api/projects '{"workspace_id":1,"name":"E2E空状態"}')
EPID=$(jget "$EP" id)
curl -s -m 15 -b "$JAR" "$BASE/projects/$EPID?view=list" -o "$TMPD/emptyp.html"
grep -q 'data-empty-state="list"' "$TMPD/emptyp.html" && grep -q 'タスクがありません' "$TMPD/emptyp.html" && ok "empty project state" || bad "empty project state"
ALLVIEWS=1
for v in overview dashboard list board timeline calendar messages knowledge files forms; do
  curl -s -m 15 -b "$JAR" "$BASE/projects/$EPID?view=$v" -o "$TMPD/v04-$v.html"
  grep -q "data-project-view=\"$v\"" "$TMPD/v04-$v.html" || ALLVIEWS=0
  grep -q '__next_error__' "$TMPD/v04-$v.html" && ALLVIEWS=0
done
[[ "$ALLVIEWS" == "1" ]] && ok "all project views render" || bad "all project views render"
EMPTYVIEWS=1
for v in dashboard list board timeline messages files forms; do
  grep -q "data-empty-state=\"$v\"" "$TMPD/v04-$v.html" || EMPTYVIEWS=0
done
grep -q 'ノートはまだありません' "$TMPD/v04-knowledge.html" || EMPTYVIEWS=0
grep -q 'data-calendar-day=' "$TMPD/v04-calendar.html" || EMPTYVIEWS=0
[[ "$EMPTYVIEWS" == "1" ]] && ok "empty states across views" || bad "empty states across views"
[[ ! -f 'app/projects/[id]/loading.tsx' ]] && grep -q 'ErrorState' 'app/projects/[id]/error.tsx' && grep -q 'import ListView from "@/components/ListView"' 'app/projects/[id]/page.tsx' && grep -q 'dynamic(() => import("../BoardView"))' components/project/LazyViews.tsx && grep -q 'dynamic(() => import("../TimelineView"))' components/project/LazyViews.tsx && ok "project error boundary + view code splitting" || bad "project error boundary + view code splitting"
R=$(api DELETE /api/projects/$EPID)
[[ "$(jget "$R" deleted)" == "$EPID" ]] && ok "empty project cleaned" || bad "empty project cleaned" "$R"

echo "== project actions =="
curl -s -m 15 -b "$JAR" "$BASE/projects/1?view=list" -o "$TMPD/actions-header.html"
grep -q 'data-project-actions-button' "$TMPD/actions-header.html" && grep -q 'aria-label="プロジェクトのアクション"' "$TMPD/actions-header.html" && grep -q 'aria-haspopup="menu"' "$TMPD/actions-header.html" && ok "project actions button markup" || bad "project actions button markup"

AP=$(api POST /api/projects '{"workspace_id":1,"name":"E2Eアクション元"}')
APID=$(jget "$AP" id)
AS=$(api POST /api/sections "{\"project_id\":$APID,\"name\":\"アクションセクション\"}")
ASID=$(jget "$AS" id)
AT=$(api POST /api/tasks "{\"project_id\":$APID,\"section_id\":$ASID,\"name\":\"アクション対象タスク\"}")
ATID=$(jget "$AT" id)
AN=$(api POST /api/tasks "{\"project_id\":$APID,\"name\":\"アクション未分類タスク\"}")
ANID=$(jget "$AN" id)
AF=$(api POST /api/custom-fields "{\"project_id\":$APID,\"name\":\"アクションフィールド\",\"field_type\":\"text\"}")
AFID=$(jget "$AF" id)
api POST /api/task-values "{\"task_id\":$ATID,\"field_id\":$AFID,\"value\":\"アクション値\"}" >/dev/null
R=$(api GET "/api/projects/$APID/settings")
echo "$R" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['project']['settings']['dependency_buffer']=='buffer', d" && ok "project settings defaults" || bad "project settings defaults" "$R"
R=$(api PATCH "/api/projects/$APID" '{"owner_id":1,"due_on":"2026-12-31","settings":{"dependency_buffer":"fill","work_days":[1,2,3,4],"work_hours":{"start":"10:00","end":"19:00"},"notifications":{"email":false,"in_app":true,"slack":false,"teams":false},"who_can_edit":"admins","who_can_share":"editors"}}')
[[ "$(jget "$R" id)" == "$APID" ]] && ok "project settings patch" || bad "project settings patch" "$R"
R=$(api GET "/api/projects/$APID/settings")
echo "$R" | python3 -c "import json,sys; d=json.load(sys.stdin); s=d['project']['settings']; assert s['dependency_buffer']=='fill' and s['work_days']==[1,2,3,4] and s['who_can_edit']=='admins' and d['project']['due_on']=='2026-12-31', d" && ok "project settings persisted" || bad "project settings persisted" "$R"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/projects/$APID" -H 'Content-Type: application/json' -d '{"due_on":"2026-99-99"}')
[[ "$C" == "400" ]] && ok "project due date validation" || bad "project due date validation ($C)"

DUP=$(api POST "/api/projects/$APID/duplicate" '{"name":"E2Eアクション複製","include_tasks":true,"include_fields":true,"include_members":true}')
DPID=$(jget "$DUP" id)
[[ -n "$DPID" ]] && ok "project duplicate api" || bad "project duplicate api" "$DUP"
N=$(db_sql -t -A -c "SELECT (SELECT COUNT(*) FROM sections WHERE project_id=$DPID AND name='アクションセクション')||'/'||(SELECT COUNT(*) FROM tasks WHERE project_id=$DPID AND name='アクション対象タスク')||'/'||(SELECT COUNT(*) FROM custom_fields WHERE project_id=$DPID AND name='アクションフィールド');")
[[ "$N" == "1/1/1" ]] && ok "project duplicate copies structure" || bad "project duplicate copies structure ($N)"
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM tasks t JOIN task_custom_values v ON v.task_id=t.id WHERE t.project_id=$DPID AND v.value_text='アクション値';")
[[ "$N" == "1" ]] && ok "project duplicate copies field values" || bad "project duplicate copies field values ($N)"

TPL=$(api POST "/api/projects/$APID/template" '{"name":"E2Eアクションテンプレート","include_tasks":true,"include_completed":false,"include_custom_fields":true}')
TPLID=$(jget "$TPL" id)
[[ -n "$TPLID" ]] && ok "project template save" || bad "project template save" "$TPL"
TP=$(api POST "/api/project-templates/$TPLID" '{"name":"E2Eテンプレート作成"}')
TPID=$(jget "$TP" id)
[[ -n "$TPID" ]] && ok "project template instantiate" || bad "project template instantiate" "$TP"
N=$(db_sql -t -A -c "SELECT (SELECT COUNT(*) FROM tasks WHERE project_id=$TPID AND name='アクション対象タスク')||'/'||(SELECT COUNT(*) FROM tasks WHERE project_id=$TPID AND name='アクション未分類タスク')||'/'||(SELECT COUNT(*) FROM custom_fields WHERE project_id=$TPID AND name='アクションフィールド')||'/'||(SELECT COUNT(*) FROM sections WHERE project_id=$TPID AND name='未分類');")
[[ "$N" == "1/1/1/1" ]] && ok "project template copies tasks, unsectioned tasks and fields" || bad "project template copies tasks, unsectioned tasks and fields ($N)"

for fmt in csv xlsx json timecsv ical; do
  C=$(curl -s -m 15 -b "$JAR" -o "$TMPD/action-export-$fmt" -w "%{http_code}" "$BASE/api/projects/$APID/export?format=$fmt")
  SIZE=$(wc -c < "$TMPD/action-export-$fmt" | tr -d ' ')
  [[ "$C" == "200" && "$SIZE" -gt 10 ]] && ok "project export $fmt" || bad "project export $fmt ($C/$SIZE)"
done
head -c 2 "$TMPD/action-export-xlsx" | grep -q 'PK' && ok "project export xlsx zip magic" || bad "project export xlsx zip magic"
grep -q 'BEGIN:VCALENDAR' "$TMPD/action-export-ical" && ok "project export ical body" || bad "project export ical body"
grep -q 'アクションセクション' "$TMPD/action-export-csv" && ok "project export csv body" || bad "project export csv body"
page "/projects/$APID/print" "$TMPD/action-print.html"
grep -q 'data-print-view' "$TMPD/action-print.html" && grep -q 'アクション対象タスク' "$TMPD/action-print.html" && grep -q 'アクション未分類タスク' "$TMPD/action-print.html" && ok "project print view" || bad "project print view"

TBL=$(api POST "/api/projects/$APID/table" '{"name":"E2Eアクションテーブル","include_tasks":true}')
TBLID=$(jget "$TBL" id)
[[ -n "$TBLID" ]] && ok "project table create" || bad "project table create" "$TBL"
echo "$TBL" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['name']=='E2Eアクションテーブル' and d['row_count']>=1, d" && ok "project table snapshot" || bad "project table snapshot" "$TBL"
page "/tables/$TBLID" "$TMPD/action-table.html"
grep -q 'data-project-table="' "$TMPD/action-table.html" && grep -q 'アクション対象タスク' "$TMPD/action-table.html" && ok "project table page" || bad "project table page"
for fmt in csv xlsx; do
  C=$(curl -s -m 15 -b "$JAR" -o "$TMPD/table-export-$fmt" -w "%{http_code}" "$BASE/api/tables/$TBLID/export?format=$fmt")
  SIZE=$(wc -c < "$TMPD/table-export-$fmt" | tr -d ' ')
  [[ "$C" == "200" && "$SIZE" -gt 10 ]] && ok "project table export $fmt" || bad "project table export $fmt ($C/$SIZE)"
done

TR=$(api POST "/api/projects/$APID/trash")
[[ "$(jget "$TR" trashed)" == "$APID" ]] && ok "project trash" || bad "project trash" "$TR"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" "$BASE/api/projects/$APID/settings")
[[ "$C" == "404" ]] && ok "trashed project api hidden" || bad "trashed project api hidden ($C)"
curl -s -m 15 -b "$JAR" "$BASE/trash" -o "$TMPD/trash-project.html"
grep -q 'E2Eアクション元' "$TMPD/trash-project.html" && grep -q 'data-deleted-projects' "$TMPD/trash-project.html" && ok "trash lists projects" || bad "trash lists projects"
R=$(api POST "/api/projects/$APID/restore")
[[ "$(jget "$R" restored)" == "$APID" ]] && ok "project restore" || bad "project restore" "$R"
page "/projects/$APID?view=list" "$TMPD/action-restored.html"
grep -q 'E2Eアクション元' "$TMPD/action-restored.html" && ok "restored project page" || bad "restored project page"

echo "== project delete multi-home safety =="
MA=$(api POST /api/projects '{"workspace_id":1,"name":"E2E削除A"}')
MAID=$(jget "$MA" id)
MB=$(api POST /api/projects '{"workspace_id":1,"name":"E2E削除B"}')
MBID=$(jget "$MB" id)
MSA=$(api POST /api/sections "{\"project_id\":$MAID,\"name\":\"Aセクション\"}")
MSAID=$(jget "$MSA" id)
MSB=$(api POST /api/sections "{\"project_id\":$MBID,\"name\":\"Bセクション\"}")
MSBID=$(jget "$MSB" id)
MT=$(api POST /api/tasks "{\"project_id\":$MAID,\"section_id\":$MSAID,\"name\":\"E2E削除マルチホーム\"}")
MTID=$(jget "$MT" id)
MST=$(api POST /api/tasks "{\"project_id\":$MAID,\"section_id\":$MSAID,\"parent_task_id\":$MTID,\"name\":\"E2E削除サブタスク\"}")
MSTID=$(jget "$MST" id)
api POST /api/memberships "{\"task_id\":$MTID,\"project_id\":$MBID,\"section_id\":$MSBID}" >/dev/null
MDUP=$(api POST "/api/projects/$MBID/duplicate" '{"name":"E2E削除複製","include_tasks":true,"include_subtasks":true}')
MDUPID=$(jget "$MDUP" id)
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM tasks WHERE project_id=$MDUPID AND name IN ('E2E削除マルチホーム','E2E削除サブタスク');")
[[ "$N" == "2" ]] && ok "multi-homed duplicate keeps subtask tree" || bad "multi-homed duplicate keeps subtask tree ($N)"
MTPL=$(api POST "/api/projects/$MBID/template" '{"name":"E2E削除テンプレート"}')
MTPLID=$(jget "$MTPL" id)
MTP=$(api POST "/api/project-templates/$MTPLID" '{"name":"E2E削除テンプレート先"}')
MTPID=$(jget "$MTP" id)
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM tasks WHERE project_id=$MTPID AND name IN ('E2E削除マルチホーム','E2E削除サブタスク');")
[[ "$N" == "2" ]] && ok "multi-homed template keeps subtask tree" || bad "multi-homed template keeps subtask tree ($N)"
R=$(api POST "/api/projects/$MAID/trash")
[[ "$(jget "$R" moved_tasks)" == "1" ]] && ok "project trash moves multi-homed tasks" || bad "project trash moves multi-homed tasks" "$R"
page "/projects/$MBID?view=list" "$TMPD/mh-kept.html"
grep -q 'E2E削除マルチホーム' "$TMPD/mh-kept.html" && ok "multi-homed task kept in other project" || bad "multi-homed task kept in other project"
N=$(db_sql -t -A -c "SELECT project_id FROM tasks WHERE id=$MTID;")
[[ "$N" == "$MBID" ]] && ok "multi-homed task reparented" || bad "multi-homed task reparented ($N)"
N=$(db_sql -t -A -c "SELECT project_id FROM tasks WHERE id=$MSTID;")
[[ "$N" == "$MBID" ]] && ok "multi-homed subtask follows parent" || bad "multi-homed subtask follows parent ($N)"
api POST "/api/projects/$MAID/restore" >/dev/null

# Cleanup all fixtures created above (hard delete keeps the suite self-cleaning).
for pid in $APID $DPID $TPID $MAID $MBID $MDUPID $MTPID; do api DELETE "/api/projects/$pid" >/dev/null; done
db_sql -q -c "DELETE FROM project_templates WHERE id IN ($TPLID,$MTPLID);"

echo "== theme =="
curl -s -m 15 -b "$JAR" -b 'atlas_theme=dark' "$BASE/projects/1?view=list" -o "$TMPD/dark.html"
grep -q 'data-theme="dark"' "$TMPD/dark.html" && grep -q 'data-theme-toggle' "$TMPD/dark.html" && ok "dark theme SSR" || bad "dark theme SSR"
curl -s -m 15 -b "$JAR" -b 'atlas_theme=light' "$BASE/projects/1?view=list" -o "$TMPD/light.html"
grep -q 'data-theme="light"' "$TMPD/light.html" && ok "light theme SSR" || bad "light theme SSR"
grep -q 'data-theme-state="light"' "$TMPD/light.html" && grep -q 'aria-label="ダークモードに切り替える"' "$TMPD/light.html" && ok "theme toggle control" || bad "theme toggle control"
curl -s -m 15 -b "$JAR" -b 'atlas_theme=dark' "$BASE/projects/1?view=list&task=2" -o "$TMPD/darkpane.html"
grep -q 'data-theme="dark"' "$TMPD/darkpane.html" && grep -q 'aria-label="タスク詳細"' "$TMPD/darkpane.html" && ok "dark task pane" || bad "dark task pane"
curl -s -m 15 -b "$JAR" -b 'atlas_theme=dark' "$BASE/projects/1?view=forms" -o "$TMPD/darkforms.html"
grep -q 'data-theme="dark"' "$TMPD/darkforms.html" && grep -q 'data-forms' "$TMPD/darkforms.html" && ok "dark forms render" || bad "dark forms render"

echo "== project context menu APIs =="
R=$(api POST /api/projects '{"workspace_id":1,"name":"E2E右クリック"}')
PID=$(jget "$R" id)
[[ -n "$PID" ]] && ok "ctx project create" || bad "ctx project create ($R)"
R=$(api PATCH "/api/projects/$PID" '{"name":"E2E右クリック改"}')
curl -s -m 10 -b "$JAR" "$BASE/projects/$PID?view=list" -o "$TMPD/ctx.html"
grep -q 'E2E右クリック改' "$TMPD/ctx.html" && ok "ctx rename" || bad "ctx rename"
R=$(api PATCH "/api/projects/$PID" '{"color":"#8db8ff","icon":"target"}')
N=$(db_sql -t -A -c "SELECT color||'/'||icon FROM projects WHERE id=$PID;")
[[ "$N" == "#8db8ff/target" ]] && ok "ctx color+icon" || bad "ctx color+icon ($N)"
C=$(curl -s -m 10 -b "$JAR" -o /dev/null -w "%{http_code}" "$BASE/api/projects/$PID" -X PATCH -H 'Content-Type: application/json' -d '{"color":"red"}')
[[ "$C" == "400" ]] && ok "ctx invalid color 400" || bad "ctx invalid color ($C)"
R=$(api PATCH "/api/projects/$PID" '{"archived":true}')
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM projects WHERE id=$PID AND archived_at IS NOT NULL;")
[[ "$N" == "1" ]] && ok "ctx archive" || bad "ctx archive ($N)"
curl -s -m 10 -b "$JAR" "$BASE/projects/$PID?view=list" -o "$TMPD/ctx-arch.html"
grep -q 'E2E右クリック改' "$TMPD/ctx-arch.html" && ok "archived project still opens" || bad "archived project page"
api PATCH "/api/projects/$PID" '{"archived":false}' >/dev/null
R=$(api POST /api/favorites "{\"project_id\":$PID}")
[[ "$R" == *'"starred":true'* ]] && ok "ctx favorite on" || bad "ctx favorite on ($R)"
R=$(api GET /api/favorites)
[[ "$R" == *"\"id\":$PID"* ]] && ok "ctx favorite listed" || bad "ctx favorite list"
R=$(api POST /api/favorites "{\"project_id\":$PID}")
[[ "$R" == *'"starred":false'* ]] && ok "ctx favorite off" || bad "ctx favorite off ($R)"
R=$(api POST /api/portfolio "{\"project_id\":$PID}")
[[ "$R" == *'"added":true'* ]] && ok "ctx portfolio add" || bad "ctx portfolio add ($R)"
R=$(api GET /api/portfolio)
[[ "$R" == *"\"id\":$PID"* ]] && ok "ctx portfolio listed" || bad "ctx portfolio list"
R=$(api DELETE /api/portfolio "{\"project_id\":$PID}")
[[ "$R" == *'"removed":true'* ]] && ok "ctx portfolio remove" || bad "ctx portfolio remove ($R)"
R=$(api POST "/api/projects/$PID/share" '{"label":"E2E右クリック共有","expires_in_days":7}')
TOKID=$(jget "$R" id)
TOKEN=$(jget "$R" token)
[[ -n "$TOKEN" ]] && ok "ctx share create" || bad "ctx share create ($R)"
C=$(curl -s -m 10 -o /dev/null -w "%{http_code}" "$BASE/share/$TOKEN")
[[ "$C" == "200" ]] && ok "ctx share page" || bad "ctx share page ($C)"
api DELETE "/api/projects/$PID/share?token_id=$TOKID" >/dev/null
BODY=$(curl -s -m 10 "$BASE/share/$TOKEN")
[[ -n "$BODY" && "$BODY" == *"data-not-found"* ]] && ok "ctx share revoked" || bad "ctx share revoked"
api DELETE "/api/projects/$PID" >/dev/null
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM projects WHERE id=$PID;")
[[ "$N" == "0" ]] && ok "ctx project cleaned" || bad "ctx cleanup ($N)"

echo "== api authorization matrix =="
db_sql -q -c "DELETE FROM users WHERE email='e2e-matrix-viewer@example.com';"
MXU=$(api POST /api/admin/users '{"name":"E2E Matrix Viewer","email":"e2e-matrix-viewer@example.com","password":"e2e-pass1","role":"member"}')
MXUID=$(jget "$MXU" id)
api POST /api/projects/1/members "{\"user_id\":$MXUID,\"role\":\"viewer\"}" >/dev/null
JARV2="$TMPD/jar-v2"
curl -s -m 10 -c "$JARV2" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"e2e-matrix-viewer@example.com","password":"e2e-pass1"}' -o /dev/null
JARE="$TMPD/jar-e"
curl -s -m 10 -c "$JARE" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"tanaka@example.com","password":"atlas-dev-2026"}' -o /dev/null
NP=$(api POST /api/projects '{"workspace_id":1,"name":"E2E Matrix Private"}')
NPID=$(jget "$NP" id)

VR=1
for endpoint in "api/messages?project_id=1" "api/projects/1/export?format=json" "api/projects/1/dashboard/export?format=json" "api/lookup?project_id=1" "api/saved-views?project_id=1" "api/dashboard-prefs?project_id=1"; do
  C=$(curl -s -m 10 -b "$JARV2" -o /dev/null -w "%{http_code}" "$BASE/$endpoint")
  [[ "$C" == "200" ]] || { VR=0; echo "viewer read $endpoint -> $C"; }
done
[[ "$VR" == "1" ]] && ok "viewer read matrix" || bad "viewer read matrix"

VW=1
check_forbidden() { # method endpoint data
  local method="$1" endpoint="$2" data="${3:-}"
  local code
  if [[ -n "$data" ]]; then
    code=$(curl -s -m 10 -b "$JARV2" -o /dev/null -w "%{http_code}" -X "$method" "$BASE$endpoint" -H 'Content-Type: application/json' -d "$data")
  else
    code=$(curl -s -m 10 -b "$JARV2" -o /dev/null -w "%{http_code}" -X "$method" "$BASE$endpoint")
  fi
  [[ "$code" == "403" ]] || { VW=0; echo "viewer write $method $endpoint -> $code"; }
}
check_forbidden POST "/api/messages" '{"project_id":1,"title":"x","body":"x"}'
check_forbidden POST "/api/memberships" '{"task_id":2,"project_id":1}'
check_forbidden DELETE "/api/memberships?task_id=2&project_id=$NPID"
check_forbidden POST "/api/saved-views" '{"project_id":1,"name":"x"}'
check_forbidden GET "/api/projects/1/share"
check_forbidden POST "/api/projects/1/share" '{"label":"x"}'
check_forbidden POST "/api/projects/1/import"
check_forbidden POST "/api/project-templates" '{"project_id":1,"name":"x"}'
check_forbidden POST "/api/favorites" "{\"project_id\":$NPID}"
check_forbidden GET "/api/lookup?project_id=$NPID"
[[ "$VW" == "1" ]] && ok "viewer write matrix denied" || bad "viewer write matrix denied"

NM=1
for endpoint in "api/messages?project_id=$NPID" "api/projects/$NPID/export?format=json" "api/projects/$NPID/dashboard/export?format=json" "api/saved-views?project_id=$NPID" "api/projects/$NPID/share"; do
  C=$(curl -s -m 10 -b "$JARV2" -o /dev/null -w "%{http_code}" "$BASE/$endpoint")
  [[ "$C" == "403" ]] || { NM=0; echo "non-member $endpoint -> $C"; }
done
curl -s -m 10 -b "$JARV2" "$BASE/api/lookup" -o "$TMPD/lookup.json"
python3 -c "import json; d=json.load(open('$TMPD/lookup.json')); ids=[x['id'] for x in d]; assert 1 in ids and $NPID not in ids, ids" || NM=0
[[ "$NM" == "1" ]] && ok "non-member read matrix denied" || bad "non-member read matrix denied"

EM=1
MSG=$(curl -s -m 10 -b "$JARE" -X POST "$BASE/api/messages" -H 'Content-Type: application/json' -d '{"project_id":1,"title":"E2E Matrix Message","body":"matrix"}')
MID=$(jget "$MSG" id)
[[ -n "$MID" ]] || EM=0
SV=$(curl -s -m 10 -b "$JARE" -X POST "$BASE/api/saved-views" -H 'Content-Type: application/json' -d '{"project_id":1,"name":"E2E Matrix View"}')
SVID=$(jget "$SV" id)
[[ -n "$SVID" ]] || EM=0
C=$(curl -s -m 10 -b "$JARE" -o /dev/null -w "%{http_code}" -X PUT "$BASE/api/dashboard-prefs" -H 'Content-Type: application/json' -d '{"project_id":1,"widgets":[{"key":"donut","visible":true}]}')
[[ "$C" == "200" ]] || EM=0
C=$(curl -s -m 10 -b "$JARE" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/favorites" -H 'Content-Type: application/json' -d '{"project_id":1}')
[[ "$C" == "200" ]] || EM=0
C=$(curl -s -m 10 -b "$JARE" -o /dev/null -w "%{http_code}" "$BASE/api/projects/1/export?format=json")
[[ "$C" == "200" ]] || EM=0
PT=$(curl -s -m 10 -b "$JARE" -X POST "$BASE/api/project-templates" -H 'Content-Type: application/json' -d '{"project_id":1,"name":"E2E Matrix Template"}')
PTID=$(jget "$PT" id)
[[ -n "$PTID" ]] || EM=0
[[ "$EM" == "1" ]] && ok "editor write matrix allowed" || bad "editor write matrix allowed"
curl -s -m 10 -b "$JARE" -X POST "$BASE/api/favorites" -H 'Content-Type: application/json' -d '{"project_id":1}' -o /dev/null
api DELETE /api/saved-views/$SVID >/dev/null
db_sql -q -c "DELETE FROM project_messages WHERE id=$MID; DELETE FROM dashboard_prefs WHERE user_id=2 AND project_id=1;"

AUTHZ=1
C=$(curl -s -m 10 -b "$JARE" -o /dev/null -w "%{http_code}" -X GET "$BASE/api/projects/1/share")
[[ "$C" == "403" ]] || AUTHZ=0
C=$(curl -s -m 10 -b "$JARV2" -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/project-templates/$PTID")
[[ "$C" == "403" ]] || AUTHZ=0
C=$(curl -s -m 10 -b "$JARE" -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/project-templates/$PTID")
[[ "$C" == "403" ]] || AUTHZ=0
SH=$(api POST /api/projects/1/share '{"label":"E2E Matrix Share"}')
SHID=$(echo "$SH" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
[[ -n "$SHID" ]] || AUTHZ=0
api DELETE "/api/projects/1/share?token_id=$SHID" >/dev/null
api DELETE /api/project-templates/$PTID >/dev/null
[[ "$AUTHZ" == "1" ]] && ok "admin-only share and template delete" || bad "admin-only share and template delete"

RT=$(api POST /api/tasks '{"project_id":1,"section_id":2,"name":"E2E Matrix Restore"}')
RTID=$(jget "$RT" id)
api DELETE /api/tasks/$RTID >/dev/null
C=$(curl -s -m 10 -b "$JARV2" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tasks/$RTID/restore")
REST=1
[[ "$C" == "403" ]] || REST=0
C=$(curl -s -m 10 -b "$JARE" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/tasks/$RTID/restore")
[[ "$C" == "200" ]] || REST=0
[[ "$REST" == "1" ]] && ok "restore requires edit role" || bad "restore requires edit role"
purge_task "$RTID" >/dev/null

api DELETE "/api/projects/1/members/$MXUID" >/dev/null
api DELETE /api/admin/users/$MXUID >/dev/null
api DELETE /api/projects/$NPID >/dev/null
N=$(db_sql -t -A -c "SELECT (SELECT COUNT(*) FROM users WHERE email='e2e-matrix-viewer@example.com')||'/'||(SELECT COUNT(*) FROM projects WHERE id=$NPID);")
[[ "$N" == "0/0" ]] && ok "auth matrix cleaned" || bad "auth matrix cleaned ($N)"

db_sql -q -c "DELETE FROM project_view_states;"
db_sql -q -c "DELETE FROM search_history;"
# Clean fixtures left by an interrupted prior run so assertions stay deterministic.
db_sql -q -c "DELETE FROM users WHERE email LIKE 'e2e-%@example.com'; DELETE FROM projects WHERE name LIKE 'E2E%'; DELETE FROM project_messages WHERE title LIKE '[自動]%'; DELETE FROM tasks WHERE project_id=1 AND (name LIKE 'E2E%' OR name LIKE 'フォローアップ: E2E%');"
db_sql -q -c "DELETE FROM sections WHERE project_id=1 AND name LIKE 'E2E%';"
db_sql -q -c "DELETE FROM custom_fields WHERE deleted_at IS NOT NULL AND name LIKE 'E2E%';"
echo "== seed invariants =="
# Allow legitimate user-added tasks; verify the core seed rows themselves and
# that no E2E fixture rows leaked out of the suite.
N=$(db_sql -t -A -c "SELECT (SELECT COUNT(*) FROM projects WHERE id=1)||'/'||(SELECT COUNT(*) FROM tasks WHERE id BETWEEN 1 AND 7 AND deleted_at IS NULL)||'/'||(SELECT COUNT(*) FROM comments WHERE id BETWEEN 1 AND 2)||'/'||(SELECT COUNT(*) FROM sections WHERE id BETWEEN 1 AND 4);")
[[ "$N" == "1/7/2/4" ]] && ok "seed intact ($N core)" || bad "seed drift ($N)"
F=$(db_sql -t -A -c "SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL AND (name LIKE 'E2E%' OR name = '新規タスク');")
[[ "$F" == "0" ]] && ok "no e2e fixtures" || bad "e2e fixtures remain ($F)"
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM tasks WHERE deleted_at IS NOT NULL;")
[[ "$N" == "0" ]] && ok "trash empty" || bad "trash residue ($N)"
db_sql -t -c "DELETE FROM audit_log;" >/dev/null
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM audit_log;")
[[ "$N" == "0" ]] && ok "audit cleaned" || bad "audit residue ($N)"
db_sql -t -c "DELETE FROM task_events WHERE task_id NOT IN (SELECT id FROM tasks);" >/dev/null
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM task_events e LEFT JOIN tasks t ON t.id = e.task_id WHERE t.id IS NULL;")
[[ "$N" == "0" ]] && ok "orphan events cleaned" || bad "orphan events ($N)"

echo "== log retention =="
db_sql -t -c "INSERT INTO task_events (task_id, actor_id, kind, summary, created_at) VALUES (2, 1, 'completed', 'E2E古', NOW() - interval '100 days');" >/dev/null
bash scripts/janitor.sh 90 90 >/dev/null || e2e_abort 'test janitor failed'
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM task_events WHERE summary='E2E古';")
[[ "$N" == "0" ]] && ok "old purged" || bad "old kept ($N)"

echo "== backup/restore =="
bash scripts/backup.sh "$TMPD/backup" >/dev/null || e2e_abort 'test backup failed'
curl -s -m 10 -b "$JAR" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d '{"project_id":1,"section_id":3,"name":"E2E消去予定"}' -o /dev/null
bash scripts/restore.sh "$TMPD/backup" >/dev/null || e2e_abort 'test restore failed'
N=$(db_sql -t -A -c "SELECT COUNT(*) FROM tasks WHERE name='E2E消去予定';")
[[ "$N" == "0" ]] && ok "restore drops mutation" || bad "restore ($N left)"
rm -f "$TMPD/jar4"
curl -s -m 10 -c "$TMPD/jar4" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"atlas-dev-2026"}' -o /dev/null
C=$(curl -s -m 10 -b "$TMPD/jar4" -o /dev/null -w "%{http_code}" "$BASE/projects/1?view=list")
[[ "$C" == "200" ]] && ok "post-restore serving" || bad "post-restore ($C)"

echo "---- PASS=$PASS FAIL=$FAIL ----"
[[ "$FAIL" == "0" ]]
