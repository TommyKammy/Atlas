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
- ユーザーの無効化（SCIM DELETEを含む）、ゲスト化、管理者によるパスワード／2段階認証のリセット時に全トークンを失効させる。利用者本人によるパスワード変更では失効させない（Linearと同じ。2026-11-24決定）。

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
- [x] MCPは無効の状態で出荷し、管理者が有効化する（2026-11-22決定）

成果物: 本ドキュメントの「決定事項」欄の更新

### Phase 1: 認可とサービス層の分離（2〜3日）— 完了（2026-11-22、ブランチ `feat/mcp-phase1-authz`）

MCPとRESTが同じ判定・同じ処理を通るようにする下準備。RESTの挙動は変えていない（エラー応答に標準の `code` 項目が加わったのみ）。

- [x] `lib/api-project-auth.ts` を「セッション解決」と「権限判定」に分離: `AuthActor`、`authorizeProject` / `authorizeTask` / `authorizeWorkspaceAdmin`（`cdffa10`）
- [x] 実行者 `Actor = { uid, source: "web" | "mcp", tokenId?, clientName? }` と、毎回ユーザーの最新状態を読む `requireProjectAccess` / `requireTaskAccess` / `requireWorkspacePermission` / `requireNotGuest`（`lib/services/actor.ts`、`709fa74`）
- [x] 書き込みサービス: `createTask`・`addComment`（`e92b927`）、`updateTaskForActor`・`trashTaskForActor`（論理削除のみ）・`setTaskCustomValue`（`b9a8cf6`）、`createProject`・`createProjectFromTemplate`・`updateProject`・`createSection`（`092ca93`）。該当RESTルートはこれらを呼ぶ形に置き換え
- [x] 参照サービス: `lib/services/queries.ts`（プロジェクト・セクション・タスク検索・タスク詳細・コメント・自分のタスク・ユーザー・メンバー・カスタムフィールド。閲覧権限で絞り込み、カーソル方式のページング）（`c244678`）
- [x] 検証: ユニットテスト586件→653件すべて成功、`typecheck`・ESLint成功、`test:p0`・`test:p1`（Docker上の実DB）成功
- [ ] 監査ログへの `source=mcp`・トークンID・クライアント名の記録はPhase 2/3（DB列の追加が必要）

Phase 1で判明し、Phase 2〜3で決めること:

- `save_project` の状態変更: `PATCH /api/projects/[id]`（`projects.status` を直接更新、イベントなし）と `POST /api/projects/[id]/status-updates`（履歴と `project.status_changed` を記録）のどちらに合わせるか
- `move_task` は単体更新（`updateTaskForActor`）を使う。一括移動（`/api/tasks/bulk`）は副ホームのセクションを更新しない既存の不具合があるため使わない
- `list_my_tasks` にサブタスクを含めるか（既存画面はトップレベルのみ、新サービスは含む）
- 主プロジェクトがアーカイブ済みのマルチホームタスクは参照で404になる
- ページングはオフセット方式（取得中の追加・削除で境界がずれうる）
- `requireNotGuest` のエラーメッセージ（`guest users cannot use MCP`）の文言を確定する

### Phase 2: MCPエンドポイント＋PAT＋参照ツール（3〜4日）— 完了（2026-11-22、ブランチ `feat/mcp-phase2-endpoint`）

- [x] マイグレーション `0038_mcp_tokens.sql`: `mcp_tokens`（ハッシュのみ保存、PATは期限なしをCHECK制約で保証）、`mcp_request_log`（本文・引数・トークンは保存しない。30日で削除）、`workspace_security.mcp_enabled` / `mcp_pat_enabled`（既定は無効）（`78facbd`）
- [x] `lib/mcp/token.ts`・`lib/mcp/auth.ts`: 毎回、トークンの失効・期限（OAuthのみ）・ワークスペースのスイッチ・ユーザーの無効化・ゲストを確認。認証失敗はIP単位でレート制限（`mcp-auth`）
- [x] PATの発行・一覧・失効API（`/api/me/mcp-tokens`）。ゲストは発行不可。無効化（SCIMを含む共通処理）とゲスト化で全トークンを失効
- [x] スイッチの変更は特権管理者のみ（SCIMと同じ）。`PATCH /api/admin/security`
- [x] `POST /mcp`・`POST /mcp/readonly`（SDK v2 2.4.0、`responseMode: "json"`、2025年版への互換応答あり）。Host・Origin検証 → PAT認証 → 実効スコープでツールを絞り込み、固定順で登録。`listChanged` は宣言しない（Claude Codeは `subscriptions/listen` を開かなくなった）（`3242a73`）
- [x] 参照ツール11個: `whoami`、`list_projects`、`get_project`、`list_sections`、`list_tasks`、`get_task`、`list_comments`、`list_my_tasks`、`list_users`、`list_project_members`、`list_custom_fields`
- [x] プロフィールの「MCP接続」（PAT発行・一覧・失効、Claude Code / Codex の設定のコピー）と、セキュリティ設定の「MCP接続」スイッチ（`6735681`）
- [x] 検証: ユニットテスト695件、`typecheck`、ESLint、色トークン検査。使い捨てのDBで画面操作（スイッチON → PAT発行 → 失効）、Claude Code 2.1.330（2026-07-28）とCodex 0.171.0-alpha.13（2025-06-18）から実際に接続してツール呼び出しに成功。拒否の確認: トークンなし・失効済み・ゲストのトークン・PATスイッチOFFは401、不正なOriginは403

注意: `listChanged` を宣言しない処理はSDK 2.4.0の内部の挙動に依存するため、SDK更新時は `lib/mcp/server.test.ts` の該当テストで確認する。

### Phase 3: 書き込みツール（3〜4日）— 完了（2026-11-24、ブランチ `feat/mcp-phase3-write-tools`）

- [x] マイグレーション `0039_mcp_write_support.sql`: `audit_log` に `via`・`mcp_token_id`・`client_name`、`task_events` に `via`・`client_name`、`mcp_idempotency`（24時間）（`c2d9223`）
- [x] 実行文脈（AsyncLocalStorage）: MCPのツール実行と自動化ワーカーで設定し、`audit()`・`logEvent()`・タスク履歴の直接INSERT（完了・承認・インポート・一括）が `via` とクライアント名を記録。監査画面とタスク履歴に「MCP経由」を表示
- [x] 冪等キー（`withIdempotency`）とトークン単位の書き込み制限（20回/分）
- [x] 書き込みツール7個: `save_task`、`complete_task`、`move_task`、`add_comment`、`save_section`（作成のみ）、`save_project`、`trash_task`（論理削除、`destructiveHint`）。作成後の追加反映に失敗した場合は、作成済みのIDと `failed_updates` を返し、同じキーの再送でも再作成しない（`33b598b`）
- [x] `list_my_tasks` にサブタスクの親（閲覧できない親は `parent_hidden`）（`8502bef`）
- [x] 検証: ユニットテスト753件、`typecheck`、ESLint。使い捨てのDBでSDKクライアントから全書き込みツールを実行（冪等キーの再送で重複なし、別引数で409、古い `expected_updated_at` で競合、readonly には書き込みツールが出ない）、監査ログとタスク履歴に `via=mcp` を確認、Codex 0.171.0-alpha.13 から `save_task` と `add_comment` を実行

既知の制約・別作業:
- 2025年版のクライアント（Codex）はクライアント名を `initialize` でしか送らないため、ツール呼び出しの記録ではクライアント名が空になる（「MCP経由」とだけ表示）。トークンに最後のクライアント名を保存して補う案がある
- 既存コードの監査ログ（`comment.create`、`project.update` など）にワークスペースが入らず監査画面に出ない問題がある（MCP以前からの既存の不具合。別作業）
- 作成と追加反映は1つのトランザクションではない（失敗時は `failed_updates` で通知）

### Phase 4: OAuth 2.1（4〜6日）— 完了（2026-11-24、ブランチ `feat/mcp-phase4-oauth`）

- [x] マイグレーション `0040_mcp_oauth.sql`: `oauth_clients`・`oauth_authorization_codes`（10分）・`oauth_refresh_tokens`（30日）、`mcp_tokens` に `resource`・`oauth_client_id`・`oauth_family_id`（`1015d36`）
- [x] `lib/oauth`: PKCE（S256のみ）、ループバックのポートを除いたリダイレクト照合、CIMD（Webhookと同じSSRF対策: 公開IPのみ・接続固定・リダイレクトなし・5秒・64KB、24時間キャッシュ）とDCR、使い捨ての認可コード、アクセス24時間・リフレッシュ30日のローテーション（再利用で系列全失効）。`authenticateMcpToken` が OAuth のトークンと audience（`/mcp` / `/mcp/readonly`）を検証
- [x] メタデータ（RFC 9728 / RFC 8414）、`/oauth/register`・`/oauth/token`（コードの消費と発行は同一トランザクション）・`/oauth/revoke`、`/mcp` の401に `resource_metadata`（`47a5f26`）
- [x] 承認画面 `/oauth/authorize`（クライアント不明・リダイレクト不一致は画面でエラー、その他は state と iss 付きで戻す。ゲスト拒否、MCP無効時は案内）。未ログイン時はパスワード・SAML・MFAの後に戻る短命Cookie。承認のPOSTは同一オリジンのみ、すべて再検証し、no-store・no-referrer の中継画面（meta refresh）で戻す（CSP の form-action は緩めない）。プロフィールの「接続済みアプリ」と連携解除。本番では基準URLにリクエストのHostを使わない（`6d1a3a6`）
- [x] 検証: ユニットテスト919件、`typecheck`、ESLint、色トークン検査。CodexとClaude CodeのCIMDを実取得（私的アドレスは拒否）。使い捨てのDBで、Codex 0.171.0-alpha.13 の `codex mcp login` → 未ログインからログイン → 承認画面 → コールバック → `whoami` と `save_task` の実行まで成功（監査ログに `via=mcp`、クライアント名「Codex」）。トークンエンドポイントの実測: PKCE不一致・コード再利用（系列失効）・別クライアントのリフレッシュ・リフレッシュの再利用（系列失効）を拒否、ローテーション成功、audience不一致で401、他オリジンからの承認POSTは403。接続済みアプリからの解除でCodexが401になることを確認

確認で見つけて直した点: 承認後の303がCSPの `form-action 'self'` で止まり、ローカルのアプリに戻れなかった（中継画面に変更）。承認画面の事前描画で `Date.now()` のエラーが出ていた。

既知の制約・Phase 5以降:
- Claude Code の OAuth（`/mcp` からの対話的な承認）は、この環境では実行できず未確認。CIMDの取得とメタデータは確認済み
- CIMD は任意の https のクライアントIDを受け付けるため、承認画面でクライアントと戻り先を確認することが前提。必要なら管理画面でクライアントIDのドメインを許可リストで制限する（Phase 5の候補）
- 本番では `APP_URL`（または `APP_ORIGIN`）の設定が必須

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
- 既定の状態: MCP接続・PATとも無効で出荷し、管理者が有効化する。2026-11-22決定
- `save_project` の状態変更: `updateProject`（`projects.status` の更新。画面のプロジェクト設定と同じ値）を使う。経緯を投稿する「ステータス更新」は別ツール `save_status_update` として必要になったら追加する。2026-11-24決定
- `list_my_tasks`: サブタスクも含め、親タスクの名前を返す。画面の「マイタスク」（トップレベルのみ）と異なる点はツール説明に書く。2026-11-24決定

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
