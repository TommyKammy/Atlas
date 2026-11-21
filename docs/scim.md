# SCIM 2.0 ユーザープロビジョニング

Atlas は SCIM 2.0（RFC 7643 / 7644）のユーザー用エンドポイントを提供します。Entra ID と Okta からアカウントの作成・更新・無効化ができます。管理画面の SCIM 設定 UI は Phase 2 のため、現時点では下記の管理者 API でトークンを発行します。

> **HTTPS が必須です。** ベアラートークンを平文で送るため、Atlas と IdP の間は必ず HTTPS で接続してください。HTTP の接続先は本番・検証とも使用しないでください。

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

`name.formatted` / `displayName` / `name.givenName` / `name.familyName` は `scim_identities` に保存します。PATCH で `name.familyName` だけを送っても、保存済みの `givenName` を残したまま表示名を更新します。表示名の優先順位は `name.formatted` → `displayName` → 「givenName familyName」です。
| `title` | `users.title` | `remove title` は空文字にします。 |
| `active` | `users.deactivated_at` | `false` で無効化、`true` で有効化。真偽値と `"True"` / `"False"` の文字列を受理。 |
| `externalId` | `scim_identities.external_id` | IdP 側の ID。Atlas の `id` とは別に保存。 |
| `id` | `users.id` | 読み取り専用。文字列で返します。 |

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

## 削除の扱い

`DELETE /Users/{id}` は 204 を返しますが、Atlas のアカウントを完全削除しません。

1. ユーザーを無効化（`deactivated_at` を設定）し、そのユーザーのセッションを削除します。
2. `scim_identities.deleted_at` を設定します。以後 `GET /Users/{id}` は 404 です。
3. 同じメールアドレス（または userName）で `POST /Users` が来ると、結び付けを復元して有効化します。

最後の有効な管理者を SCIM から無効化しようとした場合は 400 で拒否し、監査ログに拒否理由を残します。

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

1. Entra 管理センターで Enterprise Application を作成し、Provisioning を開きます。
2. Provisioning Mode を Automatic にします。
3. Tenant URL に `https://<ホスト>/scim/v2` を設定します。
4. Secret Token に、Atlas で発行した `atlas_scim_...` を設定します。
5. 接続テストを実行し、必要に応じて属性マッピングを確認します。Entra は `externalId`、`userName`、`name`、`emails`、`active`、`title` などを送ります。Atlas は未対応の拡張属性（部署など）を無視して成功します。
6. 対象ユーザーをアプリに割り当てて Provisioning を開始します。

Entra は短時間に多数のリクエストを送るため、成功したリクエストには回数制限をかけません。

## Okta の設定

1. Okta 管理画面で SCIM 2.0 対応のアプリ連携を作成します。
2. Provisioning を有効にし、Authentication Mode を **HTTP Header** にします。
3. Base URL に `https://<ホスト>/scim/v2` を設定します。
4. API Token（Secret）に Atlas で発行したトークンを設定します。
5. Import / Assign / Update / Deactivate の各操作を有効にします。Okta は主に PUT でユーザーを更新します。

## 既知の制限

- `bulk`、`sort`、`etag`、`changePassword` は非対応です。
- グループとロールのプロビジョニングは非対応です。SCIM からロールは変更しません。
- `name.givenName` / `name.familyName` は Atlas に個別保存せず、連結した表示名だけを保持します。
- 監査一覧では SCIM の操作を操作者 `SCIM` として表示します（`actor_id` は NULL）。
