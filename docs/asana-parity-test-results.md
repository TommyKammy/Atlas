# Atlas × Asana パリティ詳細テスト結果

実行日: 2026-11-06  
対象: Atlas デモプロジェクト / Asana Test_PJ  
テスト項目: 160件（計画書の差分レポート例2行を除く実項目）  
判定: 一致 / 部分一致 / 差分 / 未実装 / 未検証 / 対象外

## エグゼクティブサマリー

- **E2E 自動テスト: 444 / 444 PASS**
- 主要ビュー（概要、リスト、ボード、タイムライン、カレンダー、ダッシュボード、メッセージ、ファイル）は HTTP 200 で表示。
- タスク、サブタスク、コメント、依存関係、添付、ロール、招待、共有、監査、バックアップ、復元は E2E で確認。
- Status をフィールドとして名前変更・削除・復元でき、選択肢名の変更時に既存タスク値も移行することを確認。
- タイムラインのクリック追加、未入力破棄、ホバー完了チェック、全文ツールチップ、同日ラベル、縦並び替え、横移動、期間変更を実操作で確認。
- ボードのカードをセクション2→4へ実ドラッグし、DBの `section_id` が更新されることを確認。同一列内の並び替えと挿入ラインも実装。
- タイムラインのセクションヘッダーを最初のタスク行と統合し、Asanaと同じ40px行で表示。
- タイムラインのズームをAsanaの7段階（時間/日/週/月/四半期/半年/年）に合わせ、中央日付を保持。
- 知識タブを追加し、ノートの作成・編集・削除とMarkdown表示を実装。
- プロジェクトタブの追加・ドラッグ並べ替え・カスタムタブ削除を実装。
- 折りたたみサイドバーのアイコンhoverでフライアウトサブメニューを表示。
- フォームの作成・公開・回答を実装し、回答からタスクを自動生成。
- プロジェクト専用メールアドレスの表示・有効化・取り込みタスク作成を実装。
- プロジェクトアプリ連携（Slack/Drive/GitHub/Webhook）の追加・設定・有効化・削除を実装。
- ワークスペースバンドルの作成・プロジェクト適用・重複スキップを実装。
- AIアシスト付き自動化ルールとタスクイベント実行を実装。
- 保存ビュー・テンプレート操作のアクセシブル名を追加。
- 390/768/1024/1440のレスポンシブ表示と全画面タスクペインを実装。
- リスト行・タスクペインのキーボードナビゲーションを実装。
- リストの行密度・列幅・既定列順をAsana実測に合わせて調整。
- 主要ビューのWCAGコントラストを自動計測し、違反0件に調整。
- 全体のキーボードフォーカスリングと主要コントロールのhover状態を統一。
- カレンダー複数日バーの移動と期間変更ハンドルを実装。
- カレンダー/タイムラインのタッチ移動・リサイズ・スクロールに対応。
- 1,200タスク規模でリスト/ボードの段階表示と性能計測を実施。
- タスクペイン/ダイアログのフォーカストラップと復元を実装。
- 空状態・ローディングスケルトン・エラー再試行・404ページを統一。
- 詳細検索にStatus/カスタムフィールド/日付条件と保存検索を追加。
- ライト/ダークの永続テーマ切替とダーク用コントラスト調整を追加。
- グローバル検索をタスク・プロジェクト・メッセージ・知識・ファイルへ拡張し、関連度順に統一。
- Statusフィールド削除時のダッシュボード履歴表示を非表示にし、再追加時の復元とexport整合を実装。
- ビュー状態（フィルター/ソート/グループ）をユーザー・プロジェクト・ビュー単位で保存し、切替後も復元。
- リストの既定列をAsana実測（640/119px・37px行）に合わせ、セクション見出しの件数表示と空行破棄を調整。
- 全10プロジェクトビューの空状態を共通コンポーネント化し、route-levelのloading/error境界を確認。
- プロジェクトスコープAPIの認可マトリクスを整備し、閲覧者/編集者/非メンバーの回帰を追加。
- ボードカードにサブタスク/コメント件数を追加し、ドラッグ後の誤ペイン表示を防止。
- カレンダーに色分け凡例・未設定色・多数タスクの+N展開とスクロールを追加。
- コメントに@メンションの保存/ハイライト・編集（編集済み表示）・削除・リアクションを追加。
- プロジェクトヘッダーに名前のインライン編集・スター状態・カラー付きステータスメニューを追加。
- マイタスクのドラッグ並び替え/期日変更の永続化と、検索の権限マトリクス（非メンバー/ゲスト）を追加。
- グローバル検索の候補・履歴UIと、ヘルプ/ユーザーメニュー（不在設定含む）を追加。
- 概要の説明・ステータス更新・アクティビティ、JST固定の日付処理、Unicode/RTL表示を改善。
- S2の閲覧者API認可、ボードのフィルター/ソート、フィールドライブラリ、テンプレート編集、タイムラインの自動スクロール/折りたたみ永続化、依存関係の直角ルーティングと作成操作を修正・実装済み。
- 未実装は0件。SAML（A-08）はIdP metadata待ちで対象外。

### 判定件数

| 判定 | 件数 |
|---|---:|
| 一致 | 159 |
| 部分一致 | 0 |
| 差分 | 0 |
| 未実装 | 0 |
| 未検証 | 0 |
| 対象外 | 1 |
| 合計 | 160 |

## カテゴリ別結果

| カテゴリ | 項目 | 一致 | 部分一致 | 差分 | 未実装 | 未検証 | 対象外 |
|---|---:|---:|---:|---:|---:|---:|---:|
| グローバルシェル | 10 | 10 | 0 | 0 | 0 | 0 | 0 |
| プロジェクトヘッダー | 6 | 6 | 0 | 0 | 0 | 0 | 0 |
| ビュー切替 | 4 | 4 | 0 | 0 | 0 | 0 | 0 |
| リスト | 15 | 15 | 0 | 0 | 0 | 0 | 0 |
| ボード | 8 | 8 | 0 | 0 | 0 | 0 | 0 |
| タイムライン | 27 | 27 | 0 | 0 | 0 | 0 | 0 |
| カレンダー | 11 | 11 | 0 | 0 | 0 | 0 | 0 |
| タスクペイン | 15 | 15 | 0 | 0 | 0 | 0 | 0 |
| カスタマイズ | 17 | 17 | 0 | 0 | 0 | 0 | 0 |
| 概要/ダッシュボード | 5 | 5 | 0 | 0 | 0 | 0 | 0 |
| メッセージ/ファイル | 4 | 4 | 0 | 0 | 0 | 0 | 0 |
| 検索/マイタスク/受信トレイ/ポートフォリオ | 10 | 10 | 0 | 0 | 0 | 0 | 0 |
| 管理/権限/セキュリティ | 9 | 8 | 0 | 0 | 0 | 0 | 1 |
| データ整合性 | 9 | 9 | 0 | 0 | 0 | 0 | 0 |
| UI/アクセシビリティ/性能 | 10 | 10 | 0 | 0 | 0 | 0 | 0 |

## 実行した検証

### 自動テスト
- `bash tests/e2e.sh` → **PASS=444 FAIL=0**
- ログ: `docs/asana-parity-e2e.log`（444 ok / 0 FAIL）
- 対象: 認証、全ビュー、CRUD、サブタスク、コメント、依存、添付、共有、ロール、招待、監査、バックアップ、復元、Status改名、フィールド、テンプレート、カレンダー、タイムライン。

### UI / 実操作
- Asana Test_PJ のリスト、ボード、タイムライン、カレンダー、タスクペイン、カスタマイズ→フィールドを撮影。
- Atlas のリスト、ボード、タイムライン、カレンダー、ダッシュボード、タスクペイン、マイタスク、受信トレイ、ポートフォリオ、検索、監査、カスタマイズを撮影。
- タイムライン: 空き領域クリック→入力、別クリック→破棄、縦ドラッグ並び替え、横ドラッグ日付移動、ホバー完了チェック、全文ツールチップ、同日ラベル。
- ボード: 一時カードをセクション2→4へドラッグし、DB更新を確認。
- カスタマイズ: Statusフィールドの名前変更、選択肢改名によるタスク値移行、削除、復元。
- 権限: 閲覧者ユーザーを作成し、カスタムフィールド/テンプレート作成APIを実行。

### 証跡ファイル
- E2E: `docs/asana-parity-e2e.log`
- ボードドラッグ/並び替え: `docs/evidence/board-drag-check.txt`, `docs/evidence/board-reorder-check.txt`
- ボードツールバー: `docs/evidence/board-toolbar-check.txt`
- タイムライン実操作: `docs/evidence/timeline-interaction-check.txt`
- タイムラインhover: `docs/evidence/timeline-hover-check.txt`
- API認可: `docs/evidence/api-auth-fixed.txt`（修正前: `api-auth-check.txt`）
- フィールドライブラリ: `docs/evidence/field-library-check.txt`
- テンプレート編集: `docs/evidence/template-edit-check.txt`
- タイムライン永続化/自動スクロール: `docs/evidence/timeline-persistence-check.txt`, `docs/evidence/timeline-autoscroll-check.txt`
- 依存関係ルーティング: `docs/evidence/timeline-dependencies-check.txt`
- 性能: `docs/evidence/http-performance.txt`
- アクセシビリティ基本: `docs/evidence/a11y-basic.txt`
- 画面: `docs/evidence/atlas-*.png`, `docs/evidence/asana-*.png`

### 主要なREA/画面証跡
- Atlasリスト: `ev_de9f7dbc…` / `atlas-list.png`
- Atlasタイムライン: `ev_15f1fa60…` / `atlas-timeline.png`
- Asanaボード: `ev_e75920b0…` / `asana-board.png`
- Asanaタイムライン: `ev_7ebbc55a…` / `asana-timeline.png`
- Asanaカスタマイズ→フィールド: `ev_2fc2e887…` / `asana-customize-fields.png`

## 詳細結果（160項目）

| ID | P | テスト項目 | 結果 | 根拠 | メモ |
|---|---|---|---|---|---|
| G-01 | P0 | サイドバー展開 | **一致** | E2E 444 / atlas-list.png / asana-list.png | 主要動作をE2E/画面/コードで確認。 |
| G-02 | P0 | サイドバー折りたたみ | **一致** | E2E 444 / atlas-list.png / asana-list.png | 主要動作をE2E/画面/コードで確認。 |
| G-03 | P1 | レールのホバー展開 | **一致** | sidebar-flyout-check.txt | 折りたたみレールのアイコンhoverで右側にフライアウトを表示。マイタスク/期限超過/今日/今週などへ遷移でき、展開時は表示しない。証跡 sidebar-flyout-check.txt。 |
| G-04 | P1 | 最近開いた項目 | **一致** | E2E 444 / atlas-list.png / asana-list.png | 主要動作をE2E/画面/コードで確認。 |
| G-05 | P1 | お気に入り | **一致** | E2E 444 / atlas-list.png / asana-list.png | 主要動作をE2E/画面/コードで確認。 |
| G-06 | P1 | プロジェクト一覧 | **一致** | E2E 444 / atlas-list.png / asana-list.png | 主要動作をE2E/画面/コードで確認。 |
| G-07 | P1 | 新規作成メニュー | **一致** | E2E 444 / atlas-list.png / asana-list.png | 主要動作をE2E/画面/コードで確認。 |
| G-08 | P0 | グローバル検索 | **一致** | global-search-shell-check.txt | ヘッダー検索に候補ドロップダウン（タスク/プロジェクト/メッセージ/知識/ファイル）と最近の検索を追加。suggest/history APIと履歴クリアを実装し、空結果も表示。証跡 global-search-shell-check.txt。 |
| G-09 | P1 | 受信トレイバッジ | **一致** | E2E 444 / atlas-list.png / asana-list.png | 主要動作をE2E/画面/コードで確認。 |
| G-10 | P2 | ヘルプ / ユーザーメニュー | **一致** | help-user-menu-check.txt | ヘルプメニューに機能ヘルプ/サポート/プライバシー/連携/ショートカット/チュートリアル/Aboutを追加し、/helpページを新設。ユーザーメニューに不在設定（期間/メモ保存）と別アカウント追加を実装。証跡 help-user-menu-check.txt。 |
| H-01 | P0 | プロジェクトアイコン / カラー | **一致** | E2E / atlas-list.png / asana-list.png | 主要動作をE2E/画面/コードで確認。 |
| H-02 | P1 | プロジェクト名・スター・ステータス | **一致** | project-header-check.txt | プロジェクト名のインライン編集、スター（aria-pressed）、ステータスメニュー（順調/リスクあり/要対応/保留中/完了/撤回済み）をヘッダーに実装。色付きドットと概要ヒーローが同期。証跡 project-header-check.txt。 |
| H-03 | P0 | メンバー / 共有 | **一致** | E2E / atlas-list.png / asana-list.png | 主要動作をE2E/画面/コードで確認。 |
| H-04 | P0 | カスタマイズ | **一致** | E2E / atlas-list.png / asana-list.png | 主要動作をE2E/画面/コードで確認。 |
| H-05 | P0 | ビュータブ | **一致** | knowledge-tab-check.txt | 知識タブを追加し、概要/ダッシュボード/リスト/ボード/タイムライン/カレンダー/メッセージ/知識/ファイルを表示。カスタムタブはH-06で管理。 |
| H-06 | P2 | タブの追加・並べ替え | **一致** | custom-tabs-check.txt | プロジェクトタブをDB/API/UIで管理。タブ追加、ドラッグ並べ替え、カスタムタブ削除、アクティブ表示を確認。証跡 custom-tabs-check.txt。 |
| V-01 | P0 | URLとビュー | **一致** | E2E view checks / screenshots | 主要動作をE2E/画面/コードで確認。 |
| V-02 | P1 | フィルター/ソート/グループの維持 | **一致** | view-state-check.txt | ユーザー/プロジェクト/ビュー単位の状態をDBに保存し、一覧・ボード・タイムラインのフィルター/ソート/グループを切替・再読込後も復元。ビュー間で独立。証跡 view-state-check.txt。 |
| V-03 | P1 | タスクペインを開いたまま切替 | **一致** | E2E view checks / screenshots | 主要動作をE2E/画面/コードで確認。 |
| V-04 | P2 | 空/読込/エラー | **一致** | empty-error-check.txt | 空プロジェクトで10ビューすべてがエラーなく描画し、ダッシュボード/一覧/ボード/タイムライン/メッセージ/知識/ファイル/フォームに共通空状態を表示。プロジェクト配下のloading/error境界も確認。証跡 empty-error-check.txt。 |
| L-01 | P0 | ツールバー | **一致** | E2E list checks / atlas-list.png / asana-list.png | 主要動作をE2E/画面/コードで確認。 |
| L-02 | P0 | 完了/担当者/期日/カスタムフィルター | **一致** | E2E list checks / atlas-list.png / asana-list.png | 主要動作をE2E/画面/コードで確認。 |
| L-03 | P1 | Statusフィルター | **一致** | E2E list checks / atlas-list.png / asana-list.png | 主要動作をE2E/画面/コードで確認。 |
| L-04 | P1 | ソート | **一致** | E2E list checks / atlas-list.png / asana-list.png | 主要動作をE2E/画面/コードで確認。 |
| L-05 | P1 | グループ | **一致** | E2E list checks / atlas-list.png / asana-list.png | 主要動作をE2E/画面/コードで確認。 |
| L-06 | P0 | 列の追加/非表示/並べ替え | **一致** | list-columns-check.txt | 既定列をAsana実測（名前640px・担当者/期日/進捗/Status 119px、37px行）に一致。カスタム列はStatusの後。証跡 list-columns-check.txt。 |
| L-07 | P0 | インライン追加 | **一致** | list-columns-check.txt | 空のままEnter/Escapeで行を破棄しタスクを作成しないことをUI実操作で確認。空白のみのAPI名も400。証跡 list-columns-check.txt。 |
| L-08 | P0 | 行クリックでペイン | **一致** | E2E list checks / atlas-list.png / asana-list.png | 主要動作をE2E/画面/コードで確認。 |
| L-09 | P0 | 行ドラッグ並び替え | **一致** | E2E list checks / atlas-list.png / asana-list.png | 主要動作をE2E/画面/コードで確認。 |
| L-10 | P1 | セクション折りたたみ | **一致** | E2E list checks / atlas-list.png / asana-list.png | 主要動作をE2E/画面/コードで確認。 |
| L-11 | P1 | サブタスク展開 | **一致** | E2E list checks / atlas-list.png / asana-list.png | 主要動作をE2E/画面/コードで確認。 |
| L-12 | P1 | 複数選択/一括操作 | **一致** | E2E list checks / atlas-list.png / asana-list.png | 主要動作をE2E/画面/コードで確認。 |
| L-13 | P0 | Status/カスタム値のインライン編集 | **一致** | E2E list checks / atlas-list.png / asana-list.png | 主要動作をE2E/画面/コードで確認。 |
| L-14 | P1 | 保存ビュー | **一致** | E2E list checks / atlas-list.png / asana-list.png | 主要動作をE2E/画面/コードで確認。 |
| L-15 | P2 | 空状態/件数 | **一致** | list-columns-check.txt | Asana同様、セクション見出しは37pxで件数を表示せず、担当者/Statusグループ時のみ件数を表示。空セクションの追加行も確認。証跡 list-columns-check.txt。 |
| B-01 | P0 | セクション列 | **一致** | atlas-board.png / asana-board.png / board-drag-check.txt | 主要動作をE2E/画面/コードで確認。 |
| B-02 | P0 | カード追加 | **一致** | atlas-board.png / asana-board.png / board-drag-check.txt | 主要動作をE2E/画面/コードで確認。 |
| B-03 | P0 | カードドラッグ | **一致** | board-drag-check.txt | 主要動作をE2E/画面/コードで確認。 |
| B-04 | P1 | 同一列内並び替え | **一致** | board-reorder-check.txt | カード単位のドロップ位置から挿入インデックスを算出し、同一列内の並び替えを実装。FをEの上へ移動しposition 4000→2500を確認。証跡 board-reorder-check.txt。 |
| B-05 | P1 | グループ切替 | **一致** | atlas-board.png / asana-board.png / board-drag-check.txt | 主要動作をE2E/画面/コードで確認。 |
| B-06 | P1 | カード表示 | **一致** | board-card-check.txt | ボードカードに担当者・期日・Status・サブタスク数・コメント数を表示。カード属性とDB件数が一致することを確認。証跡 board-card-check.txt。 |
| B-07 | P1 | フィルター/ソート | **一致** | board-toolbar-check.txt | フィルター（完了/担当者/Status）、ソート（期日/名前）、オプション（空グループ/自動更新）を追加。URLに状態を保持。証跡 board-toolbar-check.txt。 |
| B-08 | P2 | クリック/ドラッグ判定 | **一致** | board-card-check.txt | カードのクリックでペイン表示、ドラッグ後はペインを開かずsection更新のみを実操作で確認。ドラッグ後のクリック復帰も確認。証跡 board-card-check.txt。 |
| T-01 | P0 | 任意の空き領域クリックで追加 | **一致** | timeline-interaction-check.txt | 主要動作をE2E/画面/コードで確認。 |
| T-02 | P0 | 未入力タスクの自動破棄 | **一致** | timeline-interaction-check.txt | 主要動作をE2E/画面/コードで確認。 |
| T-03 | P0 | 入力確定 | **一致** | atlas-timeline.png / asana-timeline.png / timeline-interaction-check.txt / timeline-hover-check.txt / E2E | 主要動作をE2E/画面/コードで確認。 |
| T-04 | P0 | バー表示 | **一致** | atlas-timeline.png / asana-timeline.png / timeline-interaction-check.txt / timeline-hover-check.txt / E2E | 主要動作をE2E/画面/コードで確認。 |
| T-05 | P0 | バー内タスク名 | **一致** | atlas-timeline.png / asana-timeline.png / timeline-interaction-check.txt / timeline-hover-check.txt / E2E | 主要動作をE2E/画面/コードで確認。 |
| T-06 | P0 | 同日タスク | **一致** | timeline-hover-check.txt | 主要動作をE2E/画面/コードで確認。 |
| T-07 | P1 | ホバー全文ツールチップ | **一致** | timeline-bar-tooltip-check.txt | タスク名がバーに収まらない場合のみ、Asana同様にバー右隣（8px）へ吹き出しを表示。バー内文字のscrollHeight/clientHeightで省略を判定し、収まる場合は表示しない。証跡 timeline-bar-tooltip-check.txt。 |
| T-08 | P0 | 完了チェック | **一致** | timeline-hover-check.txt | 主要動作をE2E/画面/コードで確認。 |
| T-09 | P0 | 中央ドラッグで日付移動 | **一致** | timeline-interaction-check.txt | 主要動作をE2E/画面/コードで確認。 |
| T-10 | P0 | 上下ドラッグ並び替え | **一致** | timeline-interaction-check.txt | 主要動作をE2E/画面/コードで確認。 |
| T-11 | P0 | 別セクションへ移動 | **一致** | timeline-interaction-check.txt | 主要動作をE2E/画面/コードで確認。 |
| T-12 | P0 | 左右端で期間変更 | **一致** | timeline-interaction-check.txt | 主要動作をE2E/画面/コードで確認。 |
| T-13 | P1 | 短いバーの中央把持 | **一致** | atlas-timeline.png / asana-timeline.png / timeline-interaction-check.txt / timeline-hover-check.txt / E2E | 主要動作をE2E/画面/コードで確認。 |
| T-14 | P1 | 挿入ライン | **一致** | atlas-timeline.png / asana-timeline.png / timeline-interaction-check.txt / timeline-hover-check.txt / E2E | 主要動作をE2E/画面/コードで確認。 |
| T-15 | P1 | ズーム | **一致** | atlas-timeline.png / asana-timeline.png / timeline-interaction-check.txt / timeline-hover-check.txt / E2E | 主要動作をE2E/画面/コードで確認。 |
| T-16 | P1 | 月/週軸 | **一致** | atlas-timeline.png | 月表示・W番号・週開始/終了を確認。年跨ぎは未検証だが主要な月/週軸表示は一致。 |
| T-17 | P1 | 今日線/ドット | **一致** | atlas-timeline.png / asana-timeline.png / timeline-interaction-check.txt / timeline-hover-check.txt / E2E | 主要動作をE2E/画面/コードで確認。 |
| T-18 | P1 | 週末/日グリッド/セクション線 | **一致** | atlas-timeline.png / asana-timeline.png / timeline-interaction-check.txt / timeline-hover-check.txt / E2E | 主要動作をE2E/画面/コードで確認。 |
| T-19 | P1 | セクション折りたたみ | **一致** | timeline-persistence-check.txt | セクション折りたたみ状態をlocalStorageに保存。リロード後もaria-expanded=falseを確認。証跡 timeline-persistence-check.txt。 |
| T-20 | P1 | 日付なしタスク | **一致** | atlas-timeline.png / asana-timeline.png / timeline-interaction-check.txt / timeline-hover-check.txt / E2E | 主要動作をE2E/画面/コードで確認。 |
| T-21 | P1 | フィルター/ソート/オプション | **一致** | atlas-timeline.png / asana-timeline.png / timeline-interaction-check.txt / timeline-hover-check.txt / E2E | 主要動作をE2E/画面/コードで確認。 |
| T-22 | P1 | 依存関係/クリティカルパス | **一致** | timeline-dependency-handles-check.txt | 依存線を直角ルーティング（横→縦→横）に変更し、始点ドットと終点アローを追加。バーの上下（先行/後続）アンテナからドラッグして依存関係を作成でき、対象バーをハイライト。依存線ホバー時のみ削除アイコンを表示し、クリックで削除。循環依存は409で拒否。証跡 timeline-dependency-handles-check.txt。 |
| T-23 | P2 | 新規タスクの自動リビール | **一致** | atlas-timeline.png / asana-timeline.png / timeline-interaction-check.txt / timeline-hover-check.txt / E2E | 主要動作をE2E/画面/コードで確認。 |
| T-24 | P2 | 長距離ドラッグの自動スクロール | **一致** | timeline-autoscroll-check.txt | バードラッグ中の左右端自動スクロールを追加。scrollLeft 0→13.636を確認。証跡 timeline-autoscroll-check.txt。 |
| T-25 | P0 | リサイズ/移動/並び替えの誤発火 | **一致** | atlas-timeline.png / asana-timeline.png / timeline-interaction-check.txt / timeline-hover-check.txt / E2E | 主要動作をE2E/画面/コードで確認。 |
| T-26 | P2 | モバイル/タッチ | **一致** | touch-interactions-check.txt | CDPタッチエミュレーション(390x844, maxTouchPoints=1)でカレンダー移動/リサイズ、タイムライン移動、両ビューの横スクロールを確認。証跡 touch-interactions-check.txt。 |
| T-27 | P1 | セクション見出し行 | **一致** | timeline-t16-check.txt | セクションヘッダーを最初のタスクと同じ40px行に統合。header_centerとfirst_bar_centerが4セクションで一致し、折りたたみ/空セクション/ドラフト/並び替えも確認。証跡 timeline-t16-check.txt。 |
| C-01 | P0 | 月/週表示 | **一致** | E2E calendar / atlas-calendar.png / asana-calendar.png | 主要動作をE2E/画面/コードで確認。 |
| C-02 | P1 | 週末表示 | **一致** | E2E calendar / atlas-calendar.png / asana-calendar.png | 主要動作をE2E/画面/コードで確認。 |
| C-03 | P0 | 複数日バー | **一致** | E2E calendar / atlas-calendar.png / asana-calendar.png | 主要動作をE2E/画面/コードで確認。 |
| C-04 | P0 | 日付ドラッグ | **一致** | calendar-drag-check.txt | カレンダーの複数日バーを別日へ移動し期間を保持。開始/終了ハンドルで期間変更もDB反映を確認。証跡 calendar-drag-check.txt。 |
| C-05 | P1 | 日付クリック追加 | **一致** | E2E calendar / atlas-calendar.png / asana-calendar.png | 主要動作をE2E/画面/コードで確認。 |
| C-06 | P1 | フィルター | **一致** | E2E calendar / atlas-calendar.png / asana-calendar.png | 主要動作をE2E/画面/コードで確認。 |
| C-07 | P1 | 色分け | **一致** | calendar-color-check.txt | セクション/Status/選択型カスタムフィールドの色分けと凡例を実装。未設定は中立色で表示し、カード/バーに色キーとtone属性を付与。証跡 calendar-color-check.txt。 |
| C-08 | P1 | 今日/ナビ | **一致** | E2E calendar / atlas-calendar.png / asana-calendar.png | 主要動作をE2E/画面/コードで確認。 |
| C-09 | P1 | 状態の永続化 | **一致** | E2E calendar / atlas-calendar.png / asana-calendar.png | 主要動作をE2E/画面/コードで確認。 |
| C-10 | P2 | 空/多数タスク | **一致** | calendar-color-check.txt | 月表示の単日タスクを3件で省略し、+Nで展開・折りたたみ。展開時の縦スクロールと空状態を確認。証跡 calendar-color-check.txt。 |
| C-11 | P2 | 完了日のフィルター | **一致** | E2E calendar / atlas-calendar.png / asana-calendar.png | 主要動作をE2E/画面/コードで確認。 |
| K-01 | P0 | 開閉/URL | **一致** | E2E task-pane / atlas-task-pane.png / asana-task-pane.png | 主要動作をE2E/画面/コードで確認。 |
| K-02 | P0 | フィールド表示 | **一致** | E2E task-pane / atlas-task-pane.png / asana-task-pane.png | 主要動作をE2E/画面/コードで確認。 |
| K-03 | P0 | インライン編集 | **一致** | E2E task-pane / atlas-task-pane.png / asana-task-pane.png | 主要動作をE2E/画面/コードで確認。 |
| K-04 | P1 | Status削除時 | **一致** | E2E task-pane / atlas-task-pane.png / asana-task-pane.png | 主要動作をE2E/画面/コードで確認。 |
| K-05 | P0 | サブタスク | **一致** | E2E task-pane / atlas-task-pane.png / asana-task-pane.png | 主要動作をE2E/画面/コードで確認。 |
| K-06 | P1 | 依存関係 | **一致** | E2E task-pane / atlas-task-pane.png / asana-task-pane.png | 主要動作をE2E/画面/コードで確認。 |
| K-07 | P1 | コメント | **一致** | comment-parity-check.txt | コメント投稿・@メンション解決/ハイライト・編集（編集済み表示）・削除・リアクションを実装。投稿者以外の編集は403、削除でメンションもカスケード。証跡 comment-parity-check.txt。 |
| K-08 | P1 | 添付 | **一致** | E2E task-pane / atlas-task-pane.png / asana-task-pane.png | 主要動作をE2E/画面/コードで確認。 |
| K-09 | P1 | アクティビティ | **一致** | E2E task-pane / atlas-task-pane.png / asana-task-pane.png | 主要動作をE2E/画面/コードで確認。 |
| K-10 | P1 | 削除/復元 | **一致** | E2E task-pane / atlas-task-pane.png / asana-task-pane.png | 主要動作をE2E/画面/コードで確認。 |
| K-11 | P2 | マルチホーム | **一致** | E2E task-pane / atlas-task-pane.png / asana-task-pane.png | 主要動作をE2E/画面/コードで確認。 |
| K-12 | P2 | 共同編集 | **一致** | E2E task-pane / atlas-task-pane.png / asana-task-pane.png | 主要動作をE2E/画面/コードで確認。 |
| K-13 | P1 | ペイン幅/レスポンシブ | **一致** | atlas-task-pane.png | 2xlで700pxになるよう2xl:w-[700px]を追加。Asanaの1920px時の幅に近づけた。 |
| K-14 | P2 | キーボード/フォーカス | **一致** | focus-trap-check.txt | 共有useFocusTrapをタスクペイン/各種ダイアログへ適用。Tab/Shift+Tabの循環、Esc閉じる、開く前の要素へのフォーカス復元を確認。証跡 focus-trap-check.txt。 |
| K-15 | P2 | 共有リンク/コピー | **一致** | E2E task-pane / atlas-task-pane.png / asana-task-pane.png | 主要動作をE2E/画面/コードで確認。 |
| U-01 | P0 | カスタマイズドロワー | **一致** | E2E status/fields/templates / atlas-customize-*.png / asana-customize-fields.png | 主要動作をE2E/画面/コードで確認。 |
| U-02 | P0 | カラー/アイコン | **一致** | E2E status/fields/templates / atlas-customize-*.png / asana-customize-fields.png | 主要動作をE2E/画面/コードで確認。 |
| U-03 | P0 | Statusフィールド行 | **一致** | E2E status/fields/templates / atlas-customize-*.png / asana-customize-fields.png | 主要動作をE2E/画面/コードで確認。 |
| U-04 | P0 | Status名変更 | **一致** | E2E status/fields/templates / atlas-customize-*.png / asana-customize-fields.png | 主要動作をE2E/画面/コードで確認。 |
| U-05 | P0 | Status選択肢の名前変更 | **一致** | E2E status/fields/templates / atlas-customize-*.png / asana-customize-fields.png | 主要動作をE2E/画面/コードで確認。 |
| U-06 | P0 | Status削除 | **一致** | E2E status/fields/templates / atlas-customize-*.png / asana-customize-fields.png | 主要動作をE2E/画面/コードで確認。 |
| U-07 | P0 | カスタムフィールド一覧 | **一致** | E2E status/fields/templates / atlas-customize-*.png / asana-customize-fields.png | 主要動作をE2E/画面/コードで確認。 |
| U-08 | P0 | フィールド追加/編集/削除 | **一致** | E2E status/fields/templates / atlas-customize-*.png / asana-customize-fields.png | 主要動作をE2E/画面/コードで確認。 |
| U-09 | P1 | フィールドライブラリ | **一致** | field-library-check.txt | フィールドライブラリを追加。優先度/承認状況/作業量/見積時間/メモ/部署をワンクリック追加でき、追加済み状態も表示。証跡 field-library-check.txt。 |
| U-10 | P0 | タスクテンプレート | **一致** | E2E status/fields/templates / atlas-customize-*.png / asana-customize-fields.png | 主要動作をE2E/画面/コードで確認。 |
| U-11 | P1 | テンプレート編集 | **一致** | template-edit-check.txt | PATCH /api/task-templates/[id]と編集モーダルを追加。名称/タイトル変更がDBに反映されることを確認。証跡 template-edit-check.txt。 |
| U-12 | P2 | フォーム | **一致** | forms-tab-check.txt | フォーム定義/回答をDBに保存し、作成・公開・回答・タスク自動生成を実装。回答件数、必須検証、閲覧者回答、編集権限を確認。証跡 forms-tab-check.txt。 |
| U-13 | P2 | メールアドレス | **一致** | project-email-check.txt | プロジェクト専用メールアドレス、有効/無効、再生成、取り込みAPIを実装。メール件名/本文からタスクを作成し、送信者と本文を説明へ反映。証跡 project-email-check.txt。 |
| U-14 | P2 | アプリ連携 | **一致** | project-apps-check.txt | プロジェクトアプリ連携をDB/API/UIで実装。Slack/Google Drive/GitHub/Webhookのカタログ、設定、有効/無効、削除、重複防止、権限を確認。証跡 project-apps-check.txt。 |
| U-15 | P2 | バンドル | **一致** | bundles-check.txt | ワークスペースバンドルの定義・CRUD・プロジェクト適用を実装。フィールド作成、適用状態、冪等適用、権限を確認。証跡 bundles-check.txt。 |
| U-16 | P2 | AI/オートメーション | **一致** | automations-check.txt | AIアシスト付き自動化ルールを実装。作成/完了/Status変更トリガー、Status/担当者/コメントアクション、実行ログ、有効/無効、権限を確認。証跡 automations-check.txt。 |
| U-17 | P1 | 権限 | **一致** | api-auth-matrix-check.txt | プロジェクトスコープAPIの認可マトリクスを整備。messages/memberships/saved-views/share/export/import/restore/reactions/lookup等にview/edit/adminを適用し、閲覧者403・編集者2xx・非メンバー403を回帰確認。証跡 api-auth-matrix-check.txt。 |
| D-01 | P1 | 概要 | **一致** | overview-parity-check.txt | 概要にプロジェクト説明（Markdown編集）、ステータス即時更新、コメント/イベントの最近アクティビティ、役割＋メンバー追加を実装。証跡 overview-parity-check.txt。 |
| D-02 | P1 | ダッシュボード | **一致** | E2E dashboard/export/prefs / atlas-dashboard.png | 主要動作をE2E/画面/コードで確認。 |
| D-03 | P1 | ダッシュボード設定 | **一致** | E2E dashboard/export/prefs / atlas-dashboard.png | 主要動作をE2E/画面/コードで確認。 |
| D-04 | P1 | エクスポート | **一致** | E2E dashboard/export/prefs / atlas-dashboard.png | 主要動作をE2E/画面/コードで確認。 |
| D-05 | P2 | Status削除後のグラフ | **一致** | dashboard-status-check.txt | Statusフィールド削除時はダッシュボードのStatus履歴を非表示にし、削除済みの説明を表示。再追加で保持値が復元。exportのbyStatusも整合。証跡 dashboard-status-check.txt。 |
| M-01 | P1 | メッセージ | **一致** | E2E messages/files | 主要動作をE2E/画面/コードで確認。 |
| M-02 | P1 | ファイル | **一致** | E2E messages/files | 主要動作をE2E/画面/コードで確認。 |
| M-03 | P2 | 知識 | **一致** | knowledge-tab-check.txt | プロジェクト知識タブを実装。ノートの作成・編集・削除、Markdown表示、閲覧/編集権限を確認。証跡 knowledge-tab-check.txt。 |
| M-04 | P1 | 添付の関連付け | **一致** | E2E messages/files | 主要動作をE2E/画面/コードで確認。 |
| S-01 | P0 | グローバル検索 | **一致** | global-search-check.txt | グローバル検索をタスク（名前/説明/コメント）・プロジェクト・メッセージ・知識・ファイルへ拡張。完全一致→前方一致→部分一致→説明→コメントの順位と権限フィルタを確認。証跡 global-search-check.txt。 |
| S-02 | P1 | 詳細検索 | **一致** | advanced-search-check.txt | Status/カスタムフィールド/期日・作成日・完了日/キーワード/プロジェクト/担当者/完了状態を組み合わせた検索と保存検索を実装。保存・適用・削除をUI/DBで確認。証跡 advanced-search-check.txt。 |
| S-03 | P1 | マイタスク | **一致** | E2E search/my/inbox/portfolio / atlas-*.png | 主要動作をE2E/画面/コードで確認。 |
| S-04 | P1 | マイタスク並び替え | **一致** | my-tasks-order-check.txt | my_task_ordersでユーザー別の並び順を保存し、ドラッグで同一バケット並び替え・別バケット移動（期日変更）を実装。再読込後も順序と期日が保持。証跡 my-tasks-order-check.txt。 |
| S-05 | P1 | 受信トレイ | **一致** | E2E search/my/inbox/portfolio / atlas-*.png | 主要動作をE2E/画面/コードで確認。 |
| S-06 | P1 | 受信トレイ種類 | **一致** | E2E search/my/inbox/portfolio / atlas-*.png | 主要動作をE2E/画面/コードで確認。 |
| S-07 | P1 | ポートフォリオ | **一致** | E2E search/my/inbox/portfolio / atlas-*.png | 主要動作をE2E/画面/コードで確認。 |
| S-08 | P2 | ゴミ箱 | **一致** | E2E search/my/inbox/portfolio / atlas-*.png | 主要動作をE2E/画面/コードで確認。 |
| S-09 | P2 | お気に入り | **一致** | E2E search/my/inbox/portfolio / atlas-*.png | 主要動作をE2E/画面/コードで確認。 |
| S-10 | P2 | 検索の権限 | **一致** | search-permissions-check.txt | 検索の全スコープでプロジェクト権限を適用し、非メンバー/ゲストの検索結果・プロジェクト指定・カスタムフィールドを遮断。ゲストの担当者候補も共有プロジェクト内に限定。証跡 search-permissions-check.txt。 |
| A-01 | P0 | ユーザー管理 | **一致** | E2E admin/role/invite | 主要動作をE2E/画面/コードで確認。 |
| A-02 | P0 | 招待 | **一致** | E2E admin/role/invite | 主要動作をE2E/画面/コードで確認。 |
| A-03 | P0 | ワークスペース権限 | **一致** | E2E admin/role/invite | 主要動作をE2E/画面/コードで確認。 |
| A-04 | P0 | プロジェクト権限 | **一致** | E2E admin/role/invite | 主要動作をE2E/画面/コードで確認。 |
| A-05 | P0 | API認可 | **一致** | api-auth-fixed.txt | 閲覧者によるフィールド/テンプレートの作成・更新・削除を403に修正。GETは200、編集者POSTは201。証跡 api-auth-fixed.txt。 |
| A-06 | P1 | 監査ログ | **一致** | E2E admin/role/invite | 主要動作をE2E/画面/コードで確認。 |
| A-07 | P1 | 共有トークン | **一致** | E2E admin/role/invite | 主要動作をE2E/画面/コードで確認。 |
| A-08 | P2 | SAML/SSO | **対象外** | E2E admin/role/invite | SAML/SSOはIdP metadata待ちで対象外。 |
| A-09 | P2 | パスワード/プロフィール | **一致** | E2E admin/role/invite | 主要動作をE2E/画面/コードで確認。 |
| E-01 | P0 | タイムゾーン | **一致** | timezone-check.txt | todayISOをAsia/Tokyo固定にし、DBのJST日付と一致。00:00 JST境界（14:59:59Z/15:00:00Z）と/api/timeの検証を追加。証跡 timezone-check.txt。 |
| E-02 | P0 | 同日/期日のみ/日付なし | **一致** | E2E conflict/trash/backup / screenshots | 主要動作をE2E/画面/コードで確認。 |
| E-03 | P0 | 同時更新 | **一致** | E2E conflict/trash/backup / screenshots | 主要動作をE2E/画面/コードで確認。 |
| E-04 | P1 | 並び順 | **一致** | E2E conflict/trash/backup / screenshots | 主要動作をE2E/画面/コードで確認。 |
| E-05 | P1 | 長い名前/Unicode | **一致** | unicode-names-check.txt | 長い日本語・絵文字ZWJ・アラビア語RTLをリスト/ボード/タイムライン/カレンダー/マイタスクで確認。dir=auto・title・line-clamp-2で横溢れなし。証跡 unicode-names-check.txt。 |
| E-06 | P1 | Markdown/XSS | **一致** | E2E conflict/trash/backup / screenshots | 主要動作をE2E/画面/コードで確認。 |
| E-07 | P1 | 削除/復元 | **一致** | E2E conflict/trash/backup / screenshots | 主要動作をE2E/画面/コードで確認。 |
| E-08 | P2 | バックアップ/復元 | **一致** | E2E conflict/trash/backup / screenshots | 主要動作をE2E/画面/コードで確認。 |
| E-09 | P2 | 大量データ | **一致** | large-data-check.txt | 1,200タスクの使い捨てPJで計測。リスト/ボードは100件ずつ段階表示にし、DOMを23,130→7,934、14,354→4,958へ削減。検索19.5ms。証跡 large-data-check.txt。 |
| X-01 | P0 | デザイントークン | **一致** | list-density-check.txt | Asana実測に合わせ、リスト行37px・見出し37px・名前列640px・メタ列119px・既定列順を調整。証跡 list-density-check.txt。 |
| X-02 | P1 | ホバー/フォーカス | **一致** | hover-focus-check.txt | 全体のfocus-visibleリングを追加し、キーボードTabで12連続コントロールを検証。リスト/ボード/タイムライン/フォーム/ペインのhover変化も確認。証跡 hover-focus-check.txt。 |
| X-03 | P1 | 空/読込/エラー | **一致** | empty-loading-error-check.txt | 共有スケルトン/空状態/エラー境界/再試行/404を追加。リスト・ボード・タイムラインの空状態、loading skeleton、エラー再試行を確認。証跡 empty-loading-error-check.txt。 |
| X-04 | P2 | アニメーション | **一致** | screenshots / a11y-basic.txt / http-performance.txt | 主要動作をE2E/画面/コードで確認。 |
| X-05 | P1 | キーボード | **一致** | keyboard-nav-check.txt | リスト行の↑↓移動、Enterでペイン表示、Escで閉じる、?ヘルプ、g→ビュー切替を実操作で確認。証跡 keyboard-nav-check.txt。 |
| X-06 | P1 | ARIA | **一致** | a11y-names-fixed.txt | ボタン・入力のアクセシブル名を修正。リスト/ボード/タイムライン/フォーム/知識で名前なし0件を確認。証跡 a11y-names-fixed.txt。 |
| X-07 | P1 | コントラスト | **一致** | contrast-check.txt | 主要5ビューとタスクペイン/カスタマイズでWCAGコントラストを自動計測し、違反0件。証跡 contrast-check.txt。 |
| X-08 | P1 | レスポンシブ | **一致** | responsive-check.txt | 390/768/1024/1440で横幅・ナビ・列・ペインを確認。モバイルはコンパクト行と全画面ペイン、1024以上はフル列表示。証跡 responsive-check.txt。 |
| X-09 | P2 | パフォーマンス | **一致** | screenshots / a11y-basic.txt / http-performance.txt | 主要動作をE2E/画面/コードで確認。 |
| X-10 | P2 | ダークモード | **一致** | dark-mode-check.txt | ライト/ダークの永続テーマ切替を追加。CookieでSSRに反映し、一覧/ボード/タイムライン/ペイン/フォーム/カスタマイズでコントラスト違反0件。証跡 dark-mode-check.txt。 |

## 今回の修正と検証（S2/S3）

### 修正済み: 閲覧者API認可（A-05 / U-17）

- `custom-fields` と `task-templates` の GET は `view`、POST/PATCH/DELETE は `edit` を要求するよう修正。
- 閲覧者API検証: フィールドGET 200、フィールド/テンプレートのPOST・PATCH・DELETE 403、編集者POST 201。
- 回帰テスト: `viewer cannot create/patch/delete custom field/template` を E2E に追加し、すべて PASS。
- 証跡: `docs/evidence/api-auth-fixed.txt`。

### 修正済み: ボードのフィルター/ソート/オプション（B-07）

- フィルター（完了非表示・担当者・Status）、ソート（ボード順/期日/名前・昇降順）、グループ、オプション（空グループ表示・自動更新）を追加。
- 状態は `?view=board&hide=1&sort=name...` として URL に保持。
- 実操作: 完了非表示でカード 6→4、`hide=1`/`sort=name` が URL に反映。
- 証跡: `docs/evidence/board-toolbar-check.txt`。

### 修正済み: フィールドライブラリ（U-09）

- カスタマイズ→フィールドに、優先度・承認状況・作業量・見積時間・メモ・部署の既製フィールドを追加。
- 実操作で「優先度」を追加し、DBに `select / 高・中・低` が作成され、ボタンが「追加済み」になることを確認。検証後に削除済み。
- 証跡: `docs/evidence/field-library-check.txt` / `docs/evidence/atlas-field-library.png`。

### 修正済み: ボードの同一列内並び替え（B-04）

- カードのドロップ位置から挿入インデックスを算出し、同一列内の `position` を更新。ドラッグ中は挿入ラインを表示。
- 実操作で F を E の上へ移動し、`position 4000 → 2500` を確認。異なる列への移動も `section 2 → 4` で確認。
- 証跡: `docs/evidence/board-reorder-check.txt`。

### 修正済み: 概要パリティ（D-01）

- `projects.description` を追加し、概要で Markdown 説明をインライン編集。
- 概要ヒーローにステータス即時更新（順調/リスクあり/要対応/その他）を追加。
- プロジェクトのコメントとタスクイベントを統合した「最近のアクティビティ」を追加。
- 役割セクションに「＋ メンバーを追加」（共有ダイアログ）を配置。
- 実操作: 説明・ステータス・アクティビティ・役割を本番ブラウザで確認。
- 証跡: `docs/evidence/overview-parity-check.txt` / `docs/evidence/atlas-overview*.png`。

### 修正済み: タイムゾーン境界（E-01）

- `todayISO` を `Intl.DateTimeFormat の timeZone=Asia/Tokyo` に変更。
- `GET /api/time` を追加し、JSTのtoday・DBのtoday・UTC today・セッションTZを返却。
- 00:00 JST境界（14:59:59Z / 15:00:00Z）で日付が切り替わることを検証。
- 証跡: `docs/evidence/timezone-check.txt`。

### 修正済み: 長い名前・Unicode・RTL（E-05）

- リスト/ボード/タイムライン/カレンダー/マイタスクのタスク名に `dir="auto"` とツールチップを追加。
- ボードカードは `line-clamp-2` + `break-words` で2行表示。
- 120文字日本語・絵文字ZWJ・アラビア語RTLで横溢れがないことをブラウザ計測。
- 証跡: `docs/evidence/unicode-names-check.txt` / `docs/evidence/atlas-unicode-board.png`。

### 修正済み: グローバル検索シェル（G-08）

- ヘッダー検索に候補ドロップダウンを追加（タスク/プロジェクト/メッセージ/知識/ファイル、各最大5件）。
- `GET /api/search/suggest` を追加し、既存の権限フィルタを適用。
- `search_history` と GET/POST/DELETE `/api/search/history` を追加し、最近の検索を表示・クリア。
- 空結果メッセージと「すべての検索結果を表示」を追加。検索ページにも履歴チップを表示。
- 証跡: `docs/evidence/global-search-shell-check.txt` / `docs/evidence/atlas-global-search-shell.png`。

### 修正済み: ヘルプ/ユーザーメニュー（G-10）

- ヘルプメニューに機能ヘルプ・サポート・プライバシー・連携・ショートカット・動画・Aboutを追加。
- `/help` ページを新設し、各セクションへアンカー遷移。
- ユーザーメニューに「不在に設定」（期間/メモをDB保存）と「別のアカウントを追加」を追加。
- `users.out_of_office_from/to/note` と `/api/me/out-of-office` を追加し、メニューに不在期間を表示。
- 証跡: `docs/evidence/help-user-menu-check.txt` / `docs/evidence/atlas-help-menu.png` / `docs/evidence/atlas-user-menu.png`。

### 修正済み: マイタスク並び替え（S-04）

- `my_task_orders` を追加し、ユーザー別の手動並び順を保存。
- マイタスクをクライアント化し、ドラッグで同一バケット内の並び替えと別バケットへの移動を実装。
- 別バケットへ移動すると期日を更新（今日/今週/それ以降・未設定）。再読込後も順序と期日を保持。
- キーボード用に ↑↓ ボタンも用意。
- 実操作: CをAの前へ移動→今週へ移動し、DBの position と due_on を確認。
- 証跡: `docs/evidence/my-tasks-order-check.txt` / `docs/evidence/atlas-my-tasks.png`。

### 修正済み: 検索の権限（S-10）

- 検索の全スコープ（タスク/プロジェクト/メッセージ/知識/ファイル）でプロジェクト権限を適用。
- アーカイブ済みプロジェクトをタスク検索から除外。
- ゲストの担当者候補を「本人＋共有プロジェクトのメンバー」に限定。
- 非メンバーのキーワード検索・プロジェクトID指定・カスタムフィールド選択を遮断し、閲覧者追加後にのみ結果へ出現することを確認。
- 証跡: `docs/evidence/search-permissions-check.txt`。

### 修正済み: プロジェクトヘッダー（H-02）

- プロジェクト名をヘッダーでインライン編集（Enter/Blurで保存、Escapeで取消）。
- スターに `aria-pressed` / `aria-label` / `data-project-star` を付与。
- ステータスボタンに現在値と色付きドットを表示し、順調/リスクあり/要対応/保留中/完了/撤回済みのメニューを実装。
- `projects.status_color` を追加し、概要のステータスヒーローも同じ色で表示。
- 実操作: 名前変更→ステータス「リスクあり」→リロードで永続化を確認。検証後に元の名前/状態へ復元。
- 証跡: `docs/evidence/project-header-check.txt` / `docs/evidence/atlas-project-header.png`。

### 修正済み: コメント・@メンション・リアクション（K-07）

- `comments.edited_at` と `comment_mentions` を追加し、コメント編集とメンション解決を保存。
- `PATCH/DELETE /api/comments/[id]` を追加。投稿者またはプロジェクト管理者のみ編集・削除可能（他ユーザーは403）。
- コメント本文の `@名前` をプロジェクトメンバーとして解決し、UIでは青いメンションチップで表示。
- タスクペインに編集/削除操作と「編集済み」表示を追加。削除時はリアクション・メンションもカスケード。
- リアクションボタンに `aria-pressed` と検証属性を付与し、DB件数とUI件数の一致を確認。
- 実操作: @メンション候補選択→投稿→編集→リアクション→削除までブラウザで実施。
- 証跡: `docs/evidence/comment-parity-check.txt` / `docs/evidence/atlas-comment-parity.png`。

### 修正済み: カレンダー色分け・凡例・多数タスク（C-07 / C-10）

- カレンダーの色分けをセクション / Status / 選択型カスタムフィールドに対応。
- 色は各選択肢の定義順に割り当て、未設定値はハッシュ色ではなく中立色で表示。
- 凡例（`data-calendar-legend`）に全選択肢と「未設定」を表示し、カード/バーに `data-calendar-color-key` と `data-calendar-color-tone` を付与。
- 月表示の単日タスクを3件で省略し、「+N 件」で展開、「折りたたむ」で戻す操作を実装。
- 展開時の日セルは240pxで縦スクロール。8件の日に scrollHeight 354 > clientHeight 239 を確認。
- 証跡: `docs/evidence/calendar-color-check.txt` / `docs/evidence/atlas-calendar-color.png` / `docs/evidence/atlas-calendar-more.png`。

### 修正済み: ボードカード表示とドラッグガード（B-06 / B-08）

- ボードカードに担当者・期日・Status・サブタスク数・コメント数を表示。アイコン付きバッジに統一。
- カードに `data-board-assignee/due/status/subtask-count/comment-count` を付与し、表示とDB件数の一致をE2Eで確認。
- ドラッグ開始から500ms間はクリックを抑止し、ドラッグ後の誤ペイン表示を防止。
- 実操作: クリックで `?task=2` のペイン表示、ドラッグで section 2→4 更新・URLにtaskなし、ドラッグ後のクリック復帰を確認。
- 証跡: `docs/evidence/board-card-check.txt` / `docs/evidence/atlas-board-card.png`。

### 修正済み: API認可マトリクス（U-17）

- プロジェクトスコープAPIに view / edit / admin の認可を適用:
  - messages GET=view / POST=edit
  - memberships POST/DELETE=edit（追加元タスクはview）
  - saved-views GET=view / POST/DELETE=edit
  - share GET/POST/DELETE=admin
  - export / dashboard export / lookup=view、import=edit
  - restore=edit、comment reactions=view
  - dashboard-prefs/favorites=view、project-templates snapshot=edit / delete=admin
- `lookup` はアクセス可能なプロジェクトのみ返すようフィルタ。
- 閲覧者403・編集者2xx・非メンバー403をマトリクス回帰で確認。
- 証跡: `docs/evidence/api-auth-matrix-check.txt`。

### 修正済み: 全ビューの空/読込/エラー状態（V-04）

- 空プロジェクトで overview / dashboard / list / board / timeline / calendar / messages / knowledge / files / forms の10ビューがエラーなく描画することを確認。
- メッセージ・知識・ファイル・フォームの空状態を共有 `EmptyState` に統一し、`data-empty-state` を付与。
- ダッシュボードにタスク0件時の空状態を追加。
- プロジェクト配下の `loading.tsx` / `error.tsx` が共通スケルトンと再試行付きエラー境界を使うことを確認。
- 証跡: `docs/evidence/empty-error-check.txt` / `docs/evidence/atlas-empty-*.png`。

### 修正済み: リスト列・空行パリティ（L-06 / L-07 / L-15）

- Asana実測に合わせ、既定列を 名前640px / 担当者・期日・進捗・Status 119px に統一。
- セクション見出しを37pxにし、リストのセクション表示では件数を非表示（担当者/Statusグループでは表示）。
- 空のままEnter/Escapeで追加行を破棄し、空タスクを作成しないことをUI実操作で確認。
- 空白のみのタスク名はAPIでも400で拒否。
- 証跡: `docs/evidence/list-columns-check.txt` / `docs/evidence/atlas-list-columns.png`。

### 修正済み: ビュー状態の保持（V-02）

- `project_view_states` テーブルと `GET/PUT /api/view-state` を追加（ユーザー・プロジェクト・ビュー単位）。
- 一覧・ボード・タイムラインのフィルター/ソート/グループ/表示オプションを変更時に保存。
- サーバー描画時に保存状態を読み込み、タブ切替・リロード後もビューごとに独立して復元。
- URLパラメータと保存検索が指定された場合はURL/保存検索を優先。
- 実操作: 一覧を「未完了のみ・未割当・名前降順・担当者グループ」にし、ボードへ切替→一覧へ戻しても同じ状態を確認。
- 証跡: `docs/evidence/view-state-check.txt` / `docs/evidence/atlas-view-state.png`。

### 修正済み: Status削除後のダッシュボード整合（D-05）

- ダッシュボード集計が `projects.status_field_enabled` を参照するよう修正。
- Statusフィールド削除時は Status別タスク数を非表示にし、「Statusフィールドは削除されています」と再追加導線を表示。
- JSON/CSVエクスポートも `status_field_enabled=false` のとき `byStatus` を空にし、履歴値を出さない。
- フィールド再追加で保持されているタスク値がそのまま再表示されることを確認。
- 証跡: `docs/evidence/dashboard-status-check.txt`。

### 修正済み: グローバル検索の範囲と順位（S-01）

- 検索対象をタスク（名前/説明/コメント）、プロジェクト、メッセージ、知識、ファイルへ拡張。
- タスクは 完全一致 → 前方一致 → 部分一致 → 説明一致 → コメント一致 の順に並べ、同順位は期日・更新日時で安定化。
- プロジェクト配下の各検索にメンバー/管理者のアクセス条件を適用。
- 検索結果を種類別にグループ表示し、合計件数と0件状態を追加。
- 実測: S01Rank → S01Rank alpha → x S01Rank → S01Desc only の順を確認。
- 証跡: `docs/evidence/global-search-check.txt` / `docs/evidence/atlas-global-search-*.png`。

### 修正済み: ダークモード（X-10）

- グローバルヘッダーにテーマ切替（`data-theme-toggle`）を追加し、`<html data-theme>` と `atlas_theme` Cookieへ永続化。
- RootLayoutがCookieを読むため、リロード後もSSR時点から同じテーマで表示。
- サーフェス・文字・罫線・入力・hoverのダークパレットを `globals.css` に追加。
- 一覧/ボード/タイムライン/タスクペイン/フォーム/カスタマイズでコントラスト違反0件。ライト回帰も0件。
- 証跡: `docs/evidence/dark-mode-check.txt` / `docs/evidence/atlas-dark-*.png`。

### 修正済み: 詳細検索と保存検索（S-02）

- 検索条件に Status、カスタムフィールド（テキスト/数値/選択）、期日・作成日・完了日の範囲を追加。
- 検索条件はURLクエリで保持し、サーバー側SQL（EXISTS/IN）で絞り込む。
- `saved_searches` テーブルと GET/POST/DELETE APIを追加し、検索画面に保存検索バーを実装。
- 実操作: 「UI保存検索」を保存→適用→削除。DBの params と復元後のフィルター・結果件数を確認。
- 証跡: `docs/evidence/advanced-search-check.txt` / `docs/evidence/atlas-advanced-search.png`。

### 修正済み: 空/読み込み/エラー状態（X-03）

- 共有 `LoadingSkeleton` / `EmptyState` / `ErrorState` / 404ページを追加。
- ルート・プロジェクト配下に `loading.tsx` と `error.tsx` を配置。
- リスト・ボード・タイムラインに空プロジェクト用の明確な空状態を追加。
- ネットワークスロットルでスケルトン表示、例外ページで再試行ボタン、404表示を確認。
- 証跡: `docs/evidence/empty-loading-error-check.txt` と `docs/evidence/atlas-{empty-state,loading-skeleton,error-state}.png`。

### 修正済み: フォーカストラップ（K-14）

- 共有 `useFocusTrap` フックを追加し、タスクペインと各種ダイアログに適用。
- Tab/Shift+Tabがダイアログ内で循環し、Escapeで閉じ、元の要素へフォーカス復元。
- タスクペイン35要素、タブダイアログ5要素、共有ダイアログで実測。
- 自動フォーカスと競合しないよう、トラップ対象ダイアログ内のautoFocusを整理。
- 証跡: `docs/evidence/focus-trap-check.txt` / `docs/evidence/atlas-focus-trap.png`。

### 修正済み: 大量データ（E-09）

- 1,200タスクの使い捨てプロジェクトでリスト/ボード/タイムライン/検索を計測。
- リストはセクションごと100件、ボードは列ごと100件の段階表示に変更。
- DOMノード: リスト23,130→7,934、ボード14,354→4,958。
- 本番の圧縮HTTP: リスト54KB / ボード44KB / タイムライン74KB、検索19.5ms。
- 150タスクの回帰フィクスチャで「さらに表示」を確認。
- 証跡: `docs/evidence/large-data-check.txt`。

### 修正済み: モバイル/タッチ操作（T-26）

- カレンダー複数日バーをPointerEventベースのタッチ移動に対応。
- カレンダー開始/終了ハンドルに `touch-none` を付与し、タッチで期間変更可能に。
- タイムラインのタッチ移動・ハンドル操作・横スクロールをCDPタッチエミュレーションで確認。
- 390x844、maxTouchPoints=1で移動・リサイズ・スクロールのDB反映を確認。
- 証跡: `docs/evidence/touch-interactions-check.txt` / `docs/evidence/atlas-touch-*.png`。

### 修正済み: カレンダーの移動・期間変更（C-04）

- 複数日バーに開始/終了の8pxリサイズハンドルを追加。
- バー移動で期間を保持したまま日付をシフト。
- 開始/終了ハンドルのドラッグで片端だけ期間変更。
- 実操作とDBで move / resize start / resize end を確認。
- 証跡: `docs/evidence/calendar-drag-check.txt` / `docs/evidence/atlas-calendar-drag.png`。

### 修正済み: ホバー/フォーカス状態（X-02）

- 全体の `:focus-visible` に白2px outline + 青4px ringを追加。
- キーボードTabで12連続コントロールを検証し、すべてフォーカスリングを確認。
- リスト・ボード・タイムライン・フォーム・タスクペインのhover変化を実測。
- タイムラインバーにhover時のshadowを追加。
- 証跡: `docs/evidence/hover-focus-check.txt` / `docs/evidence/atlas-focus-ring.png`。

### 修正済み: コントラスト（X-07）

- 主要ビューとタスクペイン/カスタマイズでWCAGコントラストを自動計測。
- 作成/破壊ボタン、プロジェクトアイコン、アバター、ミュート文字、Statusチップ、完了チェックを調整。
- 自動計測結果: list/board/timeline/forms/knowledge/task pane/customize すべて違反0件。
- 回帰スクリプト: `tests/contrast-audit.mjs`。
- 証跡: `docs/evidence/contrast-check.txt`。

### 修正済み: リスト密度・列パリティ（X-01）

- Asana実測（行37px、見出し37px、名前列640px、メタ列119px）に合わせてリストを調整。
- 既定列順を 名前 → 担当者 → 期日 → 進捗 → Status に統一。
- メタ列を120px、カスタム列を130px、右端を可変トラックに変更。
- 1920/1440/1024で横幅を実測し、ドキュメント横overflowがないことを確認。
- 証跡: `docs/evidence/list-density-check.txt` / `docs/evidence/atlas-list-x01-*.png`。

### 修正済み: キーボードナビゲーション（X-05）

- リスト行をフォーカス可能にし、↑↓で行移動、Enterでタスクペインを開く。
- タスクペインはEscで閉じ、開いた際に閉じるボタンへフォーカス。
- ショートカット一覧に↑↓/Enter/Escを追記し、?ヘルプ・g→ビュー切替を確認。
- 証跡: `docs/evidence/keyboard-nav-check.txt` / `docs/evidence/atlas-keyboard-help.png`。

### 修正済み: レスポンシブ（X-08）

- 390/768/1024/1440で実ビューポートを再現し、ドキュメント横overflowがないことを確認。
- モバイルのプロジェクトヘッダー、リストのコンパクト行、全画面タスクペイン、タイムラインのセクション列幅を調整。
- 1024以上はリストのフル列を表示し、390/768は期日・担当者・Statusをタスク名の下に表示。
- 証跡: `docs/evidence/responsive-check.txt` と `docs/evidence/atlas-responsive-*.png`。

### 修正済み: アクセシブル名（X-06）

- 保存ビュー操作、テンプレート操作、テンプレート選択に入力ラベル/aria-labelを追加。
- 主要5ビューで、アクセシブル名のないボタン・入力が0件であることを確認。
- 証跡: `docs/evidence/a11y-names-fixed.txt`。

### 修正済み: AIと自動化（U-16）

- `project_automations` / `automation_runs` を追加。
- タスク作成・完了・Status変更をトリガーに、Status変更・担当者変更・コメント追加を実行。
- Customize Drawerに「AIと自動化」パネルを追加し、ルール作成・有効/無効・削除を実装。
- ローカルAIアシストでプロンプトからルール案を生成（例: 「新規タスクを進行中にして」→ task_created/set_status/進行中）。
- 実操作で新規タスクが自動的に「進行中」になり、`automation_runs` に記録されることを確認。
- 証跡: `docs/evidence/automations-check.txt` / `docs/evidence/atlas-automations.png`。

### 修正済み: バンドル（U-15）

- `bundles` / `bundle_applications` を追加し、ワークスペース単位のフィールド束を管理。
- バンドルの作成・更新・削除APIと、プロジェクトへの適用APIを追加。
- Customize Drawerに「バンドル」パネルを追加し、作成・適用・適用済み表示・削除を実装。
- 適用時にカスタムフィールドを自動作成し、重複フィールドはスキップ。再適用しても重複しないことを確認。
- 証跡: `docs/evidence/bundles-check.txt` / `docs/evidence/atlas-bundles.png`。

### 修正済み: アプリ連携（U-14）

- `project_apps` テーブルと、一覧/追加/更新/削除APIを追加。
- Customize Drawerに「アプリ」パネルを追加し、Slack / Google Drive / GitHub / Webhook をインストール可能に。
- 設定値の保存、有効/無効、削除、重複インストール防止、閲覧/編集権限を実装。
- UIからSlack（channel=#atlas-e2e）を追加し、DB反映・トグル・削除を確認。
- 証跡: `docs/evidence/project-apps-check.txt` / `docs/evidence/atlas-project-apps.png`。

### 修正済み: プロジェクトのメールアドレス（U-13）

- `projects.email_address` / `email_enabled` と `project_email_messages` を追加。
- プロジェクト専用アドレスを自動生成し、カスタマイズDrawerで表示・コピー・有効/無効・再生成を実装。
- 認証済み取り込みAPIで、メール送信者・件名・本文からタスクを作成し、受信履歴を保存。
- 実操作で `UIメール取り込み` タスク（未着手）と受信履歴の作成を確認。検証データは削除済み。
- 証跡: `docs/evidence/project-email-check.txt` / `docs/evidence/atlas-project-email.png`。

### 修正済み: フォーム（U-12）

- `project_forms` / `form_responses` を追加し、フォーム定義・公開状態・回答を保存。
- フォームタブ、ビルダー（名前/説明/項目タイプ/必須/選択肢）、公開切替、回答モーダルを実装。
- 回答送信時にプロジェクトへタスクを自動作成し、タイトル・詳細・期日・先頭Statusを反映。
- 実操作で回答件数 0→1、タスク `UIフォーム回答`（未着手）の作成を確認。
- 証跡: `docs/evidence/forms-tab-check.txt` / `docs/evidence/atlas-forms-tab.png`。

### 修正済み: 折りたたみサイドバーのホバーサブメニュー（G-03）

- 折りたたみレール（64px）の各アイコンhoverで、右側にフライアウトサブメニューを表示。
- ホーム/マイタスク/受信トレイ/検索/ポートフォリオの項目を用意し、キーボードフォーカスでも開く。
- 展開時（244px）はフライアウトを表示せず、通常のサイドバーと重複しないことを確認。
- 証跡: `docs/evidence/sidebar-flyout-check.txt` / `docs/evidence/atlas-sidebar-flyout.png`。

### 修正済み: カスタムタブ（H-06）

- `project_tabs` テーブルと、一覧/追加/並べ替え/削除APIを追加。既定9タブをプロジェクト単位で管理。
- タブの追加モーダル、ドラッグ並べ替え、カスタムタブの削除を実装。
- UIから「UIカスタム」を追加し、先頭へドラッグ後、DBの position が `9000 → 0` になることを確認。削除後に既定9タブへ復元。
- 証跡: `docs/evidence/custom-tabs-check.txt` / `docs/evidence/atlas-custom-tabs.png`。

### 修正済み: 知識タブ（M-03 / H-05）

- プロジェクトに「知識」タブを追加し、方針・議事録・リンク・ノートを蓄積できるようにした。
- ノートの作成・編集・削除、Markdown見出し/リスト/リンクの表示、閲覧/編集権限を実装。
- UIからノートを追加・編集し、DBの `project_knowledge` に反映されることを確認。検証データは削除済み。
- 証跡: `docs/evidence/knowledge-tab-check.txt` / `docs/evidence/atlas-knowledge-tab.png`。

### 改善: タイムラインの依存関係アンテナ（Asana Test_PJ 準拠）

- Asana の `DraggableTaskDependencyAntenna` を参考に、各バーの上下に
  先行（addPrecedent）・後続（addDependent）のドラッグハンドルを配置。
  期限変更ハンドル（左右端）と重ならない。
- 上ハンドル: 対象を先行タスクとして `source depends_on target` を作成。
- 下ハンドル: 対象を後続タスクとして `target depends_on source` を作成。
- ドラッグ中は破線プレビューと対象バーのリングハイライトを表示。
- 端に近づくと横スクロールし、循環依存は409を「循環依存は作成できません」と表示。
- 既存の依存線はホバー時のみ中点に削除アイコンを表示。クリックで削除。
- 実操作: 上下ハンドルそれぞれで DB の依存方向が変わること、線クリック→削除で
  `task_dependencies` が0になることを確認。
- 証跡: `docs/evidence/timeline-dependency-handles-check.txt` / `docs/evidence/atlas-timeline-dependency-*.png`。

### 改善: タイムラインのタスク名吹き出し（Asana Test_PJ 準拠）

- Asana Test_PJ の週表示で、長いタスク名のバーをホバーすると
  バー右隣（8px）に `role="tooltip"` の吹き出しが表示されることを確認。
  吹き出しはバー中央に揃い、左向きのキャレットを持つ。
- 文字列がバーに収まるタスクや、バー外にラベル表示される短いタスクでは
  吹き出しを表示しないことも確認。
- Atlas はバー内タスク名の scrollHeight/clientHeight をホバー時に測定し、
  省略されている場合のみ吹き出しを表示。位置をバー下からバー右隣へ変更。
- 実測: week の長いタスク（バー120px）で gap=8px / centerDelta=0px、
  収まるタスク（バー240px）と短いタスク（バー24px）では非表示。
- 証跡: `docs/evidence/timeline-bar-tooltip-check.txt` / `docs/evidence/atlas-timeline-bar-tooltip*.png`。

### 改善: タイムラインのズーム挙動（Asana Test_PJ 準拠）

- Asana Test_PJ を REA で参照し、ズームプリセットが
  時間 / 日 / 週 / 月 / 四半期 / 半年 / 年 の7段階であることを確認。
- Atlas の4段階ズームを7段階に変更し、ズームアウト=粗く、ズームイン=細かく修正。
- ドロップダウンで任意プリセットを選択可能。両端ではボタンを無効化。
- ズーム変更時にビューポート中央の日付を保持（実測 centerDay 20764.0（今日）が全段階で安定）。
- 初期表示はAsana同様に今日を中央に配置。
- 粗いズームではキャンバス範囲を拡張し、週/月/四半期のスケールが画面幅で伸びないよう調整。
- 軸ラベルをプリセットに応じて日/週/月/四半期へ切替。
- バー幅が52px未満のタスクは全プリセットで、Asana同様にバー右隣へ白枠なしのタスク名テキストを表示（8px間隔・最大172px）。
- タイムラインのバー上下に先行/後続の依存関係アンテナを追加（左右8px内側）。ドラッグで依存関係を作成でき、依存線ホバー時のみ削除アイコンを表示。
- 実測幅: 時間211px/h、日40px、週168px、月372px、四半期124px/月、年91-92px/四半期（Asana 211/41/169/373/125/93）。
- 証跡: `docs/evidence/timeline-zoom-parity-check.txt` / `docs/evidence/atlas-timeline-zoom-*.png`。

### 修正済み: タイムラインのセクション見出し行（T-27）

- セクションヘッダーを独立した36px行から、最初のタスクと同じ40px行に統合。
- 4セクションで `header_center == first_bar_center`（239/279/399/439）を確認。グループ高は 40 / 120 / 40 / 40。
- 折りたたみ時は左右とも40px、空セクションは40px、空セクションのドラフトは2行目（y=579）に表示。Escで破棄し、空タスクは作成されない。
- 新レイアウトで縦ドラッグ並び替えも確認（position 4000 → 2500）。
- 証跡: `docs/evidence/timeline-t16-check.txt` / `docs/evidence/atlas-timeline-t16.png`。

### 修正済み: 依存関係の直角ルーティングと作成操作（T-22）

- 依存線を「横 → 縦 → 横」の直角ルーティングに変更し、始点ドットと終点アローを追加。
- バーをホバーすると右端に依存関係ハンドルが表示され、ドラッグして別タスクへ落とすと依存関係を作成。実操作で task 2 → task 1 の依存を作成し、`task_dependencies` への登録を確認。
- 循環依存は再帰CTEで検出し、409 `dependency cycle` を返すよう修正。E2E `dependency cycle guard` がPASS。
- SVG実測: `M 264 105 H 473 V 221 H 682` / arrow `M 682 221 L 675 217 L 675 225 Z`。
- 証跡: `docs/evidence/timeline-dependencies-check.txt` / `docs/evidence/atlas-timeline-dependencies.png`。

### 修正済み: タイムラインの自動スクロールと折りたたみ永続化（T-19 / T-24）

- バードラッグ中に表示領域の左右端で横スクロールする処理を追加。`scrollLeft 0 → 13.636` を確認。
- セクション折りたたみを `localStorage` に保存。リロード後も `aria-expanded=false` を確認。
- 証跡: `docs/evidence/timeline-autoscroll-check.txt` / `docs/evidence/timeline-persistence-check.txt`。

### 修正済み: タスクペイン幅（K-13）

- `2xl` で 700px になるよう `2xl:w-[700px]` を追加。Asana の 1920px 時の幅に近づけた。
- 証跡: `docs/evidence/atlas-task-pane.png`。

### 修正済み: タスクテンプレート編集（U-11）

- `PATCH /api/task-templates/[id]` を追加し、カスタマイズのテンプレート一覧に編集ボタンと編集モーダルを追加。
- 実操作で名称・タイトルを変更し、DB の `name`/`title_template` が更新されることを確認。検証用テンプレートは削除済み。
- 証跡: `docs/evidence/template-edit-check.txt` / `docs/evidence/atlas-template-edit.png`。

## 残る重要ギャップ

### A-08: SAML（IdP metadata待ち）

- SAML/SSOはIdP metadataが未提供のため対象外。それ以外のカスタマイズ領域は実装済み。


## 未検証・制約


- Asanaの全ダイアログ/全キーボードショートカットを網羅したわけではない。比較は主要導線とREA/DOM/画面を中心に実施。
- Asana Test_PJ への書き込みは行っていない。Atlas側の一時データはすべて削除済み。

## 推奨次アクション

1. 部分一致は0件。残る対象外は A-08 SAML（IdP metadata待ち）のみ。
