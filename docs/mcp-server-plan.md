# Atlas MCPサーバー ワークプラン

作成: 2026-11-22 / 状態: 計画（未着手）

## 1. ゴール

Linearと同じように、Claude CodeやCodex appからリモートMCPサーバーとしてAtlasに接続できるようにする。ブラウザーを操作しなくても、AIツールが**接続したユーザーの権限の範囲内で**次の操作を行えるようにする。

- タスクの検索・参照・作成・更新・完了・移動・コメント
- プロジェクトの参照・作成・更新、セクションの作成
- 自分のタスク、受信トレイ、検索などの参照

### 接続イメージ（完成形）

```bash
# Claude Code（OAuth。/mcp からブラウザーで一度だけ承認）
claude mcp add --transport http atlas https://atlas.tmcast.net/mcp
```

```bash
# 読み取り専用で接続する場合
claude mcp add --transport http atlas-readonly https://atlas.tmcast.net/mcp/readonly
```

```toml
# Codex（~/.codex/config.toml。OAuthは `codex mcp login atlas`）
[mcp_servers.atlas]
url = "https://atlas.tmcast.net/mcp"
```

OAuthを実装するまでの間は、個人アクセストークン（PAT）をヘッダーで渡して接続する（Claude Code: `--header "Authorization: Bearer …"`、Codex: `bearer_token_env_var`）。CLIのオプション名はPhase 0で最新版を確認する。

### 対象外（今回はやらない）

- ワークスペース管理操作（ユーザー管理、ロール、SAML/SCIM設定、LLM接続設定）
- 完全削除（ゴミ箱を空にする操作）。論理削除（ゴミ箱へ移す）は `write` の範囲で扱う
- AtlasからLLMを呼ぶ機能（docs/llm.md）との統合。MCPは外部AIがAtlasを操作する逆向きの経路

## 2. 現状の調査結果

| 項目 | 現状 | MCPでの扱い |
| --- | --- | --- |
| 認証 | Cookieセッション（`atlas_session`、`lib/api/session.ts`）。SAML・MFAのポリシーあり | MCPはCookieを使えないため、Bearerトークンによる別経路が必要 |
| 認可（プロジェクト） | `admin/editor/commenter/viewer`（`lib/project-roles.ts`）。`requireProjectPermission(req, …)` が `req` からセッションを読む | `req` に依存しない「actor（uid）＋プロジェクト」の判定関数に分離して共用する |
| 認可（ワークスペース） | RBAC `hasPermission(uid, "projects.create" / "tasks.create")`、ゲストは権限なし（`lib/permissions.ts`） | そのまま利用。トークンのスコープとの積集合を実効権限にする |
| ドメイン操作 | RESTルートにバリデーションが直書きのものと、`lib/services/*`（例: `insertTask`）に切り出し済みのものが混在 | MCPツールとRESTが同じサービス関数を呼ぶ形に寄せる |
| capabilityゲートウェイ | `lib/capabilities`。`source: "ai"` を想定済みだが、監査ログが `automation.*`、履歴文言が「ルールから作成」、タスク作成の項目が少ない（開始日・マイルストーン等なし） | そのままは流用しない。サービス層を主に使い、capabilityは必要に応じてsourceごとの文言に修正 |
| トークンの前例 | SCIMトークン（`lib/scim/token.ts`、SHA-256ハッシュのみ保存、平文は発行時に1回表示、失効、`last_used_at`、失敗時のレート制限） | 同じ方式でMCPトークンを実装する |
| リアルタイム | `notifyProject` / WebSocket（`server.js`） | MCPからの変更もブラウザーに即時反映させる |
| 監査 | `audit()` | `source=mcp`、トークンID、クライアント名を記録 |
| 本番 | atlas.tmcast.net（nginx 1.31.9 → 127.0.0.1:3000）。Let's Encrypt証明書でHTTPS化済み（2026-11-22確認、期限2027-02-19） | OAuthとリモートMCPの前提を満たす（自動更新もサーバー側で設定済み） |

## 3. 設計方針

### 3.1 トランスポート

- **プロトコル版: MCP 2026-07-28**（決定）。この版ではプロトコル自体がステートレスになり、`initialize` ハンドシェイクと `Mcp-Session-Id` が廃止された。各リクエストが `_meta` に版とクライアント情報を持つ。
- **SDK: 公式TypeScript SDK v2 `@modelcontextprotocol/server`**（決定。2026-11-22時点の最新は2.4.0、依存に `@modelcontextprotocol/core` と `zod` ^4.2）。v1の `@modelcontextprotocol/sdk`（最新1.32.2）は2025-11-25までしか対応しないため使わない。新規依存のため、`package.json` にバージョンを固定して追加する。
- **Streamable HTTP の単一エンドポイント**を既存のNext.jsアプリ内に置く: `app/mcp/route.ts`（既定）と `app/mcp/readonly/route.ts`（読み取り専用、3.3参照）。DB接続、サービス、監査、通知をそのまま使えるため、別プロセスにしない。
- SDKの `createMcpHandler` で作るハンドラーの `fetch`（Web標準の `Request → Response`）をRoute HandlerのPOSTにそのまま渡す。リクエストごとにサーバーを生成し、状態を持たない。
- 2026-07-28で必要になる点はSDKに任せる: `server/discover`、結果の `resultType`、`Mcp-Method` / `Mcp-Name` ヘッダーの検証、エラーコード。Atlas側では次を守る:
  - `tools/list` の順序を固定する（クライアント側のキャッシュのため）
  - `tools/list` に `ttlMs` と `cacheScope: "private"` を付ける（トークンのスコープで一覧が変わるため）
  - 廃止予定の Roots / Sampling / Logging は使わない
- **2025年版のクライアントにも対応する（必須）**: SDK v2は既定（`legacy: "stateless"`）で2025年版のクライアントにも同じハンドラーで応答する。Phase 0の試作で、Claude Code 2.1.330は2026-07-28版で、Codex 0.171.0-alpha.13は2025-06-18版で接続することを確認したため、`legacy: "reject"` にしてはいけない（付録A）。
- SDKのハンドラーはHost・Origin・トークンを検証しないため、前段にSDKの `hostHeaderValidation` / `originValidation` と、Atlas独自のトークン検証を置く。
- 応答は `responseMode: "json"`（ストリーミングしない）。`GET /mcp` は405を返す。
- **Claude Codeは接続直後に `subscriptions/listen`（ツール一覧の変更通知を受け取る長時間のSSE接続）を開く**ことを試作で確認した。SDKが処理するが、1クライアントにつき接続が1本張られたままになる。Phase 2で次のどちらかに決める: (a) 受け付ける。nginxの `/mcp` で `proxy_buffering off` と長めの `proxy_read_timeout` を設定し、`maxSubscriptions` で上限を設ける (b) ツール一覧の変更通知（`listChanged`）を宣言せず、購読を開かせない
- `proxy.ts` は未ログインのリクエストを `/login` へ転送するため、`/mcp`、`/mcp/readonly`、`/.well-known/oauth-*`、`/oauth/*` を公開パスに加える（試作で必要なことを確認）。
- `server.js` は単一インスタンス前提だが、ステートレスにしておけば将来の複数インスタンス化も妨げない。

### 3.2 認証（2段階）

**Phase 2: 個人アクセストークン（PAT）**

- プロフィール画面でユーザー自身が発行する。形式は `atlas_mcp_<ランダム>`。保存はSHA-256ハッシュのみ、平文は発行時に1回だけ表示。
- SDKのBearer検証ヘルパー（`verifyBearerToken` / `requireBearerAuth`）は有効期限（`expiresAt`）のないトークンを拒否する。PATは無期限のため、トークン検証はAtlas側で実装する（SCIMトークンと同じ方式）。
- 名前、権限（「読み取りと書き込み」＝`read write`、または「読み取りのみ」＝`read`）、`last_used_at`、失効。
- **有効期限はない（Linearと同じ）**。発行画面に期限の項目は置かず、本人または管理者が失効させるまで有効。代わりに一覧で最終利用日時を表示し、使っていないトークンの失効を促す。
- **ゲストは発行できない**。発行APIと画面の両方でゲストを拒否する。
- 管理者がワークスペース設定で「MCP接続を許可」「PATを許可」を切り替えられる（既定は無効）。
- ユーザーの無効化（SCIM DELETEを含む）、ゲスト化、パスワード／MFAリセット時に全トークンを失効させる。

**Phase 4: OAuth 2.1（Linearと同じ接続体験）**

- Atlas自身を認可サーバーにする（外部IdPは使わない。SAMLログインは承認画面の前段として既存のまま使う）。
- 実装する仕様:
  - RFC 9728 Protected Resource Metadata: `/.well-known/oauth-protected-resource`、401時の `WWW-Authenticate: Bearer resource_metadata=…`
  - RFC 8414 Authorization Server Metadata: `/.well-known/oauth-authorization-server`
  - 認可コード＋PKCE（S256必須）、RFC 8707 `resource` パラメーター（`/mcp` と `/mcp/readonly` のどちらか）
  - 認可レスポンスに RFC 9207 の `iss` パラメーターを付ける（2026-07-28で推奨。クライアントは `iss` を検証する）
  - **クライアント登録: Client ID Metadata Document（CIMD）を主に、RFC 7591 動的クライアント登録（DCR）を予備として両方実装する（決定）**。Phase 0で、両方を提示するとCodexがCIMD（`client_id=https://chatgpt.com/oauth/codex/client.json`）を選ぶこと、Claude CodeもCIMDのクライアントID（`https://claude.ai/oauth/claude-code-client-metadata`）とDCRの両方を実装していることを確認した（付録A）
  - CIMDではクライアントIDのURL（https）からメタデータを取得し、`redirect_uris` と照合する。取得はLLM接続と同じSSRF対策（公開IPのみ、DNS解決結果に接続を固定、リダイレクトを追わない、サイズとタイムアウトの上限）で行い、結果を一定時間キャッシュする
  - DCRでは `application_type` を受け取り、`native` ならループバックのリダイレクトだけを許可する
  - ループバックのリダイレクトはポート番号が毎回変わる（Codexの例: `http://127.0.0.1:60217/callback`）ため、ポートを除いて照合する
  - SDK v2のサーバー側OAuthの補助（`oauthMetadata`、`bearerAuth`）はメタデータ公開とトークン検証に使う。認可サーバー本体（承認画面、トークン発行）はAtlasのセッション・SAML方針と結び付ける必要があるため自前で実装する
  - **有効期限（Linearと同じ）: アクセストークン24時間、リフレッシュトークン30日**。リフレッシュのたびに新しいリフレッシュトークン（期限は発行から30日）に交換するため、使い続ける限り再認証は不要で、30日間使わなければ再認証が必要になる
  - リフレッシュトークンのローテーション（使用済みトークンの再利用を検出したら同じ系列をすべて失効）、失効エンドポイント
  - **ゲストには承認画面を表示せず拒否する**
- 承認画面: 既存セッション（SAML必須ポリシー・MFAも満たしたもの）でログイン済みであることを要求し、クライアント名、リダイレクト先、要求スコープを表示して同意を得る。
- リダイレクトURIは `http://localhost:*` / `http://127.0.0.1:*`（ループバック）と `https` のみ許可。

### 3.3 認可

**Linear方式に準拠する（決定）。** 既定では、認証したユーザーがAtlas上で持つ権限の範囲内で、タスク・プロジェクト・コメントなどの検索・作成・更新ができる。作成や変更をさせたくない場合は、次の3つのどれか1つで読み取り専用にできる。

| 読み取り専用にする方法 | Atlasでの実装 |
| --- | --- |
| 読み取り専用エンドポイントに接続する | `https://atlas.tmcast.net/mcp/readonly`。トークンに `write` があっても書き込みツールを公開せず、呼ばれても拒否する |
| OAuth認証で `read` スコープだけを要求する | 承認画面に「読み取りのみ」と表示し、`read` だけのトークンを発行する |
| 「読み取りのみ」の個人アクセストークンを使う | PAT発行画面で「読み取りのみ」か「読み取りと書き込み」を選ぶ |

**実効権限 = ユーザーの現在の権限（プロジェクトロール＋RBAC） ∩ トークンのスコープ ∩ エンドポイント**

| スコープ | 内容 |
| --- | --- |
| `read` | 参照系ツールすべて（閲覧できるプロジェクトのみ） |
| `write` | 作成・更新系ツールすべて（`read` も必要）。プロジェクトの作成はRBACの `projects.create`、タスクの編集はプロジェクトの編集権限も必要 |

- OAuthでスコープを指定しない場合の既定は `read write`（Linearの標準エンドポイントと同じ）。PATも既定は「読み取りと書き込み」とし、発行画面で変更できる。
- `tools/list` は実効スコープで絞り込む。読み取り専用の接続には書き込みツールを表示しない。
- 判定はツール実行のたびに行う。トークン発行時の権限をキャッシュしない（ロール変更や除名が即時反映される）。
- 削除もLinearと同じく `write` の範囲に含める。ただし対象はタスクの論理削除（ゴミ箱へ移すだけ）に限り、`destructiveHint` を付けてクライアントに確認を出させる。完全削除は提供しない。

- 一覧・検索は既存の `authorized-data` / `scope` の絞り込みを必ず通す。閲覧不可のプロジェクトは存在自体を返さない（404相当）。
- **ゲストユーザーはMCPを使えない（決定）**。PATの発行とOAuthの承認を拒否し、トークン検証でも毎回ゲストでないことを確認する。メンバーがゲストに変更されたら、その時点で全トークンを失効させる。

### 3.4 ツール設計

Linearの命名に合わせ、作成と更新を `save_*` にまとめる（`id` なし＝作成、あり＝更新）。各ツールに `readOnlyHint` / `destructiveHint` / `idempotentHint` を付け、クライアント側の確認表示を正しく働かせる。

| 種別 | ツール | スコープ |
| --- | --- | --- |
| 参照 | `whoami`, `list_projects`, `get_project`, `list_sections`, `list_tasks`（project / assignee=`me` / status / 期限 / キーワード / cursor）, `get_task`, `list_comments`, `list_my_tasks`, `search`, `list_users`, `list_project_members`, `list_custom_fields` | `read` |
| 更新 | `save_task`（名前・説明・担当・開始日・期限・状態・セクション・親・カスタムフィールド・マイルストーン）, `complete_task`, `move_task`, `add_comment`, `save_section` | `write` |
| プロジェクト | `save_project`（作成時はテンプレート指定可。状態・説明・期限の更新） | `write` |
| 削除 | `trash_task`（論理削除のみ） | `write` |

共通ルール:

- 引数はIDのほか人が読める参照も受け付ける（ユーザーはメールまたは `me`、プロジェクトは名前の完全一致。曖昧な場合は候補を返してエラー）。
- 出力はJSON（`structuredContent`）と短い要約テキスト。一覧は既定25件・最大100件のカーソル方式。説明文は長さを制限し、続きは `get_task` で取得。
- 作成系は `idempotency_key` を受け付け、再送で二重作成しない。
- 更新系は任意で `expected_updated_at` を受け付け、他者の更新と衝突したら上書きせずエラーにする（既存の `updated_at` を利用）。
- タスク名・説明・コメントは利用者が書いた**信頼できないデータ**としてAIに渡ることを、ツール説明に明記する。

### 3.5 安全性・運用

- レート制限: トークン単位（例: 60回/分、書き込み20回/分）と、認証失敗のIP単位（既存 `auth-rate-limit` に `mcp-auth` ポリシーを追加）。
- 監査: すべての書き込みを `audit()` に `source=mcp`、トークンID、OAuthクライアント名付きで記録。タスク履歴には「MCP（クライアント名）経由」と表示。
- 実行ログ: `mcp_request_log`（ツール名、成否、所要時間、トークンID）。引数・本文は保存しない。30日で削除（SCIMログと同じ）。
- Originヘッダーの検証（ブラウザーからのDNSリバインディング対策）。Cookieは一切受け付けない（CSRF対策）。
- nginx: `/mcp` と `/.well-known/oauth-*` をプロキシ。`proxy_buffering off`、適切なタイムアウト、ボディ上限。

## 4. フェーズ別ワークプラン

見積もりは実装担当1名の目安。各フェーズは1つのPRにまとめ、`npm run typecheck` / `npm test` / 該当E2Eが通ることを完了条件とする。

### Phase 0: 前提の確定（0.5〜1日）

- [x] ローカルの `main` を最新化（2026-11-22、`e2dec0c`）
- [x] atlas.tmcast.net の Let's Encrypt 証明書（2026-11-22確認）
- [x] 証明書の自動更新はサーバー側で設定済み（利用者確認、2026-11-22）
- [x] プロトコル版: 2026-07-28、SDK: `@modelcontextprotocol/server` v2最新（2.4.0）
- [x] スコープ: Linear方式（`read` / `write`、`/mcp/readonly`、読み取り専用PAT）
- [x] SDK v2の `createMcpHandler` がNext.js 16.4のRoute Handlerで動くことを試作で確認（2026-11-22、付録A）
- [x] Claude Code／Codexの接続時のプロトコル版、Bearerヘッダー、OAuthのクライアント登録方式を確認（2026-11-22、付録A）
- [x] 有効期限: PATは無期限（手動失効まで）、OAuthはアクセス24時間・リフレッシュ30日
- [x] ゲストには使わせない
- [ ] MCPの既定（無効で出荷し、管理者が有効化）を確認

成果物: 本ドキュメントの「決定事項」欄の更新

### Phase 1: 認可とサービス層の分離（2〜3日）

MCPとRESTが同じ判定・同じ処理を通るようにする下準備。挙動は変えない。

- [ ] `lib/api-project-auth.ts` を「セッション解決」と「権限判定」に分ける: `authorizeProject(uid, projectId, level, q?)`、`authorizeTask(uid, taskId, level, scope?)`。既存の `requireProjectPermission(req, …)` は内部でこれを呼ぶ
- [ ] ツール対象の操作をサービス関数に切り出す（未分離のもの）: タスク作成・更新・完了・移動、コメント作成、セクション作成、プロジェクト作成・更新、タスク一覧・検索
- [ ] 実行者情報の型 `Actor = { uid, source: "web" | "mcp", tokenId?, clientName? }` を導入し、監査・履歴に渡す
- [ ] 既存RESTルートを新しいサービス関数経由に置き換え、既存テスト（`test:p0`、`test:p1`）で回帰がないことを確認

### Phase 2: MCPエンドポイント＋PAT＋参照ツール（3〜4日）

- [ ] マイグレーション `00xx_mcp.sql`: `mcp_tokens`（user_id、name、token_hash、scopes、expires_at（PATはNULL）、last_used_at、revoked_at、kind=`pat`/`oauth`）、`workspace_security.mcp_enabled` / `mcp_pat_enabled`、`mcp_request_log`
- [ ] `lib/mcp/token.ts`・`lib/mcp/auth.ts`（SCIMの実装を踏襲。ユーザーの無効化・ゲスト状態・トークン期限（OAuthのみ）を毎回確認）
- [ ] ゲストのPAT発行拒否と、ゲストへの変更時の全トークン失効
- [ ] `@modelcontextprotocol/server`（v2）を追加し、`app/mcp/route.ts` と `app/mcp/readonly/route.ts` を実装（`createMcpHandler`、ステートレス）。未認証時は401と `WWW-Authenticate`
- [ ] Host・Origin検証、`tools/list` の固定順序と `ttlMs` / `cacheScope: "private"`、実効スコープによるツールの絞り込み
- [ ] 2026-07-28版のクライアントと2025年版のクライアントの両方で `server/discover`・`tools/list`・`tools/call` が通るテスト
- [ ] `lib/mcp/tools/*` に参照ツールを実装（3.4の参照行）
- [ ] プロフィール画面に「MCP接続」セクション（PAT発行・一覧・失効、接続コマンドのコピー）
- [ ] ユーザー無効化時の全トークン失効を、既存の共通無効化処理に追加
- [ ] テスト: トークン検証、スコープ不足、閲覧不可プロジェクトの非表示、無効化ユーザーの拒否、ページング
- [ ] 開発環境でClaude Code・Codexから `list_projects` / `get_task` が動くことを確認

### Phase 3: 書き込みツール（3〜4日）

- [ ] `save_task`、`complete_task`、`move_task`、`add_comment`、`save_section`、`save_project`、`trash_task`（論理削除のみ）
- [ ] 冪等キー（`mcp_idempotency`、24時間保持）と `expected_updated_at` による衝突検出
- [ ] 監査・タスク履歴の「MCP経由」表示、`notifyProject` によるブラウザーへの即時反映
- [ ] 自動化ルールとの連携確認: MCPで作成・変更したタスクでも既存ルールが通常どおり発火し、連鎖上限が効くこと
- [ ] レート制限（トークン単位）
- [ ] テスト: 読み取り専用の3経路（`/mcp/readonly`、`read` だけのOAuth、読み取り専用PAT）で書き込みが拒否され一覧にも出ないこと、ロール別（viewer/commenterは書き込み不可）、RBAC（`projects.create` なしは作成不可）、冪等再送、競合、REST版と同じバリデーション結果になること

### Phase 4: OAuth 2.1（4〜6日）

- [ ] メタデータエンドポイント（RFC 9728 / RFC 8414）
- [ ] クライアント登録（CIMD または DCR。Phase 0の決定に従う）、`oauth_clients` テーブル
- [ ] `/oauth/authorize`（承認画面。SAML必須・MFAを含む既存ログインを再利用。ゲストは拒否）、`/oauth/token`（PKCE S256、`resource` 検証、アクセス24時間・リフレッシュ30日、リフレッシュのローテーション）、`/oauth/revoke`
- [ ] 発行トークンは `mcp_tokens`（kind=`oauth`）に保存し、Phase 2の検証処理を共用
- [ ] プロフィール画面に「接続済みアプリ」一覧と連携解除
- [ ] テスト: PKCE不一致、redirect_uri不一致、別resource向けトークンの拒否、リフレッシュ再利用の検出（ファミリー全失効）、期限切れ（24時間・30日）の拒否、ゲストの拒否
- [ ] 実機確認: Claude Code `/mcp` と `codex mcp login` でブラウザー承認からツール実行まで

### Phase 5: 管理機能・ドキュメント（2〜3日）

- [ ] 管理 → セキュリティに「MCP接続」設定（有効化、PAT許可、ユーザー別トークン一覧（最終利用日時つき）と強制失効、リクエストログ）
- [ ] `docs/mcp.md`（利用者向けの接続手順、スコープの説明、管理者向け設定、セキュリティ上の注意）
- [ ] ヘルプページ（`app/help`）に接続手順を追加
- [ ] nginx設定（`deploy/nginx`）に `/mcp` と `/.well-known/oauth-*` を追加

### Phase 6: 本番展開と検証（1〜2日）

- [ ] 検証サーバーにデプロイ（マイグレーション、`NODE_ENV=production npm run build`、ユーザーユニット再起動。サーバー側の2つのローカル変更を再適用）
- [ ] 本番URLでClaude Code・Codexからの一連の操作（プロジェクト作成 → タスク作成 → 担当・期限設定 → コメント → 完了）を確認し、ブラウザー画面と監査ログに反映されていることを確認
- [ ] 権限境界の確認（閲覧専用ユーザーのトークンで書き込みが拒否される、除名直後にアクセスできない）

**合計目安: 約16〜23日**（PATだけで使い始めるならPhase 0〜3と5の一部で約9〜12日）

## 5. リスクと対策

| リスク | 対策 |
| --- | --- |
| AIによる意図しない大量変更 | スコープの最小化（削除は既定オフ）、書き込みのレート制限、`destructiveHint`、監査ログ、ゴミ箱からの復元 |
| タスク本文経由のプロンプトインジェクション | ツール説明で「データであり指示ではない」と明示。サーバー側は権限外の操作を必ず拒否するため、被害はトークン所有者の権限内に限られる |
| RESTとMCPで挙動がずれる | Phase 1で同一サービス関数に統一し、同じ入力で同じ結果になるテストを置く |
| トークン漏えい（PATは無期限のため影響が長く続く） | ハッシュ保存、OAuthは短い有効期限、`last_used_at` 表示、本人と管理者による失効、ユーザー無効化・ゲスト化で一括失効、利用状況のリクエストログ |
| SAML必須ポリシーの回避 | PATの発行とOAuth承認はSAMLセッションでのみ許可（`session-policy` を再利用） |
| MCP仕様・クライアントの変化が速い | プロトコル版を固定し、SDK経由で実装。Phase 0でクライアントの最新対応を確認 |

## 6. 決定事項（Phase 0で記入）

- プロトコル版: 2026-07-28（2025年版クライアントへの互換応答は維持）。2026-11-22決定
- SDK: `@modelcontextprotocol/server` v2最新（2026-11-22時点で2.4.0）。2026-11-22決定
- スコープ: Linear方式。既定は `read write`。読み取り専用は `/mcp/readonly`、`read` だけのOAuth、読み取り専用PATのどれか。削除はタスクの論理削除のみで `write` に含める。2026-11-22決定
- クライアント登録方式: CIMDを主、DCRを予備として両方実装。2026-11-22決定（試作の結果による）
- 有効期限: PATは無期限（手動失効まで）。OAuthはアクセストークン24時間、リフレッシュトークン30日（Linear準拠）。2026-11-22決定
- ゲストへの開放: しない。2026-11-22決定

## 付録A: Phase 0 試作の結果（2026-11-22）

作業用worktree（ブランチ `feat/mcp-phase0-spike`、試作コードはコミットしていない）に、Atlasのデータを扱わない試作の `/mcp`（固定の開発用トークンと `spike_echo` ツール1つ）と、OAuthのメタデータを返すだけのエンドポイントを置いて確認した。`npm run typecheck` とESLintは通過。試作のコードは本実装では作り直す。

### Next.js 16.4での動作

- `app/mcp/route.ts` のPOSTで `createMcpHandler(factory, { responseMode: "json" }).fetch(req)` を返すだけで動作した。カスタムサーバー（`server.js`）経由でも問題なし。
- 未認証時の401、`GET` の405も想定どおり。
- `proxy.ts` の公開パスに追加しないと `/login` へ転送される。

### プロトコル版

| 接続元 | 版 | 観測した流れ |
| --- | --- | --- |
| 公式クライアントSDK v2（既定） | 2025-11-25 | `initialize` → `tools/list` → `tools/call`。SDK v2のクライアントも既定は2025年版 |
| 公式クライアントSDK v2（`versionNegotiation` を `auto` または `pin: "2026-07-28"`） | 2026-07-28 | `server/discover` → `tools/list`（`ttlMs: 0`、`cacheScope: "private"` 付き）→ `tools/call` |
| Claude Code 2.1.330 | 2026-07-28 | `server/discover` → `subscriptions/listen` → `tools/list` |
| Codex 0.171.0-alpha.13 | 2025-06-18 | `initialize` → `tools/list` → `tools/call`。`bearer_token_env_var` によるBearerトークンで実際にツール呼び出しまで成功 |

### OAuthのクライアント登録

認可サーバーのメタデータでCIMD（`client_id_metadata_document_supported: true`）とDCR（`registration_endpoint`）の両方を提示した。

- **Codex**（`codex mcp login`）: 保護リソースのメタデータ → 認可サーバーのメタデータの順に取得し、DCRを使わずCIMDで認可画面へ進んだ。認可リクエストは `client_id=https://chatgpt.com/oauth/codex/client.json`、`code_challenge_method=S256`、`redirect_uri=http://127.0.0.1:<毎回変わるポート>/callback`、`scope=read write`、`resource=<MCPのURL>`。
- **Claude Code**: 接続時に保護リソースと認可サーバーのメタデータを取得し、登録と認可は利用者が認証を始めたときに行う。実行ファイルにはCIMDのクライアントID `https://claude.ai/oauth/claude-code-client-metadata` と、DCR（`registration_endpoint`、`application_type`）の両方の実装がある。どちらを選ぶかの実際の動作はPhase 4の実機確認で見る。

### 本実装への反映

1. 2025年版への互換応答は必須（Codexのため）。
2. Claude Codeの `subscriptions/listen` への対応方針をPhase 2で決める（3.1）。
3. PATの検証はSDKのBearerヘルパーを使わずAtlas側で実装する（3.2）。
4. OAuthはCIMDを主、DCRを予備にする（3.2）。
