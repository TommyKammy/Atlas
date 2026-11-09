# Atlas プロジェクトアクションメニュー実装ロードマップ

作成日: 2026-11-08  
対象: プロジェクトページのプロジェクト名横「↓」メニュー  
調査: Asana Test_PJ、REA `inspect_web_page` + Chrome CDP

## 1. 結論

Asanaのメニューは12項目・3グループで、単なる「削除メニュー」ではなく、プロジェクト管理のハブになっています。Atlasには既にアーカイブ、外観、共有、メンバー、テンプレート、インポート、JSON/CSVエクスポート、ポートフォリオ追加の部品があるため、最初から全機能を作り直すのではなく、**共通アクションメニュー基盤 → 既存機能の集約 → 設定/権限 → 複製/テンプレート → 削除/ゴミ箱 → 同期/テーブル** の順で段階実装するのが現実的です。

- 最小リリース（11項目、テーブルと本格的な外部同期を除く）: **約4〜6週間**
- 全項目（同期・公開リンク・テーブルを含む）: **別途3〜5週間以上（合計7〜11週間程度）**
- 最優先は「メニュー基盤」「設定/権限」「削除の安全化」。複製・テーブル・外部同期は工数とデータ影響が大きいため独立フェーズにする。

## 2. Asana側の調査結果

### 2.1 メニュー構造

プロジェクト名の右にある「アクション」ボタン（下向き矢印）から開きます。

- サイズ: 約 255.8 × 467px
- 項目高: 36px
- 3グループ（区切り線あり）

| # | 項目 | アイコン | 備考 |
|---|---|---|---|
| 1 | プロジェクト設定を編集 | 歯車 | 詳細設定ダイアログ |
| 2 | プロジェクト権限を管理 | スライダー | Enterprise限定の鍵付き |
| 3 | カラーとアイコンを設定 | パレット | サブメニュー/外観ダイアログ |
| 4 | プロジェクトのリンクをコピー | リンク | クリップボード |
| 5 | 複製 | 複製 | 詳細な複製オプション |
| 6 | テンプレートとして保存 | テンプレート | 専用テンプレート画面 |
| 7 | ポートフォリオに追加 | ＋ | 接続ポートフォリオ選択 |
| 8 | プロジェクトからテーブルを作成 | テーブル | テーブル変換ダイアログ |
| 9 | インポート | インポート | サブメニュー |
| 10 | エクスポートまたは同期 | エクスポート | サブメニュー |
| 11 | アーカイブ | アーカイブ | 非表示化 |
| 12 | プロジェクトを削除 | 赤いゴミ箱 | 強い確認ダイアログ |

### 2.2 サブメニュー

- インポート
  - 任意のファイル
  - CSV
- エクスポートまたは同期
  - プロジェクトのタスク（CSVまたはXLSX）
  - 時間入力（CSV）
  - JSON
  - Outlookカレンダー
  - Googleカレンダー
  - iCalやその他のカレンダー
  - Googleスプレッドシート
  - 印刷
  - 公開リンクを作成
- カラーとアイコン
  - カラー
  - アイコン
  - アップロード

### 2.3 プロジェクト設定ダイアログ

タブ構成:

1. プロジェクトの詳細
   - 名前
   - 関連チーム
   - オーナー
   - 期日
   - 説明
   - テンプレート
   - つながっているポートフォリオ
2. 依存関係
   - バッファを維持
   - バッファを埋める
   - なし
3. スケジュール
   - 勤務日（例: 平日 月〜金）
   - 勤務時間
4. Notifications
   - Slack
   - Microsoft Teams

### 2.4 権限管理

AsanaではEnterprise限定。以下の4領域があります。

- プロジェクトのワークフローと外観を編集できるユーザー
- プロジェクトのメンバーシップを共有・管理できるユーザー
- フィールド単位の更新制限（制限追加）
- 他のプロジェクトとタスクを共有できるユーザー

Atlasには既にプロジェクトロール（admin/editor/commenter/viewer）とカスタムフィールド単位のアクセス制御があるため、AsanaのEnterprise機能をそのまま移植するのではなく、**Atlasのロール＋フィールドアクセスを一つの権限画面に集約**するのがよいです。

### 2.5 複製ダイアログ

- プロジェクト名
- プロジェクトの詳細
- プロジェクトの説明
- オートメーション
- プロジェクトメンバー
- フォーム
- プロジェクトの権限
- リソース配分
- 主な参考資料
- タスクの作成
- 関連チーム
- タスクタイプ
- タスクテンプレート
- タブ: 概要、ダッシュボード、リスト、カレンダー、ボード、メッセージ、タイムライン、知識
- タスク詳細: すべてのタスク、担当者、説明、期日、サブタスク、関連プロジェクト、添付、依存関係、コラボレーター、タグ

### 2.6 テンプレートとして保存

専用画面 `/0/project-templates/new/project/{projectId}`。

- テンプレートのタイトル
- チームを選択
- テンプレートへのアクセス
- 除外: アプリ、完了したタスク、ノート、ダッシュボードタブの内容

### 2.7 その他の確認結果

- ポートフォリオ: 「つながっているポートフォリオ」と追加ボタン
- テーブル作成: テーブル名、プロジェクト詳細、メンバー、タブ、カスタムフィールド、セクション、タスク詳細、元プロジェクトのアーカイブ
- 削除確認:
  - プロジェクト内のみに存在する未割り当てタスク
  - プロジェクト限定カスタムフィールド
  - オートメーション
  - タスクテンプレート
  - 読み取り専用リンク
  - 「キャンセル」「削除」

## 3. Atlasの現状とギャップ

### 3.1 既にある部品

| 領域 | 既存実装 |
|---|---|
| プロジェクト名変更 | `ProjectTitle` のインライン編集 |
| 外観 | `ProjectAppearanceDialog`（色・アイコン） |
| 共有 | `ProjectShareDialog` + `ProjectMembersManager` |
| アーカイブ | `ArchiveProjectDialog` + `PATCH /api/projects/[id] {archived:true}` |
| プロジェクト削除API | `DELETE /api/projects/[id]`（admin、物理削除） |
| テンプレート | `project_templates` テーブル、スナップショット/作成API、ホームの `ProjectTemplateBar` |
| インポート | `POST /api/projects/[id]/import`（CSV）、Overviewの `ImportForm` |
| エクスポート | `GET /api/projects/[id]/export?format=json|csv` |
| ポートフォリオ | `POST/DELETE/GET /api/portfolio`（個人の「マイポートフォリオ」） |
| 権限 | プロジェクトロール、フィールドアクセス、RBAC |
| サイドバー右クリック | 共有、新規タブ、リンク、外観、名前変更、お気に入り、ポートフォリオ、アーカイブ |

### 3.2 不足しているもの

- プロジェクト名横の常設「↓」アクションメニュー
- 設定ダイアログ（詳細、依存関係、スケジュール、Notifications）
- 権限管理の統合画面
- プロジェクト複製API/UI
- テンプレート保存のプロジェクトページ導線
- ポートフォリオ選択ダイアログ（現在は個人ポートフォリオへ即追加）
- プロジェクトからテーブル作成（テーブルモデル自体がない）
- エクスポート/同期のサブメニュー、XLSX、印刷、公開リンク、外部カレンダー
- Slack/Teams通知連携
- プロジェクト削除のUI、確認、ゴミ箱、復元
- 削除の安全性（現状は物理削除で、マルチホーミングタスクへの影響が大きい）
- オーナー、関連チーム、プロジェクト期日のデータモデル

### 3.3 データモデル上の注意

`projects` は現在、名前・説明・アイコン・色・ステータス・アーカイブ日時などを持ちますが、以下がありません。

- `owner_id`
- `team_id`
- `due_on`
- 依存関係のバッファ設定
- 勤務日/勤務時間
- `deleted_at`（ゴミ箱）
- Notifications設定

また、プロジェクト削除は現在 `DELETE /api/projects/[id]` の物理削除です。タスクは `projects` に `ON DELETE CASCADE` で紐づくため、**マルチホーミングしているタスクを他のプロジェクトから消してしまう危険**があります。削除フェーズでは、物理削除ではなく「プロジェクト所属の解除」「プロジェクト専用データの削除」「ゴミ箱/復元」を分けて設計する必要があります。

## 4. 目標アーキテクチャ

### 4.1 UI

- `ProjectTitle` の直後に `ProjectActionsButton`（下向き矢印）を追加
- 既存の `ProjectContextMenu` のアクション実装を共通化し、ヘッダーとサイドバー右クリックの両方から利用
- `ProjectActionsMenu`
  - portal描画
  - 3グループ、区切り線、アイコン
  - サブメニュー（カラー/インポート/エクスポート）
  - 破壊的項目は赤
  - 外側クリック、Escape、キーボード移動
  - 権限に応じて非表示/無効化
- `ProjectActionHost`
  - rename, appearance, settings, permissions, duplicate, template, portfolio, import, export, archive, delete のダイアログ状態を一元管理

### 4.2 API / DB

- `PATCH /api/projects/[id]` を拡張
  - owner_id, team_id, due_on, dependency_buffer_mode, work_schedule
  - もしくは `projects.settings JSONB` にまとめる
- `GET /api/projects/[id]/settings`（必要なら）
- `POST /api/projects/[id]/duplicate`
- `GET/PATCH /api/projects/[id]/permissions`
- `GET /api/projects/trash`, `DELETE /api/projects/[id]`（soft delete）, `POST /api/projects/[id]/restore`
- `POST /api/projects/[id]/template`（既存 `project-templates` を拡張）
- `GET /api/projects/[id]/export?format=xlsx|json|csv`
- `GET /api/projects/[id]/print`
- `POST /api/projects/[id]/public-links`
- `POST /api/projects/[id]/table`（将来）

DB追加候補:

- `projects.owner_id`
- `projects.team_id`
- `projects.due_on`
- `projects.settings JSONB`（依存関係、勤務日、通知）
- `projects.deleted_at`
- `project_permissions` もしくは `settings.permissions`
- `project_public_links`
- テーブル機能用の別モデル

### 4.3 権限

- 設定変更、権限管理、アーカイブ、削除: プロジェクトadmin
- 複製、テンプレート保存、インポート: 編集権限以上（要件次第）
- エクスポート、リンクコピー: 閲覧権限以上
- 削除・アーカイブ・権限変更は、メニュー上で危険操作として明示

## 5. 実装フェーズ

### Phase 0: メニュー基盤（2〜3人日）

目的: ヘッダーの矢印から開く共通メニューとアクションホストを作る。

- `ProjectActionsButton` を `ProjectTitle` 隣に追加
- `ProjectActionsMenu` を新設
  - 3グループ、区切り線、アイコン、赤い削除
  - サブメニューの開閉
  - Escape/外側クリック/キーボード
- サイドバー右クリックの既存アクションを `useProjectActions` / `ProjectActionHost` に抽出
- 既存の rename / appearance / share / archive をメニューから呼べるようにする
- 権限による表示制御
- 未実装の項目は機能フラグで非表示にし、実装済み項目だけを段階的に公開する

受け入れ条件:

- メニューの見た目がAsana相当（幅約256px、行36px、3グループ）
- 既存アクションがヘッダーとサイドバーの両方から同じ動作
- Escape/外側クリックで閉じる
- E2Eでメニュー項目とグループを検証

### Phase 1: 既存機能の集約（3〜4人日）

目的: 既にAPI/UIがある機能をメニューに載せ、価値を早く出す。

- カラーとアイコンを設定 → `ProjectAppearanceDialog`
- プロジェクトのリンクをコピー
- ポートフォリオに追加 → まずは既存の個人ポートフォリオへ追加
- アーカイブ → `ArchiveProjectDialog`
- インポート → 既存CSVインポート
- エクスポート → 既存JSON/CSV（最初はサブメニューを簡略化）
- テンプレートとして保存 → 既存 `project_templates` のスナップショットAPIを呼ぶダイアログ
- 複製の「基本版」またはプレースホルダーはまだ出さない

受け入れ条件:

- 各ダイアログが開き、既存APIで処理できる
- 既存のサイドバー操作と重複しても状態が破綻しない
- エクスポート/インポートの成功・失敗がUIに出る

### Phase 2: 設定と権限（5〜7人日）

目的: メニューの中核である管理機能を実装する。

- `ProjectSettingsDialog`
  - タブ: 詳細 / 依存関係 / スケジュール / Notifications
  - 詳細: 名前、説明、オーナー、関連チーム、期日、ポートフォリオ
  - 依存関係: バッファ維持/埋める/なし
  - スケジュール: 勤務日、勤務時間
  - Notifications: 最初はメール/アプリ内設定、Slack/Teamsは後続
- `ProjectPermissionsDialog`
  - 既存のプロジェクトロールを一覧・変更
  - フィールドアクセスの一覧
  - ワークフロー編集・メンバー共有の権限
- DB追加: owner_id, team_id, due_on, settings JSONB
- API: 設定取得/更新、権限取得/更新
- 監査ログ

受け入れ条件:

- 設定変更が保存され、再読込後も維持
- admin以外は設定/権限を変更できない
- 依存関係/スケジュールは最低限の保存・表示ができる
- 既存のフィールドアクセスと矛盾しない

### Phase 3: 複製とテンプレート（6〜9人日）

目的: プロジェクト構造を複製・再利用できるようにする。

- `DuplicateProjectDialog`
  - 最初のリリース: プロジェクト名、説明、セクション、タスク、サブタスク、カスタムフィールド、担当者、期日、メンバー
  - 後続: オートメーション、フォーム、権限、タブ、タスクタイプ、テンプレート
- `POST /api/projects/[id]/duplicate`
  - DBトランザクション
  - マルチホーミングの扱いを定義（新プロジェクトにコピーを作る）
  - 大きいプロジェクトは進捗/タイムアウトを考慮
- テンプレート保存ダイアログ
  - 既存スナップショットAPIを拡張し、カスタムフィールド・セクション・タスクを含める
  - 除外項目（アプリ、完了タスク、ノート、ダッシュボード内容）を明示
- テンプレートからの作成導線をホーム以外にも追加

受け入れ条件:

- 複製元と複製先が独立している（片方の変更が他方に影響しない）
- タスク・フィールド・値・メンバーが正しくコピーされる
- 失敗時に中途半端なプロジェクトが残らない
- テンプレート保存→新規作成が通る

### Phase 4: 削除・ゴミ箱・アーカイブ（3〜4人日）

目的: 破壊的操作を安全にする。

- `DeleteProjectDialog`
  - Asana同様の削除対象リスト
  - プロジェクト名の再入力または強い確認
- 物理削除から**ソフト削除**へ
  - `projects.deleted_at`
  - プロジェクト一覧/検索/ポートフォリオから除外
  - ゴミ箱一覧、復元
- マルチホーミングタスクの扱い
  - 他プロジェクトに属するタスクは削除せず、所属だけ解除
  - プロジェクト専用タスクのみ削除対象
- アーカイブと削除の違いをUIで説明
- 監査ログ、削除後のリダイレクト

受け入れ条件:

- 削除確認に対象データが明示される
- 削除後はプロジェクトが一覧から消えるが、ゴミ箱から復元できる
- マルチホーミングタスクが他のプロジェクトから消えない
- admin以外は削除できない

### Phase 5: エクスポート/同期の拡張（5〜8人日 + 外部連携）

目的: Asanaの出力・同期サブメニューに近づける。

- 既存のCSV/JSONに加えてXLSX
- 印刷用ビュー
- Outlook/Google/iCal/Googleスプレッドシート連携
- 公開リンク（トークン、権限、失効、監査）
- 時間入力CSV
- 外部連携は認証・トークン管理・失敗時再試行が必要なため、独立した連携基盤として設計

受け入れ条件:

- 各形式でデータ欠損がない
- 公開リンクは権限・有効期限・失効が管理できる
- 外部同期の失敗がUI/ログに残る

### Phase 6: プロジェクトからテーブルを作成（10〜20人日、別Epic）

Atlasには現在「テーブル」というデータモデル/ビューがありません。Asanaの「プロジェクトからテーブルを作成」は、プロジェクトのメタデータ・メンバー・タブ・カスタムフィールド・セクション・タスク詳細を変換する大型機能です。

- テーブル/レコードの新モデル
- テーブルビュー
- プロジェクト→テーブル変換
- 元プロジェクトのアーカイブオプション
- 変換後の双方向関係/参照

このフェーズは他の10項目と分離し、テーブル機能そのものの要件定義後に着手します。

## 6. リリース計画（推奨）

### Release 1: メニューの土台と日常操作

- Phase 0 + Phase 1
- 対象: メニュー基盤、外観、リンク、ポートフォリオ、アーカイブ、インポート、エクスポート、テンプレート保存（既存APIの範囲）
- 設定・権限・複製・削除は次のリリースまで非表示
- 目安: 1週間

### Release 2: 管理機能

- Phase 2 + Phase 4
- 対象: 設定ダイアログ、権限ダイアログ、削除/ゴミ箱
- 目安: 1.5〜2週間

### Release 3: 複製と本格テンプレート

- Phase 3 + Phase 5の基本部分
- 対象: 複製、テンプレート、XLSX、印刷
- 目安: 1.5〜2週間

### Later: 同期・公開リンク・テーブル

- 外部カレンダー/Sheets/Slack/Teams
- 公開リンク
- テーブル変換

## 7. テスト方針

- E2E
  - メニュー項目の順序・グループ・アイコン・削除の赤表示
  - 各ダイアログの開閉
  - 権限別の表示/非表示
  - Escape/外側クリック/キーボード
  - 設定保存、複製、テンプレート、削除/復元
- データ整合性
  - 複製の独立性
  - マルチホーミングタスクの保持
  - プロジェクト専用フィールド/タスクの削除範囲
  - 監査ログ
- 視覚検証
  - Asanaメニュー（256×467px、36px行）との比較
  - ヘッダーの矢印位置、メニューのアンカー
- 回帰
  - 既存のサイドバー右クリックメニュー
  - プロジェクト共有/メンバー管理
  - 既存のアーカイブ、エクスポート、インポート

## 8. リスクと未決事項

- Asanaの権限管理はEnterprise前提。Atlasのロール/フィールドアクセスにどこまで寄せるか。
- 削除の物理/論理方式。マルチホーミングタスクの扱いを先に決める必要がある。
- 複製のオプション範囲。オートメーション、フォーム、権限、タスクタイプまで含めると工数が大きい。
- テンプレートの除外仕様（アプリ、完了タスク、ノート、ダッシュボード内容）。
- ポートフォリオを個人単位のままにするか、共有ポートフォリオにするか。
- 公開リンクのセキュリティ（トークン、期限、失効、検索エンジン除外）。
- Slack/Teams通知、Google/Outlook同期の外部認証・運用。
- テーブル機能のデータモデルと既存タスクとの関係。
- 大規模プロジェクトの複製/エクスポートのタイムアウトと非同期ジョブ化。

## 9. 実装状況（2026-11-09）

ロードマップの Phase 0〜4 と、Phase 5/6 の基本部分を実装しました。

| Phase | 状態 | 実装内容 |
|---|---|---|
| 0 メニュー基盤 | 完了 | プロジェクト名横の下向き矢印、3グループ・12項目のメニュー、サブメニュー、キーボード/外側クリック/Escape、権限別表示 |
| 1 既存機能の集約 | 完了 | カラー/アイコン、リンクコピー、ポートフォリオ追加/削除、アーカイブ、CSVインポート、CSV/XLSX/JSON/時間CSV/iCal/印刷/公開リンク、テンプレート保存 |
| 2 設定と権限 | 完了 | 設定ダイアログ（詳細/依存関係/スケジュール/Notifications）、権限ダイアログ（ロール、共有権限、フィールドアクセス）、owner/team/due/settings、監査ログ |
| 3 複製とテンプレート | 完了 | トランザクション複製（セクション、階層タスク、カスタムフィールド値、メンバー）、v2テンプレート保存/作成（入れ子タスク・フィールド値対応） |
| 4 削除/ゴミ箱 | 完了 | 名前入力付き削除確認、ソフト削除、ゴミ箱一覧、復元、完全削除、マルチホーミングタスクの再親付け |
| 5 エクスポート/同期 | 基本完了 | XLSX、時間CSV、iCal、印刷、公開リンクを実装。Google/Outlook/Sheets/Slack/Teams のOAuth同期は未実装（Later） |
| 6 テーブル変換 | 基本実装 | プロジェクトのスナップショットテーブル作成、`/tables/[id]` 表示、CSV/XLSXダウンロード、元プロジェクトの任意アーカイブ。本格的なテーブルプロダクトは別Epic |

### 主な追加ファイル

- `app/components/project/ProjectActionsButton.tsx`
- `app/components/project/ProjectActionsMenu.tsx`
- `app/components/project/ProjectSettingsDialog.tsx`
- `app/components/project/ProjectPermissionsDialog.tsx`
- `app/components/project/DuplicateProjectDialog.tsx`
- `app/components/project/SaveProjectTemplateDialog.tsx`
- `app/components/project/ProjectImportDialog.tsx`
- `app/components/project/AddToPortfolioDialog.tsx`
- `app/components/project/CreateTableDialog.tsx`
- `app/components/project/DeleteProjectDialog.tsx`
- `app/lib/project-actions.ts`
- `app/lib/project-settings.ts`
- `app/lib/project-delete.ts`
- `app/lib/xlsx.ts`
- `app/app/api/projects/[id]/settings/route.ts`
- `app/app/api/projects/[id]/duplicate/route.ts`
- `app/app/api/projects/[id]/template/route.ts`
- `app/app/api/projects/[id]/trash/route.ts`
- `app/app/api/projects/[id]/restore/route.ts`
- `app/app/api/projects/[id]/table/route.ts`
- `app/app/api/tables/[id]/export/route.ts`
- `app/app/projects/[id]/print/page.tsx`
- `app/app/tables/[id]/page.tsx`
- `app/components/DeletedProjects.tsx`

### 検証結果

- TypeScript: `npx tsc --noEmit` エラーなし
- ESLint: 追加ファイルのエラーなし
- Production build: `docker compose up -d --build app` 成功
- E2E: `PASS=587 FAIL=0`（`docs/field-add-e2e.log`）
- App commits: `2710498`（メニュー/管理フロー一式）、`f5918e7`（権限別サブメニュー整理）、レビュー修正コミット（後述）
- UI: Asana相当のメニュー（幅264px、行36px、3グループ）をCDPで開き、12項目とサブメニューを確認
  - `docs/evidence/asana-project-actions/atlas-project-actions-menu.png`
  - `docs/evidence/asana-project-actions/atlas-project-actions-submenu.png`
  - `docs/evidence/asana-project-actions/atlas-project-settings.png`
  - `docs/evidence/asana-project-actions/atlas-project-settings-schedule.png`

### レビューで修正した不具合（2026-11-09）

- 複製・テンプレートで、マルチホーミング親タスク配下のサブタスクが欠落する問題を修正
- セクション未設定タスクがテンプレート保存で欠落する問題を修正（「未分類」セクションを自動作成）
- テンプレートでリッチテキスト説明（description_doc）が欠落する問題を修正
- プロジェクト期日に実在しない日付（例: 2026-99-99）を送ると500になる問題を400に修正
- 勤務開始≧勤務終了を保存できる問題をクライアント/API双方で拒否
- 権限ダイアログの「共有権限」説明がワークフロー編集の文言になっていたコピー不備を修正
- 公開リンク作成時にクリップボードAPIが使えない場合でも「コピーしました」と表示する誤表示を修正
- 印刷ビューでセクション未設定タスクが表示されない問題を修正
- 「複製」メニューは編集者に表示されるがAPIが管理者限定だった権限不整合を修正（APIを編集権限に変更）

未適用のポリシー:
- `who_can_edit` / `who_can_share` と通知設定は保存のみで、権限チェック/配信への適用は今後のリリースです（ダイアログ内にも明記）。

### 未実装（Later）

- Google/Outlookカレンダー、Googleスプレッドシート、Slack/TeamsのOAuth連携
- Asana Enterprise相当の高度な権限ポリシー
- 本格的なテーブルプロダクト（双方向参照、ビュー、レコード型）
- 大規模プロジェクトの非同期複製ジョブ

## 10. 証跡

- `docs/evidence/asana-project-actions/report.txt`
- `docs/evidence/asana-project-actions/research.json`
- `docs/evidence/asana-project-actions/asana-project-actions-menu.png`
- `docs/evidence/asana-project-actions/asana-project-settings.png`
- `docs/evidence/asana-project-actions/asana-project-settings-tabs.png`
- `docs/evidence/asana-project-actions/asana-project-permissions.png`
- `docs/evidence/asana-project-actions/asana-project-duplicate.png`
- `docs/evidence/asana-project-actions/asana-project-template.png`
- `docs/evidence/asana-project-actions/asana-project-portfolio.png`
- `docs/evidence/asana-project-actions/asana-project-table.png`
- `docs/evidence/asana-project-actions/asana-project-delete.png`
- `docs/evidence/asana-project-actions/asana-project-appearance.png`
- Atlas implementation screenshots:
  - `docs/evidence/asana-project-actions/atlas-project-actions-menu.png`
  - `docs/evidence/asana-project-actions/atlas-project-actions-submenu.png`
  - `docs/evidence/asana-project-actions/atlas-project-settings.png`
  - `docs/evidence/asana-project-actions/atlas-project-settings-schedule.png`
  - `docs/evidence/asana-project-actions/atlas-project-permissions.png`
  - `docs/evidence/asana-project-actions/atlas-project-duplicate.png`
  - `docs/evidence/asana-project-actions/atlas-project-delete.png`
  - `docs/evidence/asana-project-actions/atlas-project-table.png`
- REA evidence:
  - `ev_8c8aaa694cf0c8f4f8ceb0a6cf6fc2922552432893ee0fa170055a11eac9a26f`（targets）
  - `ev_9aa14cf2d0acac876298920414fed98d9139cb9c3d40a8c86081756a9ede5d87`（open menu page capture）
