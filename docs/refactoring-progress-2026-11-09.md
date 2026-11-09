# Atlas リファクタリング実施状況（Phase 0–3）

- 基準: `docs/refactoring-investigation-2026-11-09.md`
- 実施日: 2026-11-09
- アプリGit: `/Users/tsinfra/Dev/Atlas/app`

## コミット

| コミット | 内容 |
|---|---|
| `10a0e98` | 不透明セッショントークン＋`user_sessions`、WebSocket検証、検索履歴の`after()`移行 |
| `9f67f26` | CI（tsc / lint / unit / build） |
| `acf3974` | TimelineViewのフィルタ・ビューポートをフック化 |
| `6d91c5d` | マルチホームタスク認可（編集は所属プロジェクト、削除は主プロジェクト） |
| `d0714da` | BoardCard抽出 |
| `5df1e9c` | メニューキーボード操作の共通フック化 |
| `6198609` | duplicate / follow-up ルートをサービス層へ分離 |
| `6665717` | `db` / `tests` / `docs` / `scripts` をアプリGit内へ移動 |
| `a352cfd` | Timelineレイアウト抽出、1,000タスクベンチマーク |
| `7b0888a` | 自動化アクションCapabilityレジストリ |
| `4c68060` | E2Eをアプリルートから実行可能にし、lint対象を調整 |
| `f535142` | `tasks/[id]` 更新・削除、プロジェクト複製をサービス化 |
| `26a6054` | タイムライン専用の軽量タスク投影 |
| `6e8f0a9` | Playwrightによるリサイズ・メニュー操作テスト、CIブラウザジョブ |
| `ea41b20` | Timeline依存関係・下書きフック抽出、プロジェクト取込をサービス化 |
| `a953fa4` | 自動化タスクスナップショットの一元化、プロジェクトエクスポートをサービス化 |
| `9ae3ef3` | Timelineホバー状態をフック化（1,006行） |
| `d3d85cc` | Timelineポインタードラッグをフック化（899行） |
| `22a8d31` | プロジェクトテンプレート保存をサービス化、CIにE2Eジョブ追加 |
| `f14af3f` | SecurityPanelをセクション別コンポーネントへ分割（780→94行） |
| `3f2bba8` | TaskSummary / TaskTimelineRow / TaskDetail の型付き投影を追加 |
| `f2f381a` | 実ブラウザ1,000タスクのタイムライン計測を追加 |
| `1f1cdbb` | CalendarViewのフィルタを`useCalendarFilters`へ抽出 |
| `daf1426` | TaskPaneの状態・更新処理を`useTaskPane`へ抽出（889→707行） |

## 検証結果

- `npx tsc --noEmit`: PASS
- `npm run lint`: PASS
- `npm test`: **86 PASS / 0 FAIL**
- `npm run build`: PASS
- 空DB（`init.sql` → `db:migrate` → 再実行）: PASS
- 本番Docker E2E: **635 PASS / 0 FAIL**
- Playwright: **3 PASS / 0 FAIL**
  - 右端リサイズで左端固定
  - 左端リサイズで右端固定
  - タスクメニューのArrow/Escape
- `npm run bench:timeline`: 1,000タスク
  - 通常: mean 0.11ms / p95 0.19ms
  - 全タスク重複の最悪ケース: 7.89ms / 1,000レーン
- `npm run bench:browser`: 1,000タスク
  - 描画バー: 1,000
  - 最初のバー表示: 986ms
  - ズーム操作: 約139ms（500ms待機を除く）
- 本番Dockerは新ビルドへ更新済み

## Phase別の到達点

### Phase 0
- 数値`atlas_uid`を廃止し、43文字の不透明トークン＋SHA-256ハッシュ保存へ移行。
- ログインで`atlas_session`発行、旧Cookie削除、ログアウトでDBセッション失効。
- WebSocket upgradeもDBセッションを検証。
- `db/migrations`＋`npm run db:migrate`＋コンテナ起動時適用。
- `db/init.sql`、`seed.sql`、`tests/e2e.sh`、`docs/`、運用スクリプトをアプリGit内へ移動。
- CIに型・lint・ユニット・ビルド・空DBマイグレーション・Playwright・E2Eジョブを追加。
- E2EにCookie偽装拒否・ログアウト失効・失効行削除を追加。

### Phase 1
- `useTimelineFilters` / `useTimelineViewport` / `useTimelineLayout` /
  `useTimelineDependencies` / `useTimelineDraft` / `useTimelineHover` /
  `useTimelineDrag` を抽出。
  - `TimelineView.tsx`: 1,621行 → 899行。
- タスクの複製・フォローアップ・削除・変換・行解除・リンクコピーを
  `lib/task-actions.ts` に集約。
- `TaskSummary` / `TaskTimelineRow` / `TaskDetail` とSQL投影レジストリを追加。
- 一覧・タイムライン・詳細クエリに投影を適用。タイムラインは軽量SELECTで集計サブクエリを除外。

### Phase 2
- `requireTaskPermission` がマルチホーム所属プロジェクトの権限も評価。
- 破壊的操作（DELETE / restore）は主プロジェクト限定。
- `tasks/[id]`（更新・削除）を `lib/services/task-update.ts` へ移動（432行 → 7行）。
- duplicate / follow-up を `lib/services/task-copy.ts` へ移動。
- プロジェクト複製・CSV取込・エクスポート・テンプレート保存を
  `project-duplicate.ts` / `project-import.ts` / `project-export.ts` /
  `project-template.ts` へ移動。
- 自動化エンジンのタスクスナップショットを `TASK_RULE_SNAPSHOT_SQL` に一元化。
- 自動化アクションのID・ラベル・必須パラメータを
  `ACTION_CAPABILITIES` に一元化し、descriptorsとvalidateが参照。

### Phase 3
- `components/board/BoardCard.tsx` を抽出。
- `CalendarView` のフィルタ状態・派生タスク計算を `useCalendarFilters` へ抽出し、
  `filterCalendarTasks` の純関数テストを追加。
- `TaskPane` の状態・競合回復・コメント・添付・メンバー操作を
  `useTaskPane` へ抽出（889行 → 707行）。
- `useMenuKeyboard` でタスク・プロジェクト・タブメニューの
  Arrow/Home/End/Escape・フォーカス復帰を統一。
- 1,000タスクのレーン計算ベンチマークを追加。
- Playwrightでポインタリサイズとメニューキーボード操作を自動化。
- `SecurityPanel` を `components/security/` の4セクションへ分割。

## 残課題

- TimelineViewのdragを含む全フック分割は完了。
- Customize / FieldDialog の追加分割。
- 残りの大規模ルートのサービス化（主要タスク・プロジェクト系は完了）。
- Customize / FieldDialog の追加分割。
- 1,000タスク規模の実ブラウザ性能計測と、必要に応じた仮想化。
- 実ブラウザでの1,000タスク性能計測と仮想化の要否判断。
