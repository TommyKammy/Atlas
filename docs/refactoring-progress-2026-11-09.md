# Atlas リファクタリング実施状況（Phase 0–3 着手）

- 基準: `docs/refactoring-investigation-2026-11-09.md`
- 実施日: 2026-11-09
- アプリGit: `/Users/tsinfra/Dev/Atlas/app`

## コミット

| コミット | 内容 |
|---|---|
| `10a0e98` | 不透明セッショントークン＋`user_sessions`、WebSocket検証、検索履歴の`after()`移行 |
| `9f67f26` | CI（tsc / lint / unit / build） |
| `acf3974` | TimelineViewのフィルタ・ビューポートをフック化（1,621→1,307行） |
| `6d91c5d` | マルチホームタスク認可（所属プロジェクトのいずれかで編集可、削除は主プロジェクト） |
| `d0714da` | BoardCard抽出（BoardView 824→750行） |
| `5df1e9c` | メニューキーボード操作の共通フック化 |
| `6198609` | duplicate / follow-up ルートをサービス層へ分離 |

## 検証結果

- `npx tsc --noEmit`: PASS
- `npm run lint`: PASS
- `npm test`: 69 PASS
- `npm run build`: PASS
- 本番Docker E2E: **635 PASS / 0 FAIL**
- `user_sessions`: 稼働DBへ`npm run db:migrate`で適用済み
- 本番Dockerは新ビルドへ更新済み

## Phase別の到達点

### Phase 0
- 数値`atlas_uid`を廃止し、43文字の不透明トークン＋SHA-256ハッシュ保存へ移行。
- ログインで`atlas_session`発行、旧Cookie削除、ログアウトでDBセッション失効。
- WebSocket upgradeもDBセッションを検証。
- `app/db/migrations`＋`npm run db:migrate`＋コンテナ起動時適用。
- CIで型・lint・ユニット・ビルドを検証。
- E2EにCookie偽装拒否・ログアウト失効・失効行削除を追加。

### Phase 1
- `useTimelineFilters` / `useTimelineViewport` を抽出。
- タスクの複製・フォローアップ・削除・変換・行解除・リンクコピーを
  `lib/task-actions.ts` に集約し、TaskPaneとコンテキストメニューで共用。

### Phase 2
- `requireTaskPermission` が主プロジェクトだけでなく、
  マルチホーム所属プロジェクトの権限も評価。
- 破壊的操作（DELETE / restore）は主プロジェクト限定。
- E2Eに「Bのみ編集者可」「主プロジェクト以外からの削除は403」を追加。
- duplicate / follow-up の業務ロジックを `lib/services/task-copy.ts` へ移動。

### Phase 3
- `components/board/BoardCard.tsx` を抽出し、カード描画をBoardViewから分離。
- `useMenuKeyboard` でタスク・プロジェクト・タブメニューの
  Arrow/Home/End/Escape・フォーカス復帰を統一。
- 69件のユニットテストと635件のE2Eで回帰を確認。

## 残課題

- `db/init.sql` / `tests/e2e.sh` / `docs/` は引き続きアプリGit外。完全移行は未実施。
- TimelineViewのdrag/layout/draft/dependencyフック分割は未完了。
- タスク投影（`TaskSummary`/`TaskDetail`）の型分離は未着手。
- `tasks/[id]` 本体、projects duplicate/import、自動化Capabilityレジストリは未着手。
- Playwright等によるポインタードラッグ・リサイズのブラウザ自動テストは未導入。
- 1,000タスク規模の性能計測・仮想化は未着手。
