# リファクタリング候補調査

- 対象: `/Users/tsinfra/Dev/Atlas/app`（commit `117e6a1`）
- 調査日: 2026-11-07
- 方法: 全TS/TSXの規模・状態・重複パターンの計測、72本のAPIルートと主要コンポーネントのコードリード
- この調査ではコード変更は行っていません。

## 計測サマリ

| 指標 | 値 |
|---|---:|
| TS/TSX 総行数（app / components / lib） | 25,519 |
| APIルート | 72 |
| ページ | 14 |
| コンポーネント | 63 |
| libファイル | 28 |
| `any` の使用 | 0 |
| `use client` コンポーネント | 53 |
| `router.refresh()` | 62 |
| `alert()` / `confirm()` | 52 |
| 重複したローカル `api()` ヘルパー | 11 |
| E2Eが依存する `data-*` 属性 | 349種類 |
| プロジェクト権限チェック呼び出し | 80 |
| `if (!auth.ok)` の定型ガード | 79 |
| APIルート内の生 `db.query` | 225 |
| `await req.json()` | 57（うち44は `.catch` あり） |
| `NextResponse.json` | 447 |

### 特に大きいファイル

| ファイル | 行数 | `useState` |
|---|---:|---:|
| `components/ListView.tsx` | 2,323 | 50 |
| `components/ProjectCustomizeButton.tsx` | 2,197 | 21 |
| `components/TimelineView.tsx` | 1,867 | 22 |
| `components/CalendarView.tsx` | 1,577 | 20 |
| `lib/data.ts` | 1,428 | - |
| `components/TaskPane.tsx` | 1,078 | 20 |
| `components/BoardView.tsx` | 737 | 16 |
| `components/SidebarProjectLink.tsx` | 461 | 9 |
| `app/projects/[id]/page.tsx` | 421 | - |

### テスト面の制約

- `app/` 内にユニットテストはありません。
- `tests/e2e.sh` はサーバーHTMLの文字列・`data-*` 属性を中心に検証しており、ポインタードラッグ、タッチ、リサイズの回帰は手動確認に依存しています。
- このため、日付計算・ズーム・ドラッグ・リサイズの抽出前には、先在する挙動を固定する characterization test（特性テスト）が必要です。

---

## 優先度一覧

| ID | 優先度 | 候補 | 主な対象 | 根拠 | 工数 / リスク |
|---|---|---|---|---|---|
| P0-1 | P0 | タスク認可の fail-open と移動先プロジェクト検証 | `lib/api-project-auth.ts`, `app/api/tasks/**`, `app/api/memberships`, `app/projects/[id]/page.tsx` | プロジェクト未所属タスクで認可をスキップ。PATCHで移動先の権限・section・親タスクを検証しない。`?task=` もプロジェクト外を読める | M / 中 |
| P0-2 | P0 | タスク書き込みサービス統一（楽観ロック・一括・繰り返し） | `app/api/tasks/[id]/route.ts`, `app/api/tasks/bulk/route.ts`, `lib/data.ts` | 単体・一括で繰り返し処理が重複。`expected_updated_at` を確認後に `UPDATE` のWHEREへ入れていない。一括側は自動化・監査が欠落 | L / 中 |
| P0-3 | P0 | マルチホームのセクション・集計整合 | `lib/data.ts`, `components/ListView.tsx`, `components/BoardView.tsx`, 集計/エクスポート | 一覧は `task_project_memberships` を見るが、統計・ダッシュボード・エクスポートは `tasks.project_id` のみ。セクション移動も主プロジェクト側を書き換える | M / 中 |
| P0-4 | P0 | 複数書き込みのトランザクション化 | `lib/db.ts`, `app/api/projects/route.ts`, `projects/[id]/import`, `forms/[id]/submit`, `task-templates/[id]`, `bundles/[id]/apply` | プロジェクト作成・CSV取込・フォーム回答・テンプレート展開が非アトミック。途中失敗で孤児データや半端な状態が残る | M / 中 |
| P0-5 | P0 | カスタムフィールド編集の値不一致とフィールドレジストリ | `components/ListView.tsx`, `components/TaskPane.tsx`, `lib/custom-fields.ts` | ListViewは `{value}` を読むが実データは `{value_text, value_number}`。編集・フィルタで既存値が空扱いになり、保存で上書きし得る | M / 中 |
| P1-1 | P1 | APIルート共通化（認可・404・バリデーション・エラー） | 全 `app/api/**/route.ts`, `lib/api-project-auth.ts` | 79回の定型ガード、403/404の不統一、`Number("abc")` が500化、`req.json()` の未捕捉 | M / 低 |
| P1-2 | P1 | セッション・管理者ガードの統一 | `lib/current-user.ts`, `lib/api-project-auth.ts`, admin/bundlesルート | リクエスト版はCookie不正時にユーザー1へフォールバック。管理者チェックが8箇所で再実装 | S–M / 低 |
| P1-3 | P1 | `lib/data.ts` のリポジトリ分割とタスクSELECT統一 | `lib/data.ts` | 1,428行・66関数。タスク15列のSELECTが複数箇所にコピーされ、 `getMyTasks` は `TaskRow` 必須列を欠く | L / 低–中 |
| P1-4 | P1 | クライアントAPI + mutation hook | 11コンポーネントの `api()`, 各ビューのPATCH | `api()` が11重複。409・エラー・`router.refresh()` の扱いがビューごとに異なる | S–M / 低 |
| P1-5 | P1 | project/task単位のstateスコープとview-state統一 | `app/projects/[id]/page.tsx`, List/Board/Calendar/Timeline, `lib/view-state-client.ts` | プロジェクト切替で選択・下書き・競合状態が残る可能性。Calendarだけ独自localStorage。URL再構築で `task` が消える | M / 中 |
| P1-6 | P1 | 共有タスクUIプリミティブ（完了・アバター・Status・バッジ） | Timeline/Calendar/Board/List | 完了ボタンが4実装、アバター色が3実装、Status色がハードコード。Boardの完了は非操作の `<span>` | S / 低 |
| P1-7 | P1 | Dialog / Popover / Toast の共通化 | `SidebarProjectLink`, `SidebarUserMenu`, `Shortcuts`, `ProjectCustomizeButton`, 各ビューのメニュー | 13以上の手作りオーバーレイ。Escape・フォーカス復帰・`aria-modal` の有無が不統一 | M / 中 |
| P1-8 | P1 | 大規模コンポーネントの分割 | Timeline / Calendar / List / TaskPane / ProjectCustomize | 1,000〜2,300行のコンポーネントが複数。描画・状態・API・モーダルが同居 | L / 中 |
| P2-1 | P2 | Timelineの描画モデル分離とメモ化 | `components/TimelineView.tsx` | ドラッグの毎フレームで全体を再計算。`criticalPath` を非表示時も常時計算 | S / 低 |
| P2-2 | P2 | 日付・ドラッグ・リサイズの共通カーネル | Timeline/Calendar, `lib/dates.ts`, `lib/calendar.ts`, `lib/timeline-dnd.ts` | 日付パーサが4実装、`Math.round(dx / dayWidth)` が4箇所、リサイズ処理が重複 | M / 中 |
| P2-3 | P2 | 検索ページ / SearchBox の重複解消 | `app/search/page.tsx`, `components/SearchBox.tsx` | 5種類の検索結果UIが2箇所に重複。検索ページのrender中に履歴DB書き込み | M / 中 |
| P2-4 | P2 | SQL一括化・並び替え・CSV共通化 | `tasks/bulk`, `project-tabs/reorder`, `projects/[id]`, export系 | `IN (${ids.join(",")})`、1行ずつのUPDATE、`MAX(position)+1000` の競合、`csvCell` 3重複 | S–M / 低 |
| P2-5 | P2 | ナビゲーション設定とセッションキャッシュ | `AppShell`, `SidebarNav`, `SidebarRail`, `lib/current-user.ts` | サイドバー/レール/モバイルでナビ定義が3重複。ページ毎に同一ユーザー/ワークスペースを再取得 | S–M / 低 |
| P2-6 | P2 | 空/読込/エラー状態と alert/confirm の統一 | `EmptyState`, `ErrorState`, `LoadingSkeleton`, 各ビュー | `EmptyState` の利用は8箇所に対し、インライン空状態が17箇所。52の `alert`/`confirm` | M / 中 |
| P2-7 | P2 | プロジェクトページのview別データロード | `app/projects/[id]/page.tsx` | アクティブviewに関係なく21クエリを一括実行。TaskPaneへ22 props | L / 中–高 |
| P2-8 | P2 | `SidebarProjectLink` の分割 | `components/SidebarProjectLink.tsx` | 461行にアイコン分岐・メニュー・6 API・4ダイアログ・トーストが同居。共有/外観ダイアログが重複 | M / 中 |

---

## 詳細（P0）

### P0-1. タスク認可の fail-open と移動先検証

**問題**

- `app/api/tasks/[id]/route.ts` は `getTaskProjectId` が `null` のとき認可をスキップします。プロジェクト未所属タスクを作れる現状では、任意の認証ユーザーが編集・削除できます。
- `PATCH /api/tasks/[id]` は変更前のプロジェクトだけを認可し、`project_id` / `section_id` / `parent_task_id` / `assignee_id` の移動先を検証していません。プロジェクトAの編集者が、アクセス権のないBへタスクを移動できます。
- `POST /api/memberships` は追加先Bの `edit` を見ますが、追加元Aは `view` のみです。Aの閲覧者がBのメンバーにAのタスクを見せられます。
- プロジェクトページは `?task=<id>` をパス上のプロジェクトでしか認可せず、`getTask` / `getSubtasks` / `getComments` などを無制約に読みます。
- `tasks/bulk` は最大200件について1件ずつプロジェクトを引くため、認可クエリもN+1になります。

**提案**

- `lib/services/task-access.ts`:
  - `loadTaskAccess(ids, uid)` で primary / membership / parent を1クエリにまとめる。
  - `assertTaskTargets(taskId, { projectId, sectionId, parentTaskId, assigneeId })` で移動先の権限、sectionの所属、親タスクの同一プロジェクト・循環、担当者のメンバーシップを検証。
- プロジェクト未所属タスクは「ワークスペース管理者のみ」または「404/409で拒否」のどちらかに明示的に決める。
- `getTaskForProject(viewerId, projectId, taskId)` を追加し、プロジェクトページはこれを使う。
- `memberships` の追加元は `edit` を要求する。

**効果**: クロスプロジェクト書き込み・タスク詳細リーク・孤児タスクの穴を塞ぎ、一括認可のクエリも削減できます。

### P0-2. タスク書き込みサービスの統一

**問題**

- `PATCH /api/tasks/[id]` は163行で、認可、競合スナップショット、before取得、UPDATE、再読込、繰り返しタスク生成、担当者名取得、イベント、通知、監査、自動化を1ハンドラで実行しています。
- `expected_updated_at` は読取後に比較しますが、`UPDATE tasks ... WHERE id = $n` に条件が入っていません。チェックと更新の間に割り込まれると競合を検出できません。
- 繰り返しタスクの日付計算が単体PATCHと `tasks/bulk` に重複し、一括側は自動化・監査・`recurrence_spawned` イベントが欠けています。
- `progress` / 日付 / status / assignee の値検証がありません。

**提案**

- `lib/recurrence.ts`: `nextOccurrence(dateISO, rule)` に集約（月末クランプをテスト）。
- `lib/services/tasks.ts`:
  - `patchTask(taskId, input, actor, expectedUpdatedAt)` をトランザクション化し、`UPDATE ... WHERE id = $1 AND updated_at = $2` で楽観ロックを実装。
  - `bulkTaskOp(ids, op, actor)` は対象プロジェクトを1回で検証し、`= ANY($n::bigint[])` と一括イベントINSERTを使う。
  - `createTask` / `deleteTasks` / `restoreTasks` を共通化。
- バリデーション: progress 0..100、日付形式と開始≤期日、status候補、assigneeのプロジェクトメンバーシップ。

**効果**: 単体・一括・テンプレート・インポートで挙動が揃い、競合検出が実際に機能します。

### P0-3. マルチホームの整合性

**問題**

- `getProjectTasks` は `task_project_memberships` を含めてタスクを返し、`eff_section_id` も返します。
- 一方、`getProjectStats` / `getDashboardExtras` / `getProjectActivity` / ダッシュボードexport / `getPortfolio` は `tasks.project_id = $1` のみを見ます。
- 一覧に表示されるタスクが統計・エクスポートに載らない、セクション件数が合わない、という不整合が起きます。
- `ListView` / `tasks/bulk` のセクション移動は、マルチホーム時に主プロジェクトの `tasks.section_id` を書き換えてしまいます。

**提案**

- `lib/data/project-scope.ts` に `projectTaskScope(projectId)` を定義し、一覧・統計・ダッシュボード・エクスポート・ポートフォリオで同じ条件を使う。
- セクション更新は「primaryなら `tasks.section_id`、membershipなら `task_project_memberships.section_id`」を明示的に分岐。
- マルチホームを統計に含めるかはプロダクト判断が必要なので、先に仕様を決めてテストで固定。

### P0-4. トランザクション境界

**問題**

- `lib/db.ts` は `query` と `connect` のみで、共通の `withTransaction` がありません。
- プロジェクト作成（project → member → 3 sections）、CSVインポート（最大1,000行）、フォーム送信（task → response）、テンプレート展開（task → サブタスク）、バンドル適用、ステータス一括リネームが非アトミックです。
- `import` は行ごとにエラーを握りつぶして継続するため、部分適用したまま201を返します。

**提案**

- `withTransaction<T>(fn: (q: Queryable) => Promise<T>)` を `lib/db.ts` に追加。
- サービス関数は `Queryable` を受け取れるようにし、単体実行とトランザクション内実行を両立。
- インポートは「ファイル単位でall-or-nothing」または「チャンク単位でapplied件数を返す」のどちらかに統一。
- section/task/bundleの一括作成は `INSERT ... SELECT ... FROM unnest(...)`。

### P0-5. カスタムフィールド編集の不一致

**問題**

- `CustomValue` は `{ value_text, value_number }` ですが、`ListView.customRaw` は `{ value }` を読みます。既存値が空表示になり、フィルタも一致しません。
- `ListView` のカスタムフィールド保存は `value` 文字列を送るだけで、数値/選択/テキストの型変換が場当たり的です。
- `TaskPane` は正しいフィールドを読みますが、`defaultValue` + `key={task.id}` のため、サーバー再取得後も古い値を表示し続けます。
- `TaskPane.FIELD_LABELS` に `recurrence` とカスタムフィールドがなく、競合時の試行差分から欠落します。

**提案**

- `lib/task-fields.ts` に `TaskFieldDef` レジストリを追加:
  - `key`, `label`, `kind`, `readValue`, `parseInput`, `formatValue`, `options`
- `customValueToInput()` / `customValueToString()` を `lib/custom-fields.ts` に追加。
- `useTaskFieldEditor(task, fieldDef, patch)` を共有し、ListViewのセルとTaskPaneの行は表示だけ担当。
- まず `ListView` の読み取りバグを単独修正し、回帰テストを追加してから共通化。

---

## 詳細（P1）

### P1-1. APIルート共通化

**現状**

- 80箇所で `requireProjectPermission` を呼び、79箇所で同じ `if (!auth.ok)` ガードを書いています。
- `ProjectAuth` の型は `403 | 404` ですが、実装は403しか返しません。存在しないプロジェクトと権限不足が区別できず、各ルートが存在確認を再実行しています。
- `Number("abc")` が `bigint` に渡り、PostgreSQLの `22P02` で500になります。
- 57箇所の `req.json()` のうち13箇所は未捕捉です。

**提案**

- `lib/api/errors.ts`: `ApiError { status, code, message, details }` と `jsonError`。
- `lib/api/route.ts`: `withProject(level, handler)` / `withUser(handler)` / `withAdmin(handler)`。
  - 1クエリでプロジェクト存在・メンバーシップ・ワークスペース管理者を解決。
  - 404（不存在）と403（権限不足）を分離。
  - `ApiError` とバリデーションエラーをJSONに変換。
- `lib/api/parse.ts`: `parseBody` / `parseQuery` / `parseParams` / `parseFormData`。
- zod等を入れる場合も、最初は現行動作を壊さないpermissive schemaから始める。

### P1-2. セッションと管理者ガード

**現状**

- `getCurrentUserId()` はDBで有効ユーザーを確認しますが、`getCurrentUserIdFromRequest()` はCookieの数字をそのまま返し、不正時に `DEFAULT_USER_ID = 1` へフォールバックします。
- 管理者チェックが admin/users、admin/invitations、admin/audit、admin/stats、bundles など8箇所で再実装されています。
- `requireWorkspaceAdmin` は存在しますが、利用は1ルートのみです。
- `favorites` / `saved-searches` / `inbox` / `portfolio` などは `requireActiveUser` を通りません。

**提案**

- `lib/api/session.ts` に `getSession(req)` を追加し、`{ id, isAdmin, isGuest }` をリクエスト単位でキャッシュ。
- `requireSession` / `requireAdmin` / `requireActiveUser` を薄いラッパーに。
- デモ用フォールバックは `ALLOW_DEMO_USER` などの明示フラグに隔離。
- ローカルの `requireAdmin` 5実装とインライン管理者チェック3箇所を削除。

### P1-3. `lib/data.ts` の分割

**現状**

- 1,428行・66関数が、ワークスペース、ユーザー、プロジェクト、セクション、タスク、コメント、検索、受信トレイ、設定、テンプレート、フォーム、知識、メッセージ、カスタムフィールド、添付、ポートフォリオ、保存ビュー、ダッシュボード、依存関係、ゴミ箱、お気に入り、view state、検索履歴、不在設定を担当。
- タスク15列のSELECTが `getProjectTasks` / `getMyTasks` / `getSubtasksBulk` にコピーされ、`getMyTasks` は `TaskRow` の必須列（`created_by`, `creator_name`, `completed_at`, `created_at`）を返していません。
- `getProjectStats` は5クエリを直列実行、`getDashboardExtras` は4クエリを直列実行。
- `getProjectTabs` は読み取り関数なのに、タブが無いと10件のINSERTを実行します。
- デッドコード候補: `getProjects`, `searchTasks`, `recentComments`。

**提案**

- `lib/repositories/` に `projects.ts`, `tasks.ts`, `comments.ts`, `search.ts`, `inbox.ts`, `preferences.ts`, `templates.ts` を分割。
- `lib/db/sql/tasks.ts` に `TASK_SELECT` と `toTaskRow(row)` を定義。
- `projectTaskScope(projectId)` を一覧・統計・エクスポートで共用。
- `getProjectTabs` のシード処理をプロジェクト作成時へ移し、読み取りは純粋化。
- 独立クエリは `Promise.all` で並列化。

### P1-4. クライアントAPI + mutation hook

**現状**

- 同じ9行の `api()` が11ファイルに存在。`TaskPane` は削除系のレスポンスステータスを無視するなど、微妙に挙動が異なります。
- タスクPATCHは List/Board/Calendar/Timeline/TaskPane に重複し、409時の扱いが `alert` / 無視 / 競合ダイアログでバラバラです。
- `router.refresh()` 62箇所、`alert`/`confirm` 52箇所。

**提案**

- `lib/api-client.ts`: `api<T>(path, { method, body, signal })`、`ApiError`、`patchTask(taskId, fields, updatedAt)`。
- `hooks/useMutation.ts`: `{ run, pending, error, reset }` と共通トースト。
- `TaskConflictBanner` を `TaskPane` から抽出し、List/Board/Calendarでも再利用。
- 既存APIルートは残す。サーバーアクションへの一括移行は、認可・監査・通知・409の既存資産を考えると現時点では得策ではない。

### P1-5. stateスコープとview-state統一

**現状**

- `ListView.selected` はフィルタ後の `visible` から pruneされず、一括操作が非表示タスクに届く可能性があります。
- `TaskPane.commentDraft` / `conflict` はタスク切替後も残り、別タスクへ投稿・再試行し得ます。
- `ProjectCustomizeButton` の色・アイコン・ステータスは初回propsで固定され、プロジェクト切替時に残ります。
- Calendarだけ `localStorage` の独自hydrate/persist（約85行）。List/Board/Timelineは `usePersistedViewState` を使用。
- `ListView` / `BoardView` のURL再構築は `new URLSearchParams({ view })` から始めるため、`task` などが消えます。

**提案**

- 即時: `ListView` / `ProjectCustomizeButton` に `key={projectId}`、`TaskPane` に `key={task.id}`。
- `useScopedState(scopeKey, initial)` でscope変更時のresetを明示。
- `lib/view-state/spec.ts` にviewごとの `parse` / `toSearchParams` / `defaults` を定義し、`useViewState` に統一。
- CalendarのlocalStorageは一度だけ移行して `usePersistedViewState` へ。
- `selected` は `selected ∩ visibleIds` で導出。

### P1-6. 共有タスクUIプリミティブ

**現状**

- 完了ボタンが4実装。Boardは `<span>` で、クリックして完了できません。
- アバター色が Timeline/Calendar/Board で別実装。`UserAvatar` は既に存在するが未利用。
- Status色が `Done|完了` / `進行中|In Progress` / `未着手|To Do` のハードコードで、カスタムStatusは中立色になります。
- サブタスク/コメントのバッジSVGが3箇所に重複。

**提案**

- `components/task/TaskCompletionToggle.tsx`
- `components/task/TaskAvatar.tsx`（`UserAvatar` をラップ）
- `components/task/TaskStatusChip.tsx`
- `components/task/TaskMetaBadges.tsx`
- `lib/task-appearance.ts` に `statusTone(status, statusOptions)` とbar/avatarのtone定義。

### P1-7. Dialog / Popover / Toast

**現状**

- `useFocusTrap` は良いprimitiveですが、13以上の手作りオーバーレイのうち利用は一部です。
- `role="dialog"` / `aria-modal` / `aria-labelledby` / Escape / フォーカス復帰の有無が不統一。
- メニューは全画面のclick-away div + absolute panelのコピーが7箇所。Timelineは `menu` と `zoomMenu` が同時に開けます。

**提案**

- `components/ui/Dialog.tsx`: portal、backdrop、focus trap、Escape、focus restore、body scroll lock、ARIA。
- `components/ui/PopoverMenu.tsx`: trigger、outside click、Escape、focus return、`aria-expanded`。
- `components/ui/Toast.tsx` + `useToast`。
- 既存の `data-*` / `aria-expanded` は維持。

### P1-8. 大規模コンポーネント分割

**分割案**

- `TimelineView`:
  - `TimelineBar`, `TimelineAxis`, `TimelineToolbar`, `TimelineSectionPane`, `TimelineCanvas`, `TimelineUndatedDrawer`
  - `TimelineDependencyLayer` + `useTimelineDependencies` + `lib/timeline-dependency-geometry.ts`
  - 左右ペインが別々にrow順を再構築しているため、`lib/timeline-layout.ts` の共通row modelを導入
- `CalendarView`:
  - `CalendarToolbar`, `CalendarMonthGrid`, `CalendarWeekGrid`, `CalendarDayCell`, `CalendarMultiDayBar`, `CalendarLegend`
  - `lib/calendar-layout.ts`, `lib/task-colors.ts`
- `ListView`:
  - `TaskListRow` + `TaskCell` 群、`useListSelection`, `useColumnLayout`, `ListToolbar`, `AddTaskRow`
- `TaskPane`:
  - `TaskPaneHeader`, `TaskFieldsSection`, `TaskDependenciesSection`, `TaskDescriptionEditor`, `SubtaskSection`, `AttachmentSection`, `TaskFeed`, `useMentions`
- `ProjectCustomizeButton`:
  - `CustomizeDrawer` + `PANELS` registry + panel別ファイル + `useAsyncAction`

---

## 詳細（P2・クイックウィン）

### P2-1. Timelineのメモ化

- `criticalPath` は `showCritical` が false でも毎レンダー実行されています。
- `useMemo` / `useCallback` が未使用で、ドラッグの毎フレームで section sort、group構築、依存線geometry、全bar描画が再実行されます。
- まず `critical` を `showCritical ? criticalPath(...) : new Set()` にし、`useMemo` で `dated` / `groups` / `dependencyShapes` を固定。次に `TimelineBar` を `memo` 化。

### P2-2. 日付・ドラッグ・リサイズ

- 日付パーサが `TimelineView.toDay`, `lib/calendar.parseDay`, `critical-path.dayNum`, `CalendarView` の日付処理で重複。
- `DAY_MS` / `86_400_000` が複数箇所に直書き。
- `Math.round(dx / dayWidth)` がCalendarに4箇所。リサイズのstart/endブロックがほぼ同一。
- `lib/dates.ts` に `parseDay` / `formatDay` / `DAY_MS` を集約し、`lib/task-dates.ts` に `moveTaskSpan` / `resizeTaskStart` / `resizeTaskEnd` / `dropTaskOnDay` を純関数で追加。
- ポインタードラッグは `startPointerSession` / `pixelsToDayDelta` / `autoScrollNearEdge` の共通カーネルへ。HTML5 DnDとポインタDnDは無理に統合しない。

### P2-3. 検索

- `app/search/page.tsx` の5結果ブロックと `SearchBox.tsx` の5結果ブロックが重複。
- `app/search/page.tsx:50` でrender中に `saveSearchHistory` を実行しており、プリフェッチや再描画でも書き込みが発生。
- `SearchBox` の `showMenu` は `data.history.length >= 0` で常に真。
- `lib/search-params.ts` にフィルタ型、`SearchResults` / `SearchHistory` を共有化。履歴保存はクライアントのsubmit時またはserver actionへ。
- comboboxの `role` / `aria-expanded` / `aria-activedescendant` / 矢印キー対応を追加。

### P2-4. SQL・CSV

- `tasks/bulk` の `IN (${ids.join(",")})` を `= ANY($n::bigint[])` に。
- `project-tabs/reorder` の1行UPDATEループを `unnest ... WITH ORDINALITY` の1文に。重複ID・部分リストの扱いを決める。
- `csvCell` が3箇所で同一実装。`lib/csv.ts` に `csvCell` / `toCsv` / `parseCsv` / `csvResponse`。
- ダッシュボードexportの集計SQLは `getProjectStats` / `getDashboardExtras` のコピー。`lib/services/project-dashboard.ts` に集約。

### P2-5. ナビゲーションとセッションキャッシュ

- ナビ定義が `AppShell`（モバイル）、`SidebarNav`、`SidebarRail` の3箇所に存在し、内容・順序が異なる。
- `lib/navigation.ts` に `PRIMARY_NAV` / `UTILITY_NAV` / `RAIL_ITEMS` / `RAIL_FLYOUTS` を集約。
- `React.cache()` で `getSession()` / `getUsers()` / `getWorkspace()` をリクエスト単位にキャッシュし、`HeaderAuth` / `SidebarNav` / `SidebarRailFooter` の重複クエリを削減。

### P2-6. 空/読込/エラー

- `EmptyState` は8箇所で利用、インライン空状態は17箇所。
- `LoadingSkeleton` はルートのloading 2箇所のみ。プロジェクトのskeletonは常にリスト形状。
- `MyTasksView.persist` は楽観更新後に失敗してもrollbackしません。
- `EmptyState` に `variant="card" | "inline" | "section"` を追加、`Skeleton` / `InlineError` / `MutationFeedback` を用意。
- `alert`/`confirm` をトースト + 確認ダイアログへ置換。

### P2-7. プロジェクトページ

- 421行で、アクティブviewに関係なく21クエリを `Promise.all`。メッセージ、知識、フォーム、アプリ、バンドル、自動化、添付、ダッシュボード、アクティビティまで常に取得。
- `TaskPane` へ22 props、`ProjectCustomizeButton` へ17 props。
- `getProjectShellData()` と `getProjectViewData(view)` に分割し、view registry + `Suspense` でアクティブviewのみロード。
- `projectMeta` / `viewer` オブジェクトを1つ渡す形に整理。

### P2-8. SidebarProjectLink

- 461行に、アイコン分岐、コンテキストメニュー、6 API、4ダイアログ、トーストが同居。
- 共有ダイアログは `ProjectShareButton`、外観ダイアログは `ProjectCustomizeButton` と重複。
- `ProjectContextMenu` / `ProjectShareDialog` / `ProjectAppearanceDialog` / `RenameProjectDialog` / `ArchiveProjectDialog` に分割。
- コンテキストメニューだけでなく、キーボード・タッチ用の可視ケバブボタンを追加。

---

## 推奨実行順序

### 第1段階: 安全性とデータ整合性（P0）

1. P0-1 タスク認可・移動先検証
2. P0-2 タスク書き込みサービス + 楽観ロック
3. P0-4 `withTransaction`
4. P0-3 マルチホーム整合
5. P0-5 カスタムフィールド修正

この段階は機能追加ではなく不具合修正に近いため、先に回帰テストを追加してから進めるのが安全です。

### 第2段階: 共通化（P1）

1. P1-1 APIルート wrapper / バリデーション
2. P1-2 セッション・管理者ガード
3. P1-4 クライアントAPI + mutation hook
4. P1-6 共有タスクUI
5. P1-7 Dialog / Popover / Toast
6. P1-5 stateスコープ + view-state
7. P1-3 `lib/data.ts` 分割

### 第3段階: 大規模分割（P2）

- P1-8 のコンポーネント分割は、第2段階の共通部品が揃ってから。
- Timeline/Calendarはピクセル・ドラッグ挙動が敏感なので、最後に実施。
- 先に characterization test を追加し、`data-*` 属性とクラス文字列を維持する。

---

## 実施時の注意

- `tests/e2e.sh` は `data-timeline-bar`, `data-calendar-multiday`, `data-board-card`, `data-list-row`, `data-customize-*`, `data-comment-*` など349種類の属性を文字列で検証しています。抽出時は属性の位置とクラス文字列を変えないでください。
- `app/` にユニットテストがないため、日付計算・ズーム・ドラッグ・リサイズは、抽出前にゴールデン値（軸配列、bar座標、日付patch）を記録してください。
- 認可変更は、プロジェクト未所属タスクの扱い（許可/拒否）を先に決めないと、既存データやE2Eが壊れます。
- サーバーアクションへの一括移行は不要です。既存APIルートには認可・監査・通知・409の資産があり、まずクライアント側の重複を減らす方が費用対効果が高いです。
- 大規模コンポーネントの分割は、一度に全部やらず「セル/バー」「ツールバー」「モーダル」「フック」の順で、PRを分けて進めてください。

---

## 最短で効果が出る5件

1. **P0-5** カスタムフィールドの読み取りバグ修正（小さく、実害が明確）
2. **P1-4** `lib/api-client.ts` + `useMutation`（11重複の解消）
3. **P1-6** 完了・アバター・Statusの共有化（Boardの完了不能も直る）
4. **P2-1** `criticalPath` の条件付き実行 + `useMemo`（Timelineのドラッグ性能）
5. **P1-1** `withProject` + `ApiError`（79個の定型ガードを削減し、404/400を揃える）

---

## 実施状況（2026-11-07）

### 完了

- **P0-1 タスク認可の fail-open と移動先検証**
  - `lib/api-project-auth.ts` に `getTaskProjectIds` / `requireTaskPermission` を追加。
  - タスク未所属はワークスペース管理者のみ許可する fail-closed に変更。
  - `PATCH /api/tasks/[id]` で移動先 project / section / parent / assignee を検証。
  - `?task=` は `getTaskForProject` でパス上のプロジェクトに限定。
  - 対象: tasks PATCH/DELETE/restore, bulk, comments, dependencies, task-values, memberships, attachments。
- **P0-2 の一部**
  - `expected_updated_at` を `UPDATE ... WHERE updated_at = $n` に組み込み、実際の楽観ロックに変更。
  - `lib/recurrence.ts` に繰り返し日付計算を抽出。
  - bulk complete に automations / audit を追加。
- **P0-4 の一部**
  - `lib/db.ts` に `withTransaction` を追加。
  - プロジェクト作成とフォーム回答の task + response をトランザクション化。
- **P0-5 カスタムフィールド**
  - `customValueToInput` を追加し、ListView の編集・フィルタと TaskPane の defaultValue を修正。
- **P0-3 マルチホームの集計整合**
  - `projectTaskScope()` を追加し、統計・ダッシュボード・アクティビティ・依存関係・タスク候補を
    primary project + `task_project_memberships` の共通条件に変更。
  - マルチホームタスクが一覧だけでなく概要の集計にも表示されることを確認（0/1）。
- **P1-1 APIルート共通化（完了）**
  - `lib/api/errors.ts`（ApiError / badRequest / forbidden / notFound / jsonError）を追加。
  - `lib/api/route.ts` に `withUser` / `withAdmin` / `withProject` / `withResourceProject`
    / `withTask` / `withAttachmentTask` / `withCommentProject` を追加。
  - project存在チェックによる404、ID不正の400、権限403をラッパーで統一。
  - 保護対象72ルートのうち69ルートを移行。残り3本は認証/招待の公開ルート。
  - 動的なタスク・コメント・メンバーシップ権限はラッパー内で追加チェック。
  - 検証: `docs/evidence/refactor-p1-api-wrapper-check.txt` / E2E 444 PASS。
- **P1-2 セッション・管理者ガード統一（完了）**
  - `lib/api/session.ts` を追加。`getRequestSession`（Request単位WeakMapキャッシュ）、
    `getServerSession`（React cache）で有効ユーザーを一元検証。
  - `getCurrentUserIdFromRequest` と `DEFAULT_USER_ID=1` フォールバックを削除。
  - `requireProjectPermission` / `requireActiveUser` / `requireWorkspaceAdmin` を
    共通セッションへ移行し、重複する管理者SELECTを削除。
  - `/api/me` は無効化ユーザーに404、その他ユーザーAPIは403を返すことを確認。
  - 検証: `docs/evidence/refactor-p1-session-check.txt` / E2E 444 PASS。

- **P1-4 クライアントAPI + mutation hook（完了）**
  - `lib/api-client.ts` に `ApiError` / typed `api()` を追加。
  - `lib/task-client.ts` に `patchTask` と `TaskConflictError` を追加。
  - `lib/use-mutation.ts` を追加し、SidebarProjectLinkで使用。
  - `useApiRefresh` を `lib/use-api-refresh.ts` へ移動し循環依存を解消。
  - 11個のローカル `api()` を削除し、タスクPATCH/409処理を5ビューで共通化。
  - 共有クライアントのGET/POST/404/409をNodeで実API検証、Board/Listの完了トグルをブラウザ検証。
  - 検証: `docs/evidence/refactor-p1-client-api-check.txt` / E2E 444 PASS。

- **P1-3 lib/data.ts のリポジトリ分割（完了）**
  - `lib/repositories/` に tasks / projects / comments / search / task-select / scope を追加。
  - `lib/data.ts` は約1480行から319行へ縮小し、既存import向けに再エクスポート。
  - `TASK_SELECT_COLS` / `TASK_FROM` / `toTaskRow` を共通化し、全タスクSELECTを統一。
  - `getMyTasks` の欠落列（created_by / creator_name / completed_at / created_at）を解消。
  - `getProjectTabs` を純粋な読み取りに変更し、`ensureDefaultProjectTabs` を
    プロジェクト作成トランザクションで実行。
  - `getProjectStats` / `getDashboardExtras` の独立クエリを `Promise.all` 化。
  - デッドコード `searchTasks` / `recentComments` を削除。
  - 検証: `docs/evidence/refactor-p1-data-split-check.txt` / E2E 444 PASS。

- **P1-5 の一部**
  - `ListView` / `BoardView` / `CalendarView` / `TimelineView` / `TaskPane` / `ProjectCustomizeButton` を
    `projectId` / `task.id` で key 指定し、プロジェクト・タスク切替時のstate漏れを防止。
  - List/BoardのURL更新を現在の `window.location.search` ベースに変更し、`task` などの
    無関係なパラメータを保持。
- **P1-5 stateスコープ・view-state統一（残り完了）**
  - CalendarViewの独自localStorage（約85行）を廃止し、`usePersistedViewState` に統一。
  - プロジェクトページのCalendar初期値をURL→view-stateの順で解決。
  - カスタムフィルタはJSON文字列としてview-stateに保存。
  - リロード後も `weekends=false` が復元されることを確認。

- **P1-6 共有タスクUI（残り完了）**
  - `lib/task-appearance.ts` の `statusToneClass` を追加。
  - `TaskStatusChip` / `TaskMetaBadges` を追加。
  - ListView / BoardView / CalendarView のStatus・サブタスク/コメントバッジを共通化。

- **P2-2 日付・ドラッグ・リサイズ共通カーネル（完了）**
  - `lib/task-dates.ts` に `pixelsToDayDelta` / `dayOrNull` / `taskDaySpan` /
    `moveTaskSpan` / `resizeTaskStart` / `resizeTaskEnd` / `dropTaskOnDate` を追加。
  - CalendarViewの移動・リサイズ・ドロップを共通カーネルへ移行。
  - TimelineViewの日付変換、timeline-dndのshiftDateも共通化。
  - ゴールデン値テストとCalendarのリサイズUIで検証。

- **P2-3 検索ページ / SearchBox の重複解消（完了）**
  - `lib/search-types.ts` に候補型・URLヘルパー・`buildSearchOptions` を追加。
  - `components/search/SearchSuggestMenu.tsx`（listbox）と
    `components/search/SearchResults.tsx`（/searchの結果セクション）を追加。
  - `app/search/page.tsx` 379→260行、`SearchBox.tsx` 299→166行。
  - render中の `saveSearchHistory` を削除。`proxy.ts` のリクエスト境界で
    検索履歴を記録し、直接GETでも履歴が残るようにした。
  - combobox ARIA（role/aria-expanded/aria-controls/aria-activedescendant）と
    矢印キー・Enter・Escapeを追加。
  - 検証: `docs/evidence/refactor-p2-search-check.txt` / E2E 444 PASS。

- **P2-4 SQL一括化・CSV共通化（完了）**
  - `tasks/bulk` の `IN (${ids.join(",")})` を `id = ANY($n::bigint[])` に変更。
    完了/再開/移動/担当/削除/繰り返し/通知取得をすべてセットベース化。
  - 担当者イベントを `INSERT ... SELECT` の1文に統合。
  - `project-tabs/reorder` の1行UPDATEループを
    `unnest(...) WITH ORDINALITY` の1文に変更。
  - `lib/csv.ts` に `csvCell` / `toCsv` / `parseCsv` / `csvResponse` を追加。
  - プロジェクト/ダッシュボード/監査のCSVエクスポートと、CSVインポートを共通化。
  - `csvCell` 3重複と `splitCsvLine` を削除。
  - 検証: `docs/evidence/refactor-p2-sql-csv-check.txt` / E2E 444 PASS。

- **P2-1 Timelineのメモ化（完了）**
  - `TimelineView` の `assigneeNames` / `visibleTasks` / `dated` / `undated` /
    ビューポート計算 / `groups` / `rowY`/`pos` / `edges` / `dependencyShapes` /
    `critical` / `weeks` / `weekLines` を `useMemo` 化。
  - `pct()` を `useCallback` 化。
  - `TimelineBar` を `React.memo` でラップ。
  - ズーム変更・バードラッグ・依存線描画・完了トグルをブラウザ確認。
  - 検証: `docs/evidence/refactor-p2-timeline-memo-check.txt` / E2E 444 PASS。

- **P2-5 ナビゲーション設定・セッションキャッシュ（完了）**
  - `lib/navigation.ts` に `MAIN_NAV` / `ADMIN_NAV` / `TRASH_NAV` /
    `MOBILE_NAV` / `RAIL_ITEMS` / `RAIL_FLYOUTS` / `NAV_LABELS` を集約。
  - AppShell（モバイル）、SidebarNav、SidebarRail の3重複を解消。
  - `getServerSession` に加え、`getWorkspace` / `getUsers` /
    `getProjectsForUser` を `React.cache` でリクエスト単位キャッシュ。
  - デスクトップ・折りたたみレール・モバイルのナビをブラウザ確認。
  - 検証: `docs/evidence/refactor-p2-navigation-cache-check.txt` / E2E 444 PASS。

- **P2-6 空/読込/エラー状態と alert/confirm 統一（完了）**
  - `components/ui/FeedbackHost.tsx` と `lib/ui-feedback.ts` を追加。
    グローバルトーストと確認Dialogを1箇所で描画。
  - 27箇所の `alert(...)` を `toastMessage(...)` へ、
    25箇所の `confirm(...)` / `window.confirm(...)` を `confirmAction(...)` へ移行。
  - `InlineError` / `MutationFeedback` を追加し、MyTasksViewの保存失敗・保存中表示に適用。
  - MyTasksViewの空状態を `EmptyState` に統一。
  - 検証: `docs/evidence/refactor-p2-feedback-check.txt` / E2E 444 PASS。

- **P2-7 プロジェクトページのview別データロード（完了）**
  - `lib/repositories/project-page.ts` を追加。
    - `getProjectShellData`（セクション/ユーザー/メンバー/タブ/カスタム項目/
      アプリ/バンドル/自動化/お気に入り）を `React.cache` で共有。
    - list/board/timeline/calendar/overview/dashboard/messages/knowledge/
      forms/files/task-pane のローダーを分離。
  - `app/projects/[id]/page.tsx` はアクティブviewのローダーだけをawait。
    view-stateはlist/board/timeline/calendarのみ、saved viewはlistのみ、
    TaskPaneデータは `?task=` 指定時のみ取得。
  - 全10viewのページ描画を確認。
  - 検証: `docs/evidence/refactor-p2-project-view-load-check.txt` / E2E 444 PASS。

- **P2-8 SidebarProjectLink 分割（完了）**
  - `components/project/` に `ProjectContextMenu` / `ProjectShareDialog` /
    `RenameProjectDialog` / `ProjectAppearanceDialog` / `ArchiveProjectDialog`
    を抽出。
  - `SidebarProjectLink.tsx` は461行→249行。リンク描画・props同期・
    ミューテーションのみを担当。
  - コンテキストメニュー8項目、リネーム、外観、アーカイブ、共有をブラウザ確認。
  - トーストはグローバル `FeedbackHost` に統一。
  - 検証: `docs/evidence/refactor-p2-sidebar-split-check.txt` / E2E 444 PASS。

- **P1-6 共有タスクUI**
  - `components/task/TaskCompletionToggle.tsx` を追加し、Timeline / Calendar / Board / List / TaskPane の完了UIを共通化。
  - `components/task/TaskAvatar.tsx` を追加し、Timeline / Calendar / Board / List のアバターを `UserAvatar` に統一。
  - Board の完了操作が可能になった。
- **P1-8 大規模コンポーネント分割（TimelineView完了 / 他は未着手）**
  - `TimelineView.tsx` を 1867行から1323行へ削減。
  - `TimelineBar` / `TimelineAxis` / `TimelineToolbar` / `TimelineCanvas` /
    `TimelineDependencyLayer` を `components/timeline/` へ抽出。
  - バー移動、完了トグル、依存関係ドラッグ、メニュー、軸・グリッドの
    `data-*` 契約を維持。
  - 検証: `docs/evidence/refactor-p1-timeline-split-check.txt` / E2E 444 PASS。
  - CalendarView を `components/calendar/` へ分割（1550行 → 1080行）。
    CalendarToolbar / DayHeader / DayCell / SingleTask / MultiDayBar / Grid / Legend を抽出。
  - ListView を `components/list/` とフックへ分割（2286行 → 1339行）。
    - `ListToolbar` / `ListColumnHeader` / `TaskListRow`
    - `lib/use-list-selection.ts`（選択・Shift範囲・全選択）
    - `lib/use-column-layout.ts`（列幅・列順・リサイズ・localStorage）
  - 行のインライン編集、完了トグル、サブタスク展開、列リサイズ/移動、
    グループ折りたたみの永続化をブラウザで確認。
  - TaskPane を `components/task/` へ分割（1078行 → 738行）。
    - TaskPaneHeader / TaskSubtasksSection / TaskAttachmentsSection
    - TaskDependenciesSection / TaskCustomFieldsSection
    - TaskCommentComposer / TaskFeedSection
  - data-comment-* / data-mention-* のE2E契約を維持。
  - ProjectCustomizeButton を `components/customize/` へ分割（2180行 → 964行）。
    - CustomizeHomePanel / CustomizeRow / icons
    - CustomizeAppearancePanel（カラー・アイコン）
    - CustomizeStatusPanel / CustomizeFieldsPanel / CustomizeTemplatesPanel
    - CustomizeEmailPanel / CustomizeAppsPanel / CustomizeBundlesPanel /
      CustomizeAutomationsPanel / field-library
    - CustomizeModal / CustomizeFieldModal / CustomizeTemplateModal /
      CustomizeAutomationModal / CustomizeBundleModal / CustomizeAppModal
  - 8パネル + 5編集モーダルの data-customize-* 契約を維持しブラウザ確認済み。

- **P1-7 Dialog / Popover / Toast（完了）**
  - `components/ui/PopoverMenu.tsx` を追加。click-away / Escape / focus復帰を共通化。
  - `components/ui/Dialog.tsx` を追加。portal / focus trap / Escape / scroll lock / ARIAを共通化。
  - `components/ui/Toast.tsx` を追加。
  - Board / Timeline の6メニュー、ProjectShareButton、ProjectCustomizeButton Modal、
    SidebarProjectLink/ProjectCustomizeButtonのToastを移行。
  - メニュートリガーに `aria-expanded` / `aria-haspopup` を追加。
  - 検証: `docs/evidence/refactor-p1-overlay-check.txt` / E2E 444 PASS。

- **P2-1 の一部**
  - Timeline の `criticalPath` を `showCritical` 時のみ計算。
- **その他の小さな修正**
  - ListViewのlocalStorage初期化をrAFへ移し、effect内の同期setStateを解消。
  - ListViewの `window.location.href` を `router.push` に変更。
  - OverviewViewの重複 `projectName` propを削除。

### 検証

- `npx tsc --noEmit`: PASS
- 変更ファイルの ESLint: PASS
- 本番ビルド: 成功
- 対象API検証: クロスプロジェクト移動 403 / 別プロジェクトsection 400 / project未指定作成 400 / `?task=` リークなし / 削除済みPATCH 404
- E2E: PASS=444 FAIL=0（`docs/asana-parity-e2e.log` を更新）
- ブラウザ検証: カスタムフィールド編集値=A、Board完了→未完了のトグル、task 2 は最終的に未完了
  - `docs/evidence/refactor-browser-check.txt`
  - `docs/evidence/refactor-custom-field-edit.png`
  - `docs/evidence/refactor-board-completion.png`
- API検証: `docs/evidence/refactor-p0-check.txt` / `docs/evidence/refactor-p1-api-wrapper-check.txt` / `docs/evidence/refactor-p1-session-check.txt` / `docs/evidence/refactor-p1-client-api-check.txt` / `docs/evidence/refactor-p1-overlay-check.txt` / `docs/evidence/refactor-p1-timeline-split-check.txt` / `docs/evidence/refactor-p1-calendar-split-check.txt` / `docs/evidence/refactor-p1-list-row-split-check.txt` / `docs/evidence/refactor-p1-taskpane-split-check.txt` / `docs/evidence/refactor-p1-taskpane-feed-check.txt` / `docs/evidence/refactor-p1-customize-split-check.txt` / `docs/evidence/refactor-p1-customize-appearance-check.txt` / `docs/evidence/refactor-p1-customize-panels-check.txt` / `docs/evidence/refactor-p1-customize-modals-check.txt` / `docs/evidence/refactor-p1-p22-check.txt` / `docs/evidence/refactor-p2-search-check.txt` / `docs/evidence/refactor-p2-sql-csv-check.txt` / `docs/evidence/refactor-p2-timeline-memo-check.txt` / `docs/evidence/refactor-p2-navigation-cache-check.txt` / `docs/evidence/refactor-p2-feedback-check.txt` / `docs/evidence/refactor-p2-project-view-load-check.txt` / `docs/evidence/refactor-p2-sidebar-split-check.txt`

---

## 追加実施（2026-11-09）: A → B → C

前回レポートの推奨順序 A → B → C に沿って、以下を実施しました。

### A. 低リスク整理
- デッドコード削除（未使用コンポーネント5件・未使用export 9件）。
- `server.js` のLint設定修正、`npm run lint` を成功させる。
- プロジェクトページのURL/保存状態マージを `lib/project-view-params.ts` に抽出。
  - `app/projects/[id]/page.tsx`: 621 → 373行。
  - 特性テスト11件を追加。

### B. データ整合性
- `lib/services/task-write.ts` を追加。
  - PATCHの入力検証（progress 0..100、日付、開始≤期日、status、recurrence等）。
  - 繰り返しタスク生成の共通化。
- `tasks/bulk` の完了更新＋イベント＋次回タスク生成をトランザクション化。
- CSVインポートをSAVEPOINTによる行単位の原子性に変更（部分成功の既存仕様は維持）。
- `task-templates` / `bundles apply` / `admin teams` / `my-tasks` /
  `lib/dashboard` / `invitations` のトランザクションを `withTransaction` に統一。
- 入力検証・繰り返し・一括・CSV・管理チームの実API検証を追加。

### C. 大規模UI分割
- `ListView` から純粋モデルを `lib/list-view-model.ts` に抽出。
- フィルタ・ソート・グループ状態を `lib/use-list-filters.ts` に抽出。
- セクションCRUD・DnD・インライン改名を `lib/use-list-sections.ts` に抽出。
- 行インライン編集（openEdit/commitEdit/patchFields/applyDueRange）と
  タスク・サブタスク追加、一括コミット状態を `lib/use-list-task-actions.ts` に抽出。
- セクション/サブグループ見出しを `components/list/ListSectionHeader.tsx` に抽出。
- 追加タスク行・フッター集計行を `components/list/ListFooterRow.tsx` に抽出。
- グループ集計を `lib/list-grouping.ts` に、サブグループ描画を
  `components/list/ListSubgroupRows.tsx` に抽出。
- セクションDnDのドロップ表示を `components/list/ListSectionBlock.tsx` に抽出。
- 非セクショングループの追加行を `components/list/ListGroupAddRow.tsx` に、
  「セクションなし」を `components/list/ListUngroupedSection.tsx` に、
  セクションメニューを `components/list/ListSectionMenu.tsx` に抽出。
- ツールバーのメニュー/ソート/グループ/フィルタ処理、保存ビュー、
  ビュー名・アイコン更新、列表示切替を `lib/use-list-toolbar.ts` に抽出。
- 保存ビューのピル表示を `components/list/SavedViewsBar.tsx` に抽出。
- 一括操作を `lib/use-list-bulk-actions.ts` と
  `components/list/ListBulkToolbar.tsx` に抽出。
- 列ヘッダー行と列DnD表示を `components/list/ListColumnHeaderRow.tsx` に抽出。
- 行DnDの状態・セクション追加・位置計算を `lib/use-list-row-dnd.ts` に抽出。
- 非表示列バーを `components/list/ListHiddenColumnsBar.tsx` に抽出。
- 行クリック・Shift範囲選択・サブタスク展開を
  `lib/use-list-row-interaction.ts` に抽出。
- 空状態を `components/list/ListEmptyState.tsx` に抽出。
- フラット/セクショングループ描画と「セクションなし」を
  `components/list/ListGroups.tsx` に抽出。
- `TaskRowContext` の構築を `lib/use-list-row-context.ts` に抽出。
- 列ヘッダー群を `components/list/ListColumnHeaders.tsx` に抽出。
- セクション追加フッターを `ListSectionAdd.tsx`、セクションメニュー/
  フィールドメニュー/フィールドダイアログを `ListOverlays.tsx` に抽出。
- ルートの `data-list-view` シェル、ツールバー/ヘッダー/グループ/
  オーバーレイの合成を `components/list/ListViewContent.tsx` に抽出。
  列レイアウト・ソート・フィルタ・フィールドpropsは `columns` に集約。
- 残るフック配線を `lib/use-list-view.tsx` に集約。
  - `components/ListView.tsx`: 2,327 → 12行（-2,315行、-99.5%）。
  - `ListView` は `useListView` + `ListViewContent` の薄いラッパーに。
- `tsx --test` によるユニットテスト基盤を追加（29件）。

### 検証結果
- `npx tsc --noEmit`: PASS
- `npm run lint`: PASS
- `npm test`: 26 PASS / 0 FAIL
- `./tests/e2e.sh http://127.0.0.1:3210`: PASS=587 FAIL=0
- `npm run build`: PASS

詳細: `docs/evidence/refactor-abc-check.txt`

