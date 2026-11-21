# SCIM 2.0 ユーザープロビジョニング

Atlas は SCIM 2.0（RFC 7643 / 7644）のユーザー用エンドポイントを提供します。Entra ID と Okta からアカウントの作成・更新・無効化ができます。Phase 2 で管理画面の SCIM 設定 UI を追加しました。トークンの発行・失効、SCIM の有効化・無効化、同期の記録の確認は **super 管理者（`EffectiveRole.isSuper`）だけ** が行えます。通常の管理者は読み取り専用の案内だけを表示し、管理者 API は 403 を返します。

> **HTTPS が必須です。** ベアラートークンを平文で送るため、Atlas と IdP の間は必ず HTTPS で接続してください。HTTP の接続先は本番・検証とも使用しないでください。

## 管理画面からの設定

1. 管理者コンソールの「セキュリティ」→「プロビジョニング（SCIM）」を開きます。
2. 「SCIM を有効にする」を押します。確認ダイアログには、SAML の自動作成（JIT）が止まり、新しいアカウントは IdP からだけ作られることが表示されます。
   - SCIM を有効にしても、既存のアカウントとセッションはそのまま残ります。パスワードでのサインインや、既にアカウントがある人の SAML サインインは、IdP で割り当てていなくても続けて使えます。
   - IdP で割り当てていない人を止めるには、メンバーの管理で無効にするか、SAML を必須にします。切り替える前に、IdP の対象者と Atlas の既存ユーザーを突き合わせておくと確実です。
3. 「IdP に設定するテナント URL」をコピーします。値は `<公開オリジン>/scim/v2` です。オリジンはサーバー側で `APP_ORIGIN` を優先し、無ければリクエストの `X-Forwarded-Host` / `Host` とプロトコルから求めます（`lib/scim/route.ts` の `scimOrigin` と同じ規則）。
4. 「トークンを発行」で名前と IdP（Entra ID / Okta / 汎用）を指定します。発行した平文はその場で一度だけ表示されます。コピーして IdP に設定してください。画面を閉じると再表示できません。Atlas は SHA-256 ハッシュだけを保存し、平文をログや localStorage に残しません。
5. IdP 側で接続テストとユーザーの割り当てを行い、「最近の同期」で成功を確認します。
6. トークンを作り直すときは、**新しいトークンを発行 → IdP のシークレット トークン / API Token を差し替えて接続テスト → 古いトークンを失効** の順で行います。先に失効させると同期が止まります。

URL が HTTPS でない場合、画面に「Entra ID・Okta は HTTPS が必要です」という注意が表示されます。本番では HTTPS の公開 URL を `APP_ORIGIN` に設定してください。

SCIM を無効にすると IdP からのプロビジョニングは停止し、SAML の自動作成（JIT）は SAML の設定どおりに戻ります。無効化してもトークンとユーザーの `scim_identities` は残るため、後で有効に戻すと同期を再開できます。不要なトークンは個別に失効させてください。

## エンドポイント

ベース URL は `https://<ホスト>/scim/v2` です。

| メソッド | パス | 内容 |
| --- | --- | --- |
| GET | `/scim/v2/ServiceProviderConfig` | 対応機能（PATCH、filter、bulk/sort/etag/changePassword 非対応） |
| GET | `/scim/v2/ResourceTypes` | `User` リソース |
| GET | `/scim/v2/Schemas` | 対応する User 属性のみ |
| GET | `/scim/v2/Users` | ユーザー一覧（`filter`、`startIndex`、`count`） |
| POST | `/scim/v2/Users` | ユーザー作成、または既存ユーザーへの結び付け |
| GET | `/scim/v2/Users/{id}` | `id` は Atlas の `users.id`（文字列） |
| PUT | `/scim/v2/Users/{id}` | 対応属性の置き換え（Okta の更新） |
| PATCH | `/scim/v2/Users/{id}` | `add` / `replace` / `remove`（Entra の更新） |
| DELETE | `/scim/v2/Users/{id}` | 無効化（完全削除しない） |

すべてのエンドポイントで認証が必要です。レスポンスは `Content-Type: application/scim+json` です。リクエストは `application/scim+json` と `application/json` を受け付け、本文は 1 MB までです。

### 認証

```
Authorization: Bearer atlas_scim_...
```

トークンが無効・失効済み、またはワークスペースで SCIM が無効な場合は 401 を返します。認証の失敗はクライアント IP 単位で制限されます（15 分間に 60 回）。認証に成功したリクエストは回数制限の対象外です。

### エラー

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status": "400",
  "scimType": "invalidFilter",
  "detail": "unsupported filter: ..."
}
```

`status` は文字列です。主な `scimType` は `invalidFilter`、`invalidValue`、`invalidSyntax`、`uniqueness` です。

## 対応する属性

| SCIM | Atlas | 備考 |
| --- | --- | --- |
| `userName` | `scim_identities.user_name` | IdP が送った値をそのまま保存。Entra の UPN のようにメールアドレスと異なる場合があります。SCIM 未管理ユーザーは `users.email` を返します。 |
| `emails` | `users.email` | `primary`、次に `type: "work"` の値を使用。`emails` が無いリクエストだけ `userName` をメールアドレスとして使用。 |
| `name.formatted` | `users.name` | 表示名。 |
| `displayName` | `users.name` | `name.formatted` が無いときに使用。 |
| `name.givenName` + `name.familyName` | `users.name` | `scim_identities` に個別保存し、両方あれば「given family」で連結。 |
| `title` | `users.title` | `remove title` は空文字にします。 |
| `active` | `users.deactivated_at` | `false` で無効化、`true` で有効化。真偽値と `"True"` / `"False"` の文字列を受理。 |
| `externalId` | `scim_identities.external_id` | IdP 側の ID。Atlas の `id` とは別に保存。 |
| `id` | `users.id` | 読み取り専用。文字列で返します。 |

`name.formatted` / `displayName` / `name.givenName` / `name.familyName` は `scim_identities` に保存します。PATCH で `name.familyName` だけを送っても、保存済みの `givenName` を残したまま表示名を更新します。表示名の優先順位は `name.formatted` → `displayName` → 「givenName familyName」です。

返却する User は `schemas`、`id`、`externalId`（あれば）、`userName`、`name`、`displayName`、`emails`、`title`、`active`、`meta` です。`userName` は identity の `user_name`、未管理ユーザーは `users.email` です。`meta.lastModified` は `scim_identities.updated_at`、未管理ユーザーは `users.created_at` です。

Entra ID は `userName` に UPN（例: `taro@corp.onmicrosoft.com`）を送り、実際のメールアドレスを `emails[type eq "work"].value`（例: `taro@corp.com`）で送ることがあります。Atlas はこの 2 つを分けて保存し、SAML のメール照合に使う `users.email` は work メールのまま維持します。`userName` だけを PATCH しても、現在のメールアドレスが古い `userName` と同じ場合（つまり userName から作られた場合）にだけメールアドレスが追従します。

### フィルタ

`GET /Users` の `filter` は次の形だけを受け付けます。属性名と演算子は大文字小文字を区別しません。値は引用符付き文字列です。

- `userName eq "..."`（identity があるユーザーは `scim_identities.user_name`、未管理ユーザーは `users.email` と大文字小文字を区別せず照合）
- `externalId eq "..."`
- `id eq "..."`
- `emails.value eq "..."`
- `emails[type eq "work"].value eq "..."`

それ以外（`ne`、`co`、複合条件など）は 400 `invalidFilter` です。`startIndex` は 1 始まりで、1 未満は 1 として扱います。`count` の既定は 100、上限は 200 です。`count=0` は `totalResults` のみを返します。

一覧は SCIM で削除（無効化）されていない全ユーザーを返します。SCIM でまだ管理していない既存ユーザーも含まれるため、Entra ID と Okta はまず `filter=userName eq ...` で既存ユーザーを探し、見つかった場合はその `id` で結び付けられます。

## 作成・結び付け

- 同じメールアドレスのユーザーが存在しない場合は、既定ロール（SAML JIT と同じ `getDefaultRole()`、通常はメンバー）でパスワードなしのユーザーを作成します。
- 同じメールアドレスのユーザーが存在する場合は新しく作らず、そのユーザーに `scim_identities` を結び付けて 201 を返します。
- 既に `deleted_at` の無い SCIM identity が同じメールアドレスまたは同じ `userName` に存在する場合、POST は 409 `uniqueness` です（RFC 7644 3.3）。同じ内容の POST を繰り返しても 2 回目は 409 になります。
- `deleted_at` のある identity の再結び付け、または SCIM 未管理の既存ユーザーへの結び付けは 201 です。再結び付けでは新しい `externalId` と現在のトークンの IdP で上書きします。
- 既に同じ IdP の別の `externalId` で結び付いている場合は 409 `uniqueness` です。
- 別の IdP に結び付いているユーザーを、別の IdP のトークンで更新・削除した場合は 409 にせず、現在のトークンの IdP に結び付けを更新します。監査ログの summary に IdP の変更を残します。
- `active: false` で作成・結び付けされた場合は無効化します。`active: true` で既存の無効ユーザーに結び付けた場合は有効化します。
- PUT で `active` を省略した場合は有効・無効を変更しません。`emails` を省略した場合は、現在のメールアドレスが古い `userName` と同じときだけ新しい `userName` に追従します。

SCIM からロールは変更しません。作成したユーザーは既定ロールのままです。

## 削除・無効化の扱い

`DELETE /Users/{id}` は 204 を返しますが、Atlas のアカウントを完全削除しません。

1. ユーザーを無効化（`deactivated_at` を設定）し、そのユーザーのセッションを削除します。
2. `scim_identities.deleted_at` を設定します。以後 `GET /Users/{id}` は 404 です。
3. 同じメールアドレス（または userName）で `POST /Users` が来ると、結び付けを復元して有効化します。

最後の有効な管理者を SCIM から無効化しようとした場合は 400 で拒否し、監査ログに拒否理由を残します。

SCIM で管理しているユーザーは、Atlas の管理画面でも次の項目を変更できません。IdP が正しい値を持つためです。

- 有効な結び付け（`scim_identities.deleted_at IS NULL`）があるユーザーの名前、メールアドレス、役職
- 無効から有効への変更（管理画面からの再有効化）。`deleted_at` の有無にかかわらず、SCIM の結び付けがあるユーザーが対象です。

無効化（緊急停止）は許可されます。無効化すると「IdP 側でも割り当てを外すか無効にしてください。IdP からの次の同期で有効に戻ることがあります」と表示します。ロールの変更、パスワードの再設定、2FA のリセット、写真の変更はこれまでどおり行えます。本人のプロフィール画面でも、有効な結び付けがある間は名前・メールアドレス・役職が読み取り専用になります。

SCIM の `DELETE` 後は `scim_identities.deleted_at` が設定されます。IdP で削除・割り当て解除されたユーザーは、SCIM が有効な間は管理画面から再有効化できません。IdP で割り当て直してください。一覧では「SCIM（IdP で削除済み）」と表示します。

`workspace_security.scim_enabled` が `false` のときは、上記の保護をすべて外します。管理画面と本人プロフィールで名前・メールアドレス・役職を編集でき、無効化したユーザーも有効化できます。一覧の印は「SCIM（停止中）」になります。

完全削除（`DELETE /api/admin/users/{id}`）はこれまでどおり許可されます。SCIM が有効で結び付けがあるユーザーの場合は、確認に「IdP からの次の同期で作り直されることがあります」と表示します。

## 同期の記録

SCIM のすべての要求（認証に失敗した 401、SCIM 無効時の拒否、パースエラー、成功した要求を含む）を `scim_request_log` に 1 行ずつ記録します。ただし 429（回数制限）の応答は記録しません。429 は IP ごとの回数制限（15 分間に 60 回）で抑制され、401 だけが上限まで記録されます。

記録する項目:

- `workspace_id`、`token_id`（トークンが分かる場合。削除時は NULL）、`idp`
- `method`、`path`（クエリ文字列は含めない）
- `filter`（先頭 200 文字。`Bearer ...` と `atlas_scim_...` は伏字）
- `status`（HTTP ステータス）、`scim_type`
- `detail`（エラー時のみ。先頭 300 文字。`Bearer ...` と `atlas_scim_...` は伏字）
- `user_id`（URL や作成結果から分かる場合。ユーザー削除時は NULL）
- `client_ip`（検証済みのクライアント IP が取れる場合）
- `created_at`

SCIM が無効なために拒否した要求も 401 ですが、トークンが正しく特定できる場合は `token_id` と `idp` を記録し、`detail` を `SCIM provisioning is disabled` にします。応答本文は従来どおり `invalid or expired bearer token` のままで、トークンの有効性を外部に知らせません。

記録しない項目:

- リクエスト本文とレスポンス本文
- `Authorization` ヘッダー
- トークンの平文・ハッシュ
- クエリ文字列全体（`filter` だけを別列に切り出します）

記録は SCIM の応答を作った後、ハンドラのトランザクションが接続を返した後に別クエリで行います。記録に失敗しても SCIM の応答は失敗させません。

保持期間は 30 日です。`server.js` の日次 janitor と `scripts/janitor.sh` が `scim_request_log` の古い行を削除します。`RETENTION_DAYS_SCIM_LOGS` で変更できます（既定 30）。

管理画面の「最近の同期」は新しい順に 50 件ずつ表示し、「失敗だけ表示」と「さらに読み込む」に対応します。「更新」を押すと、同期の記録とトークン一覧（最終使用日時を含む）をまとめて取り直します。自動の定期更新は行いません。管理者 API は次のとおりです。

```http
GET /api/admin/scim/logs?status=all&cursor=123
```

`status` は `all` / `success` / `failure`、`cursor` は前回の `next_cursor`（id）です。super 管理者だけが呼べます。

## トークンの発行・失効（管理者 API）

SCIM トークンの一覧・発行・失効は **super 管理者（`EffectiveRole.isSuper`）のみ** が実行できます。通常の管理者が呼び出すと 403 です。SCIM を有効化・無効化する `scim_enabled` の変更も super 管理者だけが行えます。ほかのセキュリティ設定は従来どおり `security.manage` で変更できます。

権限は `security.manage` が必要です。発行時の平文トークンはその応答で一度だけ返され、Atlas は SHA-256 ハッシュだけを保存します。平文をログやファイルに残さないでください。

```http
GET /api/admin/scim/tokens
POST /api/admin/scim/tokens
Content-Type: application/json

{"name": "Entra production", "idp": "entra"}
```

```json
{
  "id": 1,
  "name": "Entra production",
  "idp": "entra",
  "created_by": 1,
  "created_at": "...",
  "last_used_at": null,
  "revoked_at": null,
  "token": "atlas_scim_..."
}
```

```http
DELETE /api/admin/scim/tokens/{id}
```

失効は `revoked_at` の設定で行い、レコードは残ります。トークンの `last_used_at` は最大 1 分に 1 回だけ更新します。

SCIM の有効化・無効化は `PATCH /api/admin/security` の `scim_enabled` で行います。

```json
{"scim_enabled": true}
```

発行・失効・有効化・無効化は監査ログに記録されます。

## SAML JIT との関係

`workspace_security.scim_enabled` が `true` の間は、`saml_jit_provisioning` が `true` でも SAML の初回ログイン時にユーザーを自動作成しません。未登録のユーザーは `user_not_found` として扱われます。SCIM を無効に戻すと、SAML JIT は設定値どおりに動作します。

## Entra ID の設定

以下は執筆時点の Entra 管理センターの画面名です。画面名や項目名は変わることがあります。

1. Microsoft Entra 管理センターで「エンタープライズ アプリ」→「新しいアプリケーション」→「独自のアプリケーションを作成」を選びます（ギャラリーに Atlas が無い場合）。
2. アプリの「Provisioning」を開き、Provisioning Mode を **Automatic** にします。
3. **Tenant URL** に管理画面の「テナント URL」（`https://<ホスト>/scim/v2`）を設定します。
4. **Secret Token** に、Atlas で発行した `atlas_scim_...` を設定します。
5. 「Test Connection」を実行します。失敗する場合は HTTPS、URL の末尾、トークンの失効、SCIM の有効化を確認します。
6. 属性の対応を確認します。目安は次のとおりです。

| Entra の属性 | SCIM の属性 | 備考 |
| --- | --- | --- |
| `userPrincipalName` | `userName` | UPN。Atlas のメールアドレスとは別に保存されます。 |
| `mail` | `emails[type eq "work"].value` | Atlas の `users.email` になります。 |
| `givenName` | `name.givenName` | 名。 |
| `surname` | `name.familyName` | 姓。 |
| `jobTitle` | `title` | 役職。 |
| `Switch([IsSoftDeleted], "False", "True", ...)` | `active` | `false` で無効化、`true` で有効化。 |
| `objectId` | `externalId` | 任意。IdP 側の ID を保持します。 |

7. 「ユーザーとグループ」で対象をアプリに割り当てます。
8. Provisioning を開始します。Entra は短時間に多数のリクエストを送るため、成功したリクエストには回数制限をかけません。
9. 1 人だけ確認するときは、対象ユーザーの「Provision on demand」を実行します。Entra 側の結果と、Atlas の「最近の同期」に「ユーザー作成」または「ユーザー更新」の成功が出れば反映されています。

Entra は主に PATCH でユーザーを更新します。`userName`、`name`、`emails`、`active`、`title` などを送り、Atlas は未対応の拡張属性（部署など）を無視して成功します。

## Okta の設定

以下は執筆時点の Okta 管理画面の画面名です。画面名や項目名は変わることがあります。

1. Okta 管理画面で SCIM 2.0 対応のアプリ連携（App Integration）を作成します。
2. アプリの「Provisioning」→「Integration」を開き、Provisioning を有効にします。
3. **Base URL** に管理画面の「テナント URL」（`https://<ホスト>/scim/v2`）を設定します。
4. **Authentication Mode** を **HTTP Header** にし、**API Token** に Atlas で発行したトークンを設定します。
5. 「Create Users」「Update User Attributes」「Deactivate Users」を有効にします。Okta は主に PUT でユーザーを更新します。
6. 属性の対応を確認します。目安は次のとおりです。

| Okta の属性 | SCIM の属性 | 備考 |
| --- | --- | --- |
| `userName`（または `login`） | `userName` | Okta のログイン名。 |
| `email` | `emails[type eq "work"].value` | Atlas の `users.email` になります。 |
| `givenName` | `name.givenName` | 名。 |
| `familyName` | `name.familyName` | 姓。 |
| `title` | `title` | 役職。 |
| `active` | `active` | 無効化・有効化。 |
| `externalId` | `externalId` | 任意。 |

7. アプリに対象ユーザーを Assign し、同期を実行します。「最近の同期」で成功を確認します。

## トラブル時の確認点

- **401 が続く**: トークンが失効していないか、SCIM が有効か、URL が `https://<ホスト>/scim/v2` か、プロキシが `Authorization` を落としていないかを確認します。「最近の同期」の失敗行には `invalid or expired bearer token` などの内容が残ります。
- **403**: super 管理者でない可能性があります。トークン発行・失効、`scim_enabled` の変更、同期の記録の取得は super 管理者だけが行えます。
- **409 `uniqueness`**: 同じメールアドレス、`userName`、`externalId` が既に使われています。`filter=userName eq "..."` で既存ユーザーを探し、その `id` に結び付けてください。
- **400 `invalidFilter`**: 未対応の filter です。`userName eq "..."` など、上記の対応形式を使ってください。
- **400（最後の管理者）**: 最後の有効な管理者を SCIM から無効化しようとしています。別の管理者を有効にしてから実行してください。
- **同期されない**: IdP でアプリにユーザーを割り当てているか、Provisioning が開始されているか、属性マッピングに必須項目があるかを確認します。Entra は「Provision on demand」、Okta は対象ユーザーの Assign で 1 人だけ試せます。
- **HTTPS の注意が出る**: 管理画面のテナント URL が `http://` です。本番では `APP_ORIGIN` に HTTPS の公開 URL を設定してください。
- **記録が古い**: 同期の記録は 30 日で削除されます。それより前の調査が必要な場合は、監査ログ（`audit_log`）も確認してください。

## 既知の制限

- `bulk`、`sort`、`etag`、`changePassword` は非対応です。
- グループとロールのプロビジョニングは非対応です。SCIM からロールは変更しません。
- `name.givenName` / `name.familyName` は `scim_identities` に個別保存し、表示名は「given family」で連結します。Atlas の `users` には個別の姓名列はありません。
- 監査一覧では SCIM の操作を操作者 `SCIM` として表示します（`actor_id` は NULL）。
- 同期の記録にリクエスト本文・レスポンス本文は残りません。属性の値を調べる必要がある場合は、IdP 側のプロビジョニング ログを確認してください。
