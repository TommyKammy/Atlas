# Atlas リファクタリング調査レポート

- 対象: `/Users/tsinfra/Dev/Atlas/app`
- 基準コミット: `8ed81ea`（2026-11-09）
- 前回調査: `docs/refactoring-candidates.md`（2026-11-07、commit `117e6a1`）
- 調査日: 2026-11-09
- 方法: TS/TSXの規模・状態数・APIルート・重複パターンの計測、認可/セッション、DBスキーマ運用、テスト/CI、主要コンポーネントのコードリード
- この調査では**アプリコードの変更は行っていません**。

---

## 1. 結論

現状のAtlasは、型安全性・APIラッパー・トランザクション・共有UIの面では以前より大きく改善しています。
一方で、機能追加の速度に対して次の3領域がボトルネックになっています。

1. **認証・セッションとマルチホーム認可**
   - 数値の `atlas_uid` Cookie が署名されておらず、HTTP/WebSocketの両方が同じCookieを信頼しています。
   - マルチホームタスクの認可が「主プロジェクト」優先で、表示しているプロジェクトの権限と一致しません。
2. **DBスキーマ・テスト・ドキュメントのリポジトリ境界**
   - `db/init.sql`、`tests/e2e.sh`、`docs/` がアプリのGitリポジトリ外にあり、マイグレーション機構もありません。
   - 直近の `is_milestone` / `task_timeline_rows` も手動ALTERで適用しており、デプロイ再現性のリスクが高い状態です。
3. **TimelineViewとタスク操作の集中**
   - `TimelineView.tsx` は1,621行・29 `useState`・8 `useEffect`・11 `useMemo`・4 `useRef`。
   - タスクの完了・削除・複製・フォローアップ・変換・リンクコピーが、TaskPane・コンテキストメニュー・各ビューに重複しています。

推奨は、**全面分割ではなく、安全網（セッション・マイグレーション・CI・特性テスト）→ Timeline/タスク操作/投影 → API/自動化 → 大規模UI/性能** の順です。

---

## 2. 計測サマリ

### 2.1 現在の規模

| 指標 | 値 |
|---|---:|
| TS/TSX ファイル数 | 465 |
| TS/TSX 総行数 | 63,834 |
| APIルート | 127 |
| ページ | 17 |
| コンポーネント（TSX） | 194 |
| libファイル | 122 |
| ユニットテストファイル | 8 |
| ユニットテスト件数 | 55 |
| E2E | 624 PASS / 2,197行 |
| `use client` ファイル | 176 |
| `any` 使用 | 2 |
| `ts-ignore` / `ts-expect-error` | 0 |
| `db.query` 呼び出し | 487 |
| `NextResponse.json` | 636 |
| `withTransaction` 使用 | 46 |
| `projectTaskScope` 使用 | 13 |
| `requireTaskPermission` / `getTaskForProject` | 13 |
| `router.refresh()` | 83 |
| メニュー関連コンポーネント | 14 |

### 2.2 前回調査（2026-11-07）との比較

| 指標 | 前回 | 今回 |
|---|---:|---:|
| TS/TSX 総行数 | 25,519 | 63,834 |
| APIルート | 72 | 127 |
| コンポーネント | 63 | 194 |
| libファイル | 28 | 122 |
| ユニットテスト | 0（当時） | 55 |

短期間で機能が大きく増えており、**以前の「大規模コンポーネント分割」の対象が移動・再発**しています。
一方で、ListViewの薄いラッパー化、`lib/data.ts` の分割、APIクライアント統一、`withTransaction` の導入など、前回の主要施策は着実に完了しています。

### 2.3 特に大きいファイル

| ファイル | 行数 | 状態 |
|---|---:|---|
| `components/TimelineView.tsx` | 1,621 | `useState` 29 / `useEffect` 8 / `useMemo` 11 / `useRef` 4 |
| `components/customize/AutomationRuleBuilder.tsx` | 1,058 | ルール編集UI（`useState` 10） |
| `components/CalendarView.tsx` | 994 | `useState` 18 |
| `components/TaskPane.tsx` | 889 | `useState` 16 |
| `components/ProjectCustomizeButton.tsx` | 884 | `useState` 19 / `useEffect` 7 |
| `components/list/FieldDialog.tsx` | 860 | フィールド型別UI（`useState` 25） |
| `components/BoardView.tsx` | 824 | `useState` 24 |
| `components/SecurityPanel.tsx` | 780 | 管理/セキュリティ（`useState` 31） |
| `components/list/TaskListRow.tsx` | 754 | 行セル・編集 |
| `lib/use-list-view.tsx` | 756 | リスト状態の集約 |
| `components/task/ProjectTaskContextMenu.tsx` | 637 | メニュー・ダイアログ・API（`useState` 8） |
| `components/customize/AutomationRulesPanel.tsx` | 635 | ルール一覧/実行 |
| `lib/repositories/projects.ts` | 631 | プロジェクト系SQL |
| `lib/capabilities/index.ts` | 553 | 自動化アクション |
| `lib/automation/engine.ts` | 534 | ルール実行 |
| `components/timeline/TimelineToolbar.tsx` | 514 | タイムライン操作 |

### 2.4 大きいAPIルート

| ルート | 行数 |
|---|---:|
| `app/api/tasks/[id]/route.ts` | 432 |
| `app/api/projects/[id]/duplicate/route.ts` | 288 |
| `app/api/projects/[id]/import/route.ts` | 241 |
| `app/api/project-templates/[id]/route.ts` | 232 |
| `app/api/projects/[id]/template/route.ts` | 221 |
| `app/api/projects/[id]/export/route.ts` | 214 |
| `app/api/projects/[id]/route.ts` | 185 |
| `app/api/tasks/bulk/route.ts` | 184 |
| `app/api/task-values/route.ts` | 169 |
| `app/api/projects/[id]/table/route.ts` | 168 |

ルートの中央値は55行、90パーセンタイルは123行で、大多数は小さく保たれています。
上位10本への業務ロジック集中が主な課題です。

---

## 3. 前回調査から改善された点

- `lib/data.ts` は1,428行から328行へ縮小し、`lib/repositories/` に分割済み。
- `lib/api-client.ts` の `api()` と `lib/task-client.ts` の `patchTask` にクライアント処理を統一。
- `withUser` / `withProject` / `withTask` などのAPIラッパーを導入し、手動の認可ガードは9箇所まで減少。
- `withTransaction` を46箇所で使用し、主要な複数書き込みフローをトランザクション化。
- `projectTaskScope` を13箇所で使用し、マルチホームの集計整合を改善。
- `alert()` / `confirm()` は0件。`confirmAction` / `Toast` / `Dialog` に統一。
- ListViewは12行の薄いラッパーになり、状態・描画・操作がフック/コンポーネントへ分離。
- CalendarView 1,577→994行、ProjectCustomizeButton 2,197→884行、TaskPane 1,078→889行へ縮小。
- TypeScriptは `strict: true`、`any` は2件のみ、`ts-ignore` は0件。

これらは維持すべき資産です。今回の調査は「ゼロから分割し直す」ではなく、**残った集中点と新しい運用リスク**に焦点を当てています。

---

## 4. 優先候補一覧

| ID | 優先度 | 候補 | 主な根拠 | 工数 / リスク |
|---|---|---|---|---|
| P0-1 | P0 | セッション/WebSocket認証の強化 | 数値Cookie `atlas_uid` をHTTP/WSが信頼 | M / 高 |
| P0-2 | P0 | マルチホームタスク認可のプロジェクト文脈対応 | 主プロジェクト優先の認可と表示プロジェクトの不一致 | M / 中 |
| P0-3 | P0 | スキーマ/マイグレーション/リポジトリ境界 | `db/init.sql`・E2E・docsがGit外、手動ALTER | M–L / 高 |
| P1-1 | P1 | TimelineViewのフック分割 | 1,621行・30 state・直近のリサイズ不具合 | L / 中 |
| P1-2 | P1 | タスク操作の共通化 | 完了/削除/複製/変換/コピーが複数箇所に重複 | M / 低–中 |
| P1-3 | P1 | タスク投影・型契約の統一 | `TASK_SELECT_COLS` の6相関サブクエリ、任意フィールド | M / 中 |
| P1-4 | P1 | APIルートからサービス層への分離 | `tasks/[id]` 432行、duplicate/import 241–288行 | L / 中 |
| P1-5 | P1 | 自動化サブシステムのレジストリ化 | capabilities/descriptors/validate/engineの三重管理 | L / 高 |
| P1-6 | P1 | テスト/CIの再構成 | E2Eがリポジトリ外、CIなし、ポインタ試験なし | M / 低 |
| P2-1 | P2 | Calendar/Board/TaskPane/Customizeの分割 | 800–1,000行・17–25 state | L / 中 |
| P2-2 | P2 | 共有メニュー/ポップオーバーの統一 | 14メニュー、キーボード/フォーカスが不統一 | M / 低–中 |
| P2-3 | P2 | データ取得・描画性能 | shell 9クエリ、重い投影、ページング/仮想化なし | M–L / 中 |
| P2-4 | P2 | サーバー/バックグラウンド処理の分離 | `server.js` にWS/Redis/janitor、2秒ポーリング | M / 中 |
| P2-5 | P2 | 日付・エラー・整形の小粒整理 | 日付ヘルパの残差、APIエラー形式、Prettierなし | S–M / 低 |

---

## 5. 詳細

### P0-1. セッション/WebSocket認証の強化

**現状**

- `lib/api/session.ts` は `atlas_uid=(\d+)` を読み、その数値をそのままユーザーIDとしてDB検証しています。
- `app/api/auth/login/route.ts` はログイン成功時に `atlas_uid` へ `row.id` を設定しています。
- `proxy.ts` は `atlas_uid` が数字であることだけを認証ゲートにしています。
- `server.js` のWebSocket upgradeも同じ `atlas_uid` を読み、数値なら接続を許可しています。

**リスク**

- Cookieを任意のユーザーIDに差し替えるだけで、そのユーザーとしてAPI/WSを利用できます。
- ログアウトはCookie削除のみで、サーバー側の失効・ローテーション・一覧管理がありません。
- 2FA/SAMLを通過した後のセッションも、Cookie偽装に対して同じ強度しかありません。

**提案**

- ランダムな不透明セッションID（256bit）を発行し、Redisまたは `sessions` テーブルに
  `session_id / user_id / expires_at / revoked_at / user_agent` を保存。
- HTTP API、`proxy.ts`、WebSocket upgradeで同じ `verifySession()` を使う。
- 署名付きCookie（HMAC）を使う場合も、失効・ローテーション・IP/UAの扱いを決める。
- ログイン試行のレート制限、セッション固定対策、CSRF/Origin検証を追加。
- E2EはCookieジャー経由なので、ログインが返す新しいCookie名に追従可能。
- 旧 `atlas_uid` からの移行期間を設ける場合は、明示的に期限を切る。

**工数/リスク**: M / 高。早めに着手すべき非機能課題です。

---

### P0-2. マルチホームタスク認可のプロジェクト文脈対応

**現状**

- `lib/api-project-auth.ts` の `getTaskProjectIds` は
  `COALESCE(t.project_id, membership, parent)` の順で「代表プロジェクト」を1つ返します。
- `withTask` はその代表プロジェクトで `requireProjectPermission` を実行します。
- 新しく追加した `PUT /api/tasks/[id]/timeline-row` だけは、bodyの `project_id` を明示的に検証しています。

**影響**

- タスクがプロジェクトAを主プロジェクト、Bをマルチホーム先とする場合、
  Bの編集者（Aの権限なし）はBの画面でタスクを見られても、
  `PATCH /api/tasks/[id]`、コメント、添付、依存関係などで403になります。
- `timeline-row` はBで成功するため、画面とAPIの権限判定が不一致になります。

**提案**

- `withTaskInProject` または `requireTaskPermission(req, taskId, level, projectId?)` を追加し、
  リクエストのプロジェクト文脈（URL/クエリ/body）を認可に渡す。
- タスクがそのプロジェクトに primary / membership / subtask で属するかを1クエリで検証。
- タスク削除・復元などプロジェクト横断の操作は「いずれかの編集可能プロジェクト」か
  「主プロジェクトのみ」かを仕様として決める。
- E2Eに「Bのみ編集者可」「A閲覧者可」のマトリクスを追加。

**工数/リスク**: M / 中。機能の正しさに直結します。

---

### P0-3. スキーマ/マイグレーション/リポジトリ境界

**現状**

- アプリのGitルートは `/Users/tsinfra/Dev/Atlas/app`。
- `db/init.sql`（約40KB）、`tests/e2e.sh`（2,197行）、`docs/`、`docker-compose.yml` は
  その外側にあり、Git管理されていません。
- `docker-compose.yml` は `db/init.sql` をDBコンテナの初期化時だけマウントします。
- マイグレーション用のスクリプト・履歴テーブル・`npm run db:migrate` はありません。
- 直近の `is_milestone` と `task_timeline_rows` は、稼働中DBへ手動ALTERして反映しました。

**リスク**

- アプリのコミットとスキーマ変更が原子的でなく、ロールバックできません。
- 新しい環境・CI・本番レプリカでスキーマが再現されない可能性があります。
- E2E・証跡・設計文書がGit外のため、変更履歴と紐づきません。

**提案**

- `db/`、`tests/`、`docs/`、`docker-compose.yml` をアプリリポジトリへ移動するか、
  同一リポジトリのmonorepo構成にする。
- `node-pg-migrate` / `Umzug` などのマイグレーションを導入し、
  `schema_migrations` と `npm run db:migrate` を追加。
- CIで空DB→migrate→seed→E2Eを実行。
- `init.sql` は初期スキーマ＋seedに限定し、変更は必ずmigrationで積む。
- 本番適用は「アプリデプロイ前にmigration」を必須手順にする。

**工数/リスク**: M–L / 高。早めに着手すべき運用基盤です。

---

### P1-1. TimelineViewのフック分割

**現状**

- 1,621行、29 `useState`、8 `useEffect`、11 `useMemo`、4 `useRef`。
- `TimelineBar` / `TimelineAxis` / `TimelineToolbar` / `TimelineCanvas` /
  `TimelineDependencyLayer` には分離済みですが、親に以下が集中しています。
  - ズーム・軸・表示範囲
  - レーン計算・セクション高さ・行固定
  - 日付ドラッグ・リサイズ・行ドラッグ・長押し
  - 依存関係ドラッグ
  - 下書きタスク
  - ホバー・ツールチップ・スクロール
  - フィルタ・ソート・折りたたみ

**直近の証拠**

- 2026-11-09のリサイズ不具合は、`axis === "x"` の `transform` が
  リサイズにも適用されていたことと、幅のCSSトランジションが重なって発生しました。
- `lib/timeline-drag-style.ts` に純関数を切り出して修正しましたが、
  ポインタ操作全体の自動テストはまだありません。

**提案**

- `useTimelineViewport`（min/max/span/zoom/scroll）
- `useTimelineLayout`（lanes/positions/row heights/label footprints）
- `useTimelineDrag`（axis lock、start/end resize、row drag、long press）
- `useTimelineDraft`
- `useTimelineDependencies`
- `useTimelineHover`
- `useTimelineFilters`
に分割し、`TimelineView` は合成と描画に限定。

**進め方**

- 先に `data-timeline-*` 属性、バー座標、日付patch、行番号を
  characterization test で固定。
- 1フックずつ、DOM/クラス文字列を変えずに移行。
- PlaywrightまたはTesting Libraryで、左端/右端リサイズ、行ドラッグ、長押し、
  依存線、下書きを自動化。

**工数/リスク**: L / 中。コードベースで最も投資対効果が高い分割です。

---

### P1-2. タスク操作の共通化

**現状**

- `components/task/ProjectTaskContextMenu.tsx` 637行に、
  複製・フォローアップ・完了・サブタスク・変換・詳細・新規タブ・リンクコピー・削除・行固定解除が集中。
- `TaskPane` 889行にも完了・削除・リンクコピー・共有・パッチ処理が存在。
- Board / Calendar / Timeline / List hooks が、それぞれ
  `patchTask` の try/catch、409トースト、`router.refresh()` を実装。
- 完了・削除・変換・複製のUIとエラーハンドリングがビューごとに少しずつ異なります。

**提案**

- `lib/task-actions.ts` または `useTaskActions` を追加。
  - `toggleComplete`
  - `deleteTask`
  - `duplicateTask`
  - `createFollowUp`
  - `convertToTask / convertToMilestone / convertToSubtask`
  - `copyTaskLink`
  - `patchTaskFields`（409/競合トースト/refreshを統一）
- コンテキストメニューは「メニュー定義」と「ダイアログ」を分離し、
  アクション自体は共通層を呼ぶ。
- `ProjectTaskContextMenu` は `TaskContextMenu` + `TaskActionDialogs` + `useTaskMenu` へ分割。

**工数/リスク**: M / 低–中。新機能追加時の重複を止められます。

---

### P1-3. タスク投影・型契約の統一

**現状**

- `lib/repositories/task-select.ts` の `TASK_SELECT_COLS` は、
  likes / comments / subtasks / attachments / blocked_by / blocking の
  6つの相関サブクエリと、collaborators のJSON集約を毎回実行します。
- `TaskRow` は `project_name`、`like_count`、`attachment_count`、
  `blocked_by_count`、`collaborators`、`eff_section_id`、`timeline_row` など
  多数の任意フィールドを持ちます。
- `is_milestone` の追加では、TaskRow / TASK_SELECT_COLS / PATCHABLE /
  バリデーション / エンジンsnapshot / descriptors / duplicate / bulk / UI を更新しました。
- `timeline_row` の追加では、TaskRow / 2つの取得クエリ / API / bulk /
  duplicate / section移動 / Timeline UI / コンテキストメニューを更新しました。
- `lib/automation/engine.ts` はタスクsnapshot用に独自SELECTを持ち、
  `TASK_SELECT_COLS` とフィールドがずれる可能性があります。

**提案**

- 用途別の投影に分割:
  - `TaskSummary`（一覧・ボード・検索）
  - `TaskTimelineRow`（タイムラインに必要な最小列）
  - `TaskDetail`（タスクペイン）
  - `TaskRuleSnapshot`（自動化エンジン）
- `taskProjection(kind)` / `TASK_SELECT[kind]` を一元管理し、
  `toTaskRow` のデフォルト補完を減らす。
- 相関サブクエリは、一覧用には集約CTEまたは事前集計に変更。
- 「必須フィールドが欠けたら型エラー」にするため、任意フィールドを減らす。
- スキーマ変更時に更新すべきファイルを1箇所に集約する。

**工数/リスク**: M / 中。機能追加コストと欠落バグを減らします。

---

### P1-4. APIルートからサービス層への分離

**現状**

- `app/api/tasks/[id]/route.ts` 432行に、認可、入力検証、競合、UPDATE、
  繰り返し生成、イベント、通知、監査、自動化が同居。
- `projects/[id]/duplicate` 288行、`projects/[id]/import` 241行、
  `project-templates/[id]` 232行、`projects/[id]/template` 221行も
  業務ロジックがルート内に集中。
- エラー返却は `NextResponse.json({ error })` 401件と
  `throw badRequest/notFound` 11件が混在。
- パスパラメータの `Number(params.id)` 検証がルートごとにばらつき、
  非数値時に500へ落ちる可能性がある箇所があります。

**提案**

- `lib/services/tasks/update.ts`、`lib/services/projects/duplicate.ts`、
  `lib/services/projects/import.ts` などへ業務ロジックを移す。
- ルートは「認可 → 入力parse → サービス呼び出し → レスポンス」だけにする。
- エラーは `ApiError` / `badRequest` / `notFound` に統一し、
  パスパラメータは共通の `positiveIntParam()` で検証。
- サービス層に単体/統合テストを追加（DBはテスト用トランザクション）。

**工数/リスク**: L / 中。特にduplicate/importは回帰リスクが高いため、
先に特性テストを追加します。

---

### P1-5. 自動化サブシステムのレジストリ化

**現状**

- `lib/capabilities/index.ts` 553行のif-chainに全アクションが集中。
- `lib/automation/descriptors.ts` の `ACTION_DESCRIPTORS`、
  `lib/automation/validate.ts` の `REQUIRED_PARAMS`、
  `lib/capabilities/index.ts` の実行分岐が三重管理。
- `AutomationRuleBuilder.tsx` 1,058行、`AutomationRulesPanel.tsx` 635行。
- `lib/automation/engine.ts` 534行。条件評価・パス選択・実行は
  重要な割に、純粋関数としてのテストが限定的。
- 直近で `task.is_milestone` を追加した際も、エンジンsnapshotのSELECTを手動更新しました。

**提案**

- `CapabilityDefinition` レジストリを単一の真実源にする。
  - id / label / params schema / required params / execute
- descriptors と validate はレジストリから生成。
- `matchCondition` / `chooseActions` / `renderTemplate` を純関数としてexportし、
  条件演算子・ブランチ・変数展開のテーブルテストを追加。
- RuleBuilderを「トリガー」「条件」「アクション」「プレビュー」に分割し、
  フォーム状態を `useRuleDraft` に抽出。
- ルール実行の統合テスト（manual run / webhook / scheduled）を追加。

**工数/リスク**: L / 高。自動化は影響範囲が広いため、機能追加と分けて進めます。

---

### P1-6. テスト/CIの再構成

**現状**

- ユニットテストは8ファイル・55件。`lib/*.test.ts` と `lib/services/*.test.ts` のみ。
- E2Eは `tests/e2e.sh` 2,197行・624ケースで、アプリのGit外。
- CI設定（`.github/workflows` 等）はありません。
- ポインタードラッグ、リサイズ、タッチ、コンテキストメニューの自動テストはありません。
- 直近のリサイズ不具合は手動確認で発見され、`timeline-drag-style.test.ts` を追加して初めて純関数部分が固定されました。

**提案**

- E2Eをリポジトリ内へ移動し、`auth` / `tasks` / `timeline` / `board` / `calendar` /
  `automation` / `admin` などに分割。
- Playwrightを導入し、ブラウザ操作を追加:
  - 左端/右端リサイズで反対側の端が固定されること
  - 行ドラッグ、長押し、キーボード行移動
  - コンテキストメニューの表示・Escape・フォーカス
  - カレンダーの週/月切替とドラッグ
- CI: install → tsc → lint → unit → build → DB migrate → E2E。
- カバレッジは「変更したlib/servicesの行カバレッジ」から導入し、
  全体100%を目標にしない。
- `data-*` 契約をE2Eの安定インターフェースとして維持。

**工数/リスク**: M / 低。他の分割の前提となる安全網です。

---

### P2-1. Calendar / Board / TaskPane / Customizeの分割

- CalendarView 994行・18 state、BoardView 824行・24 state、TaskPane 889行・16 state。
- ListViewで成功した「薄いラッパー + フック + 子コンポーネント」パターンを適用。
- 例:
  - `useBoardView`（グループ・DnD・追加・フィルタ）
  - `useCalendarView`（月/週・スクロール・DnD・フィルタ）
  - `useTaskPane`（パッチ・競合・コメント・添付）
  - Customizeはパネルごとの状態を各パネルへ移動
- FieldDialog 860行は、フィールド型ごとのエディタをレジストリ化。
- SecurityPanel 780行は、ユーザー/ロール/2FA/監査のタブ分割。

**工数/リスク**: L / 中。

### P2-2. 共有メニュー/ポップオーバーの統一

- メニュー関連14ファイル。`PopoverMenu` は存在しますが、全メニューが移行済みではありません。
- `ProjectTaskContextMenu` は独自の配置・項目・キーボード処理を持ち、
  矢印キー/roving focusが未実装です。
- 共有 `Menu` / `MenuItem` / `Submenu` を作り、
  click-away / Escape / focus復帰 / ARIA / 画面端補正を統一。
- タスクメニュー、プロジェクトメニュー、タブメニュー、リストメニューを移行。

**工数/リスク**: M / 低–中。

### P2-3. データ取得・描画性能

- `getProjectShellData` は9クエリを毎回実行し、
  ユーザー全件・プロジェクトルール・アプリ・バンドルまで読みます。
  カスタマイズDrawerを開いた時だけ取得する分離が可能。
- `getProjectTasks` は6相関サブクエリ＋collaborators集約を全タスクに実行。
- タイムライン/リスト/ボード/カレンダーはページング・仮想化なし。
- `assignTimelineLanes` は行ごとの区間リストを走査するため、
  タスク数・行数が多いとO(n²)に近づきます。
- 1,000タスク規模のプロジェクトで、
  - 初期表示時間
  - スクロール/ズーム時のフレーム時間
  - レーン計算時間
  を計測し、必要なら投影・集約・仮想化・区間木を導入。

**工数/リスク**: M–L / 中。

### P2-4. サーバー/バックグラウンド処理の分離

- `server.js` 133行に、Next custom server、WebSocket、Redis pub/sub、
  日次janitorが同居。
- `instrumentation.ts` は2秒ごとに自ホストの `/api/automation/process` をHTTPで叩きます。
- janitorは `scripts/janitor.sh` と `server.js` に重複し、
  `domain_events` / `rule_runs` の保持期間はserver側だけにあります。
- `/api/automation/process` のトークンは未設定時に
  `atlas-internal-automation` へフォールバックします。
- Webhookはsecret未設定時に署名検証をスキップします。

**提案**

- WebSocket/Redis fan-outとjanitorを別モジュール/プロセスへ分離。
- 自動化ワーカーは自己HTTPではなく、キューまたはワーカーエントリポイントへ。
- 保持期間の定義を1箇所に集約。
- 本番ではデフォルトトークンを拒否し、Webhook secretを必須化（または明示的なunsigned許可）。
- 構造化ログ、ヘルスチェック、処理件数メトリクスを追加。

**工数/リスク**: M / 中–高。

### P2-5. 小粒整理

- `lib/calendar.ts` の `taskSpan` と `lib/task-dates.ts` の `taskDaySpan` の重複。
- `TimelineView` 内のローカル `DAY_MS`。
- APIエラー形式（`NextResponse.json` vs `ApiError`）の統一。
- `Number(params.id)` の共通バリデータ化。
- Prettier相当のフォーマットスクリプトがなく、`format` が未定義。
- `tsconfig` の `target` はES2017。Node 24/モダンブラウザ前提ならES2022へ。
- `loading.tsx` がなく、重いページのローディングが暗黙的。

**工数/リスク**: S–M / 低。

---

## 6. 推奨ロードマップ

### Phase 0: 安全網と運用基盤（最優先）

1. セッションCookieの不透明化・署名/サーバー保存・WS共通検証
2. `db/` / `tests/` / `docs/` のリポジトリ内移行とマイグレーション導入
3. CI（tsc / lint / unit / build / migrate / E2E）の追加
4. Timeline/タスク操作の特性テスト（Playwright含む）

**完了条件**

- Cookie偽装ができない。
- 空DBからmigrateだけでスキーマが再現できる。
- CIがPRごとに624 E2Eを含めてgreen。
- リサイズ・行ドラッグ・メニューのブラウザテストがある。

### Phase 1: 高ROIの構造改善

1. `TimelineView` をフック分割
2. タスク操作を `useTaskActions` / `lib/task-actions.ts` に統一
3. タスク投影を `TaskSummary` / `TaskTimelineRow` / `TaskDetail` に分割

**完了条件**

- TimelineViewが500行前後になり、drag/layout/draft/dependencyが独立。
- タスク操作の重複が1箇所になる。
- `is_milestone` / `timeline_row` のような追加時に更新するファイルが減少。

### Phase 2: API・自動化・マルチホーム

1. マルチホーム認可をプロジェクト文脈対応
2. `tasks/[id]` / duplicate / import / template をサービス化
3. 自動化のCapabilityレジストリと純関数テスト

**完了条件**

- Bのみ編集者がBのタスクを編集できる。
- ルートは認可/parse/レスポンスのみ。
- 自動化のアクション追加が1ファイルで済む。

### Phase 3: 大規模UIと性能

1. Calendar / Board / TaskPane / Customize / FieldDialog / Security の分割
2. 共有メニュー/ポップオーバーの統一
3. 1,000タスク規模の性能計測と投影/ページング/仮想化

### Phase 4: 小粒整理

日付ヘルパ、APIエラー、Prettier、ES2022、loading状態。

---

## 7. 進め方のガードレール

- **DOM契約を壊さない**: `data-timeline-*`、`data-calendar-*`、`data-board-*`、
  `data-list-*`、`data-comment-*` など154種類のE2E属性を維持。
- **特性テスト先行**: 抽出前に座標・日付patch・行番号・APIレスポンスを記録。
- **1PR = 1フック/1コンポーネント**: 大規模分割を一度に行わない。
- **振る舞い変更と構造変更を混ぜない**: リファクタPRでは機能追加をしない。
- **マイグレーション必須**: スキーマ変更は必ずmigrationとして追加し、手動ALTERを禁止。
- **性能は計測してから**: 1,000タスクのフィクスチャでbefore/afterを取る。
- **既存の共有資産を再利用**: `api()`、`patchTask`、`withTransaction`、
  `PopoverMenu`、`Dialog`、`TaskCompletionToggle`、`TaskStatusChip`。

## 8. 今はやらない方がよいこと

- 生SQLをORMへ全面移行する（既存のリポジトリ層で十分）。
- クライアント状態をグローバルストアへ全面移行する（現在のフック分割が機能）。
- `ListView` を再度作り直す（すでに薄いラッパー化済み）。
- Tailwindクラス文字列やDOM構造を同時に変更する（E2Eが壊れる）。
- 大規模コンポーネントを一括で分割する（Timeline/Calendarは回帰リスクが高い）。

## 9. 付記: 今回の調査で使った主な指標

- `find app components lib -name '*.ts' -o -name '*.tsx' | xargs wc -l`
- `grep -c 'useState' components/TimelineView.tsx`
- `find app/api -name 'route.ts' | xargs wc -l`
- `grep -rn 'db.query' app components lib | wc -l`
- `grep -rn 'NextResponse.json' app | wc -l`
- `grep -rn 'withTransaction' app lib | wc -l`
- `grep -rn 'projectTaskScope' app lib | wc -l`
- `grep -rn 'router.refresh()' components app | wc -l`
- `wc -l tests/e2e.sh`
- `git log --oneline -10`

## 10. 総評

Atlasのリファクタリングは「大きなコンポーネントを分割する」段階から、
**「認証・スキーマ・テストの運用基盤を整え、変更の影響範囲を小さくする」段階**へ移っています。

最優先は見栄えのするUI分割ではなく、
1. セッション偽装を塞ぐ
2. スキーマとテストをGit/CIに載せる
3. Timelineとタスク操作の特性テストを先に置く
ことです。その上でTimelineViewとタスク操作を分割すると、
直近のようなリサイズ回帰を自動テストで防ぎながら、安全に機能追加を続けられます。
