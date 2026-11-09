# Atlas ルール／オートメーション実装

Asanaのルール／オートメーションを参考に、Phase 0〜3の基盤と機能を実装した。

## アーキテクチャ

```text
Atlasドメイン
  └─ domain_events（イベント／アウトボックス）
        ├─ automation engine / worker
        │     └─ capabilities（共通コマンド）
        └─ 将来のAIアシスタント
              └─ 同じcapabilities／公開API
```

- ドメインはAutomationを直接呼ばない
- Automationはイベントを購読し、副作用は共通ケイパビリティ経由で実行
- UIはディスクリプタAPIでトリガー・条件・アクションを描画
- AIアシスタントは将来、同じイベント・ケイパビリティ・ルールAPIを利用可能

## Phase 0: 基盤

実装済み:
- `domain_events` アウトボックス
  - type/version/subject/data/causation/chain_depth/processing状態
- `project_rules` 汎用ルール定義
  - triggers[], conditions[], actions[], branches[]
  - owner_id / enabled / version
- `rule_runs` 実行履歴
  - status / actions_total / succeeded / failed / error / details
- `automation_fires` 日付トリガーの重複発火防止
- 共通ケイパビリティ `lib/capabilities`
- ワーカー `/api/automation/process`
  - `FOR UPDATE SKIP LOCKED` で複数ワーカー対応
  - instrumentationから2秒ごとに起動
- 所有者の権限で実行
- 既存の簡易 `project_automations` は互換用として残存

## Phase 1: プロジェクト内MVP

トリガー:
- タスク作成 / 完了 / 再開
- 担当者変更 / Status変更 / 期日変更 / セクション変更
- カスタムフィールド変更
- プロジェクト追加（マルチホーム）
- コメント追加
- フォーム送信
- プロジェクトステータス変更
- 期日接近 / 期限超過
- 手動実行

条件:
- タスク名 / Status / 担当者 / セクション / 完了状態 / 期日 / 開始日 / 進捗
- プロジェクト名 / プロジェクトステータス
- カスタムフィールド
- 演算子: eq / neq / contains / in / is_empty / gt / lt など

アクション:
- 担当者変更 / Status変更 / 期日変更 / セクション移動 / 完了
- コメント追加 / サブタスク作成 / カスタムフィールド設定
- プロジェクトステータス更新
- 別プロジェクトへ追加
- Webhook POST

UI:
- ルール一覧
- 複数トリガー
- AND条件
- 複数アクション
- 実行履歴
- 有効化 / 無効化 / 削除 / 編集
- 手動実行
- クイックテンプレート

## Phase 2: 拡張

- 条件分岐 / elseパス（エンジン＋UI）
- 日付トリガー（期日接近 / 期限超過）＋重複防止
- 変数展開 `{{task.name}}`, `{{task.due_on}}`, `{{project.name}}`
- クロスプロジェクトの追加アクション
- ルールギャラリー（クイックテンプレート）
- プロジェクトテンプレートにルールを同梱
- プロジェクト複製時にルールを複製
- 複数トリガー / 複数アクション / ルール上限

## Phase 3: 発展

- Webhookアクション
  - HMAC-SHA256署名 `x-atlas-signature`
  - タイムアウト10秒
- AIルールビルダー
  - `/api/projects/[id]/rules/ai-suggest`
  - ローカル自然言語ヒューリスティック
  - LLMへ差し替え可能なAPI境界
- 水平ワーカー対応
  - `SKIP LOCKED`
  - イベント処理の冪等チェック
  - 連鎖深度制限
- 実行履歴の保持
- 日次janitorでdomain_events / rule_runsを保持期間後に削除

## API

- `GET/POST /api/projects/[id]/rules`
- `PATCH/DELETE /api/projects/[id]/rules/[ruleId]`
- `GET /api/projects/[id]/rules/[ruleId]/runs`
- `POST /api/projects/[id]/rules/[ruleId]/run`
- `GET /api/projects/[id]/automation/descriptors`
- `POST /api/projects/[id]/rules/ai-suggest`
- `POST /api/automation/process`（内部ワーカー用トークン）

## 制限

- ルール上限: 50/プロジェクト
- トリガー: 20/ルール
- アクション: 20/ルール
- 条件: 30/パス
- 日付トリガーの対象: 150タスク/ルール
- 連鎖深度: 8

## 既知の未実装

- ポートフォリオルール
  - AtlasにはAsana相当のfirst-classポートフォリオモデルがまだない
- バンドルへのルール同梱
- 外部アプリからのWebhookトリガー（受信側）
- Slack / メール等の外部アクション
- 本物のLLMによるAIビルダー（現在はローカル提案）
- インポート処理からのイベント発火
- アクション失敗の自動再試行（実行履歴には失敗を記録）


---

## 追加実装（Phase 2/3 残項目）

### ポートフォリオルール
- first-class ポートフォリオモデルを追加
  - `portfolios`
  - `portfolio_items`
  - `portfolio_rules`
- ポートフォリオルールは全所属プロジェクトの `project_rules` にレプリカとして射影
  - 既存のルールエンジン・実行履歴・権限・ケイパビリティをそのまま利用
- プロジェクト追加時にレプリカを自動作成
- プロジェクト削除時にレプリカを自動削除
- ルール更新時に全レプリカを同期
- `/portfolio` に共有ポートフォリオ、プロジェクト追加・削除、ポートフォリオルールUIを追加
- ポートフォリオ単位の集約実行履歴

### バンドルのルール同梱
- `bundles.rules` を追加
- バンドル作成時に現在のプロジェクトルールを選択して同梱
- バンドル適用時にルールを対象プロジェクトへ作成
- 適用済みバンドルの再適用では重複作成しない
- バンドル一覧にルール名を表示

### 外部Webhookトリガー
- `automation_webhook_endpoints` を追加
- プロジェクトごとに受信URLと署名シークレットを発行
- `POST /api/automation/webhook/[token]` を追加
  - HMAC-SHA256署名 `x-atlas-signature`
  - 署名不一致は401
  - `webhook.received` ドメインイベントを発火
- ルールUIに受信Webhookの作成・URLコピー・削除を追加
- Webhookトリガーから `task.create` などのアクションを実行可能

### アクション再試行
- アクション実行を最大3回（`AUTOMATION_ACTION_MAX_ATTEMPTS` で変更可能）
- 権限・バリデーション・not found系は再試行しない
- 実行履歴に試行回数を保存

## 追加後の未実装
- Slack / メール等の外部アプリへの直接アクション
- 本物のLLM連携（AI提案はローカルヒューリスティック）
- インポート処理からのイベント発火
- バンドルルールのプロジェクト間パラメータ自動変換
