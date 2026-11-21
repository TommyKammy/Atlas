# SCIM Phase 3 実テナント接続チェックリスト

Phase 3 では、Entra ID と Okta の実テナントから Atlas の SCIM 2.0 エンドポイントへ接続し、ユーザーの作成・更新・無効化・再有効化が期待どおりに動くことを確認します。この文書は、実テナントに接続する前の事前準備、3-1（Entra ID）、3-2（Okta）、3-3（通し確認）の手順とチェック項目、結果の記録欄をまとめたものです。

Atlas 本体の実装や DB マイグレーションはこの確認では変更しません。チェッカーが実装の不具合を見つけた場合は、その場で直さず、再現手順と期待値・実際の応答を記録してください。

> **HTTPS が必須です。** ベアラートークンを平文で送るため、Atlas と IdP の間は必ず HTTPS で接続します。HTTP の接続先は本番・検証とも使用しないでください。

## 対象

| 項目 | 内容 |
| --- | --- |
| 3-1 | Entra ID（Microsoft Entra 管理センター）からのプロビジョニング |
| 3-2 | Okta からの SCIM 2.0 プロビジョニング |
| 3-3 | IdP での作成から SAML サインイン、無効化、セッション失効、再有効化までの通し確認 |

実テナントと本番サーバーへの接続は、この文書を読んだ実施者が行います。リポジトリ内の自動テストは、ローカルの使い捨て E2E スタックだけを対象にします。

## 事前条件

| 項目 | 必要な状態 | 確認方法 |
| --- | --- | --- |
| DNS | `atlas.tmcast.net` が Atlas の公開 IP に解決する | `dig atlas.tmcast.net` など |
| TLS | `atlas.tmcast.net` に公的に信頼された証明書が設定されている。自己署名・期限切れ・中途証明書の欠落がない | ブラウザで警告が出ないこと。`openssl s_client -connect atlas.tmcast.net:443 -servername atlas.tmcast.net` でチェーンを確認 |
| `APP_ORIGIN` | `https://atlas.tmcast.net` を設定する | 管理画面の「IdP に設定するテナント URL」が `https://atlas.tmcast.net/scim/v2` になること |
| 管理者 | super 管理者（`EffectiveRole.isSuper`）で操作する | SCIM の有効化、トークン発行、同期の記録の取得ができること |
| SCIM | ワークスペースで SCIM が有効になっている | 管理画面の「セキュリティ」→「プロビジョニング（SCIM）」で「有効」 |
| トークン | Entra ID 用と Okta 用を別々に発行する。平文はその場で控え、リポジトリ・チャット・ログに残さない | 管理画面の「トークンを発行」。発行時の平文は一度だけ表示される |
| ネットワーク | IdP から Atlas の 443 番へ到達できる。WAF・プロキシが `Authorization` を落とさず、SCIM の GET/POST/PUT/PATCH/DELETE を許可する | IdP の接続テストと Atlas の「最近の同期」 |
| テストユーザー | IdP 側に専用のテストユーザーを用意し、Atlas のアプリに割り当てる。最後の有効な管理者は使わない | IdP のアプリ割り当て画面 |
| データ | 可能なら検証専用のワークスペースを使う。本番で実施する場合は、テストユーザーが無効化状態で残ることに同意を得る | 実施責任者の承認 |
| 復旧 | 元の SCIM 有効・無効の状態と、SAML JIT の設定を記録しておく | 管理画面の設定値 |

SCIM を有効にすると SAML の自動作成（JIT）は停止しますが、既存のアカウントとセッションは残ります。確認が終わったら、記録した元の状態に戻してください。

### IdP 側の仕様について

Entra ID と Okta の同期間隔、再試行、初回同期の所要時間は、プランやテナント設定によって変わります。執筆時点の公式ドキュメントでは確認していないため、この文書では具体的な値や保証を記載しません。確認が必要な場合は、各社の公式ドキュメントを参照してください。

## 適合性チェッカー

`scripts/scim-conformance.mjs` は、Entra ID と Okta が通常送る SCIM リクエストを再現し、Atlas の応答を確認する Node 標準のみのチェッカーです。依存パッケージは追加しません。

### 使い方

トークンは環境変数 `SCIM_TOKEN` からのみ読みます。引数では受け取りません。

```bash
# シェルの履歴に平文を残したくない場合は read -s を使う
read -s SCIM_TOKEN
export SCIM_TOKEN

# Entra ID の流れ
node scripts/scim-conformance.mjs --base https://atlas.tmcast.net --profile entra

# Okta の流れ
node scripts/scim-conformance.mjs --base https://atlas.tmcast.net --profile okta

# 両方
node scripts/scim-conformance.mjs --base https://atlas.tmcast.net --profile all
```

| オプション | 内容 |
| --- | --- |
| `--base <url>` | `https://atlas.tmcast.net` または `https://atlas.tmcast.net/scim/v2`。クエリ文字列と fragment は指定できません |
| `--profile entra\|okta\|all` | 実行する流れ。既定は `all` |
| `--prefix <text>` | テストユーザーの接頭辞。既定は `scim-conformance-<ランダム>`。英数字で始まり、英数字・`.`・`_`・`-` の 1〜40 文字 |
| `--allow-http` | `http://` を許可する。`localhost`、`127.0.0.1`、`[::1]` のときだけ有効。本番では使わない |
| `-h`, `--help` | 使い方を表示する |

終了コードは、全チェック成功が 0、チェック失敗が 1、引数・設定の誤りが 2 です。出力はチェックごとの合否表と、profile ごとの成功・失敗件数です。失敗したチェックは期待値と実際の応答を表示します。トークンは出力・例外メッセージに含めません。

`--profile all` は 1 つのトークンで両方の流れを実行します。IdP ごとのトークンを確認する場合は、Entra ID 用のトークンで `--profile entra`、Okta 用のトークンで `--profile okta` を個別に実行してください。

### チェッカーが作るユーザーと後片付け

チェッカーは `--prefix` を付けた userName とメールアドレスでテストユーザーを作ります。メールアドレスには予約ドメイン（`example.com`、`example.org`）を使います。

| profile | 作るユーザー | 最後の状態 |
| --- | --- | --- |
| Entra | `<prefix>-entra@example.org`（UPN）、`<prefix>-entra@example.com`（work メール） | DELETE で無効化し、`scim_identities.deleted_at` を設定。チェッカーは同じ userName で POST して同じ id が復元されることも確認し、最後にもう一度 DELETE する |
| Okta | `<prefix>-okta@example.com` | DELETE は送らず、最後の PUT `active=false` で無効化する。SCIM の結び付けは残る |

Atlas は SCIM の DELETE でアカウントを完全削除しません。チェッカーを本番に対して実行すると、prefix 付きのテストユーザーが無効化状態でメンバー一覧に残ります。パスワードは設定されず、IdP の割り当ても外れるためサインインはできませんが、不要になったら管理画面のメンバー管理から完全削除してください。SCIM が有効な間は管理画面から再有効化できませんが、完全削除はできます。CLI は実行時に使った prefix と、Entra の UPN / Okta の userName を出力するので、その prefix でメンバー一覧を探して削除してください。

同じ prefix を再利用すると、Okta の無効化済みユーザーが残っているため POST が 409 `uniqueness` になることがあります。既定のランダム prefix を使うか、実行ごとに新しい prefix を指定してください。

チェッカーはワークスペースの SCIM 設定とユーザーを共有します。`scim.spec.ts` などの SCIM テストと同じ環境で同時に実行しないでください。

> **DELETE 後の GET について。** `docs/scim.md` の「削除・無効化の扱い」では、`DELETE /Users/{id}` の後に `GET /Users/{id}` は 404 です。チェッカーはこの仕様に合わせて 404 を期待し、アカウントが完全削除されていないことは「同じ userName で POST すると同じ id が復元される」ことで確認します。

### チェック項目（共通）

| # | チェック | 期待 |
| --- | --- | --- |
| C-1 | `ServiceProviderConfig` | 200、`application/scim+json`、PATCH と filter が有効、bulk/sort/etag/changePassword が無効、`oauthbearertoken` |
| C-2 | `ResourceTypes` | 200、ListResponse、`User` リソース、endpoint `/Users`、core User schema |
| C-3 | `Schemas` | 200、ListResponse、core User schema、`userName`・`name`・`displayName`・`emails`・`title`・`externalId`・`active`・`id`・`meta` を含む |
| C-4 | `ListResponse` | 200、`schemas`、`totalResults`、`startIndex=1`、`itemsPerPage` が `Resources` の件数と一致 |
| C-5 | トークンなし | 401、`application/scim+json`、Error schema、`status` が文字列 `"401"` |
| C-6 | 不正トークン | 401、`application/scim+json`、Error schema、`status` が文字列 `"401"` |

### チェック項目（Entra ID）

| # | チェック | 期待 |
| --- | --- | --- |
| E-1 | `filter=userName eq "..."`（作成前） | 200、ListResponse、`totalResults=0`、`startIndex=1`、`itemsPerPage=0`、`Resources=[]` |
| E-2 | POST 作成 | 201、UPN 形式の `userName`、work メール、`externalId`、`name`、`active=true`、未対応の enterprise 拡張付きでも成功 |
| E-3 | GET `/Users/{id}` | 200、作成した値と一致 |
| E-4 | 同じ POST の繰り返し | 409、`scimType=uniqueness` |
| E-5 | PATCH `op: "Replace"`, `path: "active"`, `value: "False"` | 200、`active=false` |
| E-6 | path なしの PATCH（name・displayName・title・enterprise 拡張） | 200、対応属性だけ更新、未対応属性は無視、`active` は変わらない |
| E-7 | PATCH `emails[type eq "work"].value` | 200、work メールだけ更新、`userName` は UPN のまま |
| E-8 | 未対応の enterprise 属性の PATCH | 200、対応属性は変わらない |
| E-9 | `filter=externalId eq "..."` | 200、`totalResults=1`、対象の id |
| E-10 | 存在しない id の GET | 404、`application/scim+json`、Error schema、`status` が文字列 `"404"` |
| E-11 | DELETE | 204、その後 GET は 404。完全削除ではない |
| E-12 | DELETE 後の同じ userName の POST | 201、同じ id が復元され `active=true` |
| E-13 | 最後の DELETE | 204、その後 GET は 404。テストユーザーは無効化状態で残る |

### チェック項目（Okta）

Okta の送り方は連携の種類で異なります。OIN の新しい連携はプロフィール更新を PUT、有効化・無効化を PATCH で送り、AIW（App Integration Wizard）で作るカスタム連携は有効化・無効化を含むすべての更新を PUT で送ります（Okta 公式 SCIM 2.0 ガイド: https://developer.okta.com/docs/api/openapi/okta-scim/guides/scim-20/ 、2026-11-21 確認）。Okta はユーザーに DELETE を送りません。チェッカーは両方の送り方を確認します。

| # | チェック | 期待 |
| --- | --- | --- |
| O-1 | `filter=userName eq "..."&startIndex=1&count=100`（作成前） | 200、ListResponse、`totalResults=0`、`startIndex=1`、`itemsPerPage=0`、`Resources=[]` |
| O-2 | POST 作成 | 201、`userName`、work メール、`externalId`、`name`、`active=true` |
| O-3 | GET `/Users/{id}` | 200、作成した値と一致 |
| O-4 | (AIW PUT) 属性更新 | 200、name・title が更新され `active=true` |
| O-5 | (AIW PUT) `active=false` | 200、`active=false` |
| O-6 | (AIW PUT) `active` を省略 | 200、無効化されたまま。`active` は変わらない |
| O-7 | (AIW PUT) `active=true` | 200、`active=true`。SCIM からは再有効化できる |
| O-8 | (OIN PATCH) `active=false` | 200、`active=false`。その後の GET も `active=false` |
| O-9 | (OIN PATCH) `active=true` | 200、`active=true`。その後の GET も `active=true` |
| O-10 | `filter=externalId eq "..."` | 200、`totalResults=1`、対象の id |
| O-11 | (AIW PUT) 最後の `active=false` | 200、`active=false`。DELETE は送らない |

## 3-1 Entra ID

### 手順

1. Microsoft Entra 管理センターで「エンタープライズ アプリ」→「新しいアプリケーション」→「独自のアプリケーションを作成」を選びます（ギャラリーに Atlas が無い場合）。
2. アプリの「Provisioning」を開き、Provisioning Mode を **Automatic** にします。
3. **Tenant URL** に `https://atlas.tmcast.net/scim/v2`、**Secret Token** に Entra ID 用の Atlas SCIM トークンを設定します。
4. 「Test Connection」を実行します。失敗する場合は、TLS 証明書、URL の末尾、トークンの失効、SCIM の有効化を確認します。
5. 属性の対応を確認します。目安は次のとおりです。

   | Entra の属性 | SCIM の属性 | 備考 |
   | --- | --- | --- |
   | `userPrincipalName` | `userName` | UPN。Atlas のメールアドレスとは別に保存されます。 |
   | `mail` | `emails[type eq "work"].value` | Atlas の `users.email` になります。 |
   | `givenName` | `name.givenName` | 名。 |
   | `surname` | `name.familyName` | 姓。 |
   | `jobTitle` | `title` | 役職。 |
   | `Switch([IsSoftDeleted], "False", "True", ...)` | `active` | `false` で無効化、`true` で有効化。 |
   | `objectId` | `externalId` | 任意。IdP 側の ID を保持します。 |

6. 「ユーザーとグループ」で専用のテストユーザーをアプリに割り当てます。
7. Provisioning を開始するか、対象ユーザーの「Provision on demand」を実行します。
8. Atlas の「最近の同期」で成功を確認します。

### チェック項目

| # | 確認項目 | 期待 | 結果 |
| --- | --- | --- | --- |
| 3-1-1 | Test Connection | 成功する | |
| 3-1-2 | 初回プロビジョニング | Atlas にユーザーが作成される。`userName` は UPN、work メールは `mail`、`active=true` | |
| 3-1-3 | 属性更新 | IdP で name・jobTitle を変更すると、次の同期で Atlas に反映される（主に PATCH） | |
| 3-1-4 | 無効化 | IdP でユーザーを無効化すると `active=false` になり、既存の Atlas セッションが使えなくなる | |
| 3-1-5 | 再有効化 | IdP で有効に戻すと `active=true` になり、サインインできる | |
| 3-1-6 | 割り当て解除・削除 | DELETE が 204 で成功し、Atlas では無効化される。アカウントは完全削除されない | |
| 3-1-7 | 既存ユーザーとの結び付け | 同じメールアドレスの既存 Atlas ユーザーがいる場合、新規作成ではなく既存ユーザーに結び付く | |
| 3-1-8 | UPN と work メールの分離 | UPN を変更しても work メールが勝手に変わらない（work メール由来の場合） | |
| 3-1-9 | 未対応属性 | 部署などの enterprise 拡張が送られてもエラーにならない | |
| 3-1-10 | 同期の記録 | 成功した要求が「最近の同期」に残り、401・403・409 が繰り返されない | |
| 3-1-11 | 最後の管理者 | 最後の有効な管理者を無効化しようとすると 400 で拒否される（テストユーザーは管理者にしない） | |

## 3-2 Okta

### 手順

1. Okta 管理画面で SCIM 2.0 対応のアプリ連携（App Integration）を作成します。
2. アプリの「Provisioning」→「Integration」を開き、Provisioning を有効にします。
3. **Base URL** に `https://atlas.tmcast.net/scim/v2`、**Authentication Mode** を **HTTP Header**、**API Token** に Okta 用の Atlas SCIM トークンを設定します。
4. 「Create Users」「Update User Attributes」「Deactivate Users」を有効にします。Okta は連携の種類によって PUT と PATCH を使い分けます。詳細は次の「OIN と AIW の送り方の違い」を参照してください。
5. 属性の対応を確認します。目安は次のとおりです。

   | Okta の属性 | SCIM の属性 | 備考 |
   | --- | --- | --- |
   | `userName`（または `login`） | `userName` | Okta のログイン名。 |
   | `email` | `emails[type eq "work"].value` | Atlas の `users.email` になります。 |
   | `givenName` | `name.givenName` | 名。 |
   | `familyName` | `name.familyName` | 姓。 |
   | `title` | `title` | 役職。 |
   | `active` | `active` | 無効化・有効化。 |
   | `externalId` | `externalId` | 任意。 |

6. 専用のテストユーザーをアプリに Assign し、同期を実行します。
7. Atlas の「最近の同期」で成功を確認します。

### OIN と AIW の送り方の違い

Okta の公式 SCIM 2.0 ガイド（https://developer.okta.com/docs/api/openapi/okta-scim/guides/scim-20/ 、2026-11-21 確認）では、OIN の新しい連携はプロフィール更新を PUT、有効化・無効化を PATCH で送り、AIW で作るカスタム連携は有効化・無効化を含むすべての更新を PUT で送るとされています。Okta はユーザーに DELETE を送りません。

Atlas は通常 AIW のカスタム連携として登録する想定です。実機確認では、Okta の Deactivate が Atlas に PUT として届き、Atlas の「最近の同期」に PUT の成功が記録されることを確認してください。チェッカーは AIW の PUT と OIN の PATCH の両方を確認します。

### チェック項目

| # | 確認項目 | 期待 | 結果 |
| --- | --- | --- | --- |
| 3-2-1 | 接続テスト | 成功する | |
| 3-2-2 | 初回プロビジョニング | Atlas にユーザーが作成される。`userName` はログイン名、work メールは `email`、`active=true` | |
| 3-2-3 | 属性更新 | IdP で name・title を変更すると、次の同期で Atlas に反映される（主に PUT） | |
| 3-2-4 | 無効化 | IdP で Deactivate すると `active=false` になり、既存の Atlas セッションが使えなくなる | |
| 3-2-5 | 再有効化 | IdP で Reactivate すると `active=true` になり、サインインできる | |
| 3-2-6 | (AIW PUT) `active` 省略 | 無効化されたまま。勝手に有効化されない | |
| 3-2-7 | 既存ユーザーとの結び付け | 同じメールアドレスの既存 Atlas ユーザーがいる場合、新規作成ではなく既存ユーザーに結び付く | |
| 3-2-8 | 同期の記録 | 成功した要求が「最近の同期」に残り、401・403・409 が繰り返されない | |
| 3-2-9 | 最後の管理者 | 最後の有効な管理者を無効化しようとすると 400 で拒否される（テストユーザーは管理者にしない） | |
| 3-2-10 | DELETE を送らない | Okta の通常の Deactivate は PUT または PATCH で行われ、DELETE は送られない | |
| 3-2-11 | AIW PUT の無効化 | AIW のカスタム連携の場合、Okta の Deactivate が Atlas に PUT で届き、「最近の同期」に PUT の成功が残る | |

## 3-3 通し確認

3-1 と 3-2 の後、1 人のテストユーザーで作成から無効化・再有効化までを通します。Entra ID と Okta のどちらか一方だけでなく、両方で実施します。

### 手順

1. IdP に専用のテストユーザーを作り、Atlas のアプリに割り当てます。テストユーザーは管理者にしません。
2. プロビジョニングを実行し、Atlas にユーザーが作成されることを確認します。
3. テストユーザーで SAML サインインし、Atlas の画面が開くことを確認します。
4. IdP で名前や役職を変更し、同期後に Atlas の表示が変わることを確認します。
5. IdP でテストユーザーを無効化し、同期後に Atlas の `active` が `false` になり、手順 3 の既存セッションが使えなくなることを確認します。画面を再読み込みすると `/login` に戻ります。
6. IdP でテストユーザーを有効に戻し、同期後に再度 SAML サインインできることを確認します。
7. テストユーザーの割り当てを外すか削除し、同期後に Atlas で無効化されることを確認します。Atlas はアカウントを完全削除しません。
8. 必要に応じて SCIM を無効化し、SAML JIT が元の設定どおりに戻ることを確認します。確認後は元の状態に戻します。

> **既存セッションの失効は自動テストで確認済みです。** `tests/browser/scim.spec.ts` の「create, filter, get, Entra PATCH deactivation and session revocation」が、SCIM の PATCH `active=false` 後に既存セッションが `/api/users` へアクセスできず、画面遷移が `/login` に戻ることを確認しています。Phase 3 の通し確認では、実テナントからの同期でも同じことを手動で確認します。

### チェック項目

| # | 確認項目 | 期待 | 結果 |
| --- | --- | --- | --- |
| 3-3-1 | 作成 | IdP の割り当て後に Atlas へユーザーが作成される | |
| 3-3-2 | SAML サインイン | 作成されたユーザーでサインインできる。ロールは既定（通常はメンバー） | |
| 3-3-3 | 属性更新 | IdP の変更が Atlas に反映される | |
| 3-3-4 | 無効化 | `active=false` になり、既存セッションが失効する | |
| 3-3-5 | 再有効化 | `active=true` になり、再度サインインできる | |
| 3-3-6 | 割り当て解除・削除 | Atlas では無効化され、完全削除されない。管理画面からは再有効化できない | |
| 3-3-7 | 管理画面の保護 | SCIM 管理ユーザーの名前・メールアドレス・役職が管理画面で編集できない | |
| 3-3-8 | 同期の記録 | 「最近の同期」に成功が残り、失敗が繰り返されない | |
| 3-3-9 | 監査ログ | SCIM の作成・更新・無効化が監査ログに残る | |
| 3-3-10 | 後片付け | テストユーザーを完全削除し、トークンを失効し、SCIM と SAML の設定を元に戻す | |

## 結果の記録

実施ごとに次の情報を残してください。トークンの平文は記録しません。

| 項目 | 値 |
| --- | --- |
| 実施日 | |
| 環境 | 本番 / 検証 |
| Atlas の commit | |
| 実施者 | |
| IdP テナント | |
| 使用したトークン名（平文は書かない） | |
| 実施前の SCIM 有効状態 | |
| 実施前の SAML JIT 設定 | |

### チェッカーの結果

| profile | 実行コマンド | 成功件数 | 失敗件数 | 失敗したチェック | 証跡 |
| --- | --- | --- | --- | --- | --- |
| entra | `node scripts/scim-conformance.mjs --base https://atlas.tmcast.net --profile entra` | | | | |
| okta | `node scripts/scim-conformance.mjs --base https://atlas.tmcast.net --profile okta` | | | | |

### 3-1 Entra ID の結果

| # | 結果（OK / NG / 未実施） | 証跡（「最近の同期」の時刻、監査ログ、画面） | メモ |
| --- | --- | --- | --- |
| 3-1-1 | | | |
| 3-1-2 | | | |
| 3-1-3 | | | |
| 3-1-4 | | | |
| 3-1-5 | | | |
| 3-1-6 | | | |
| 3-1-7 | | | |
| 3-1-8 | | | |
| 3-1-9 | | | |
| 3-1-10 | | | |
| 3-1-11 | | | |

### 3-2 Okta の結果

| # | 結果（OK / NG / 未実施） | 証跡（「最近の同期」の時刻、監査ログ、画面） | メモ |
| --- | --- | --- | --- |
| 3-2-1 | | | |
| 3-2-2 | | | |
| 3-2-3 | | | |
| 3-2-4 | | | |
| 3-2-5 | | | |
| 3-2-6 | | | |
| 3-2-7 | | | |
| 3-2-8 | | | |
| 3-2-9 | | | |
| 3-2-10 | | | |
| 3-2-11 | | | |

### 3-3 通し確認の結果

| # | 結果（OK / NG / 未実施） | 証跡 | メモ |
| --- | --- | --- | --- |
| 3-3-1 | | | |
| 3-3-2 | | | |
| 3-3-3 | | | |
| 3-3-4 | | | |
| 3-3-5 | | | |
| 3-3-6 | | | |
| 3-3-7 | | | |
| 3-3-8 | | | |
| 3-3-9 | | | |
| 3-3-10 | | | |

### 後片付けの記録

| 項目 | 結果 |
| --- | --- |
| テストユーザーの完全削除 | |
| SCIM トークンの失効 | |
| SCIM の有効状態の復元 | |
| SAML JIT 設定の復元 | |
| 残ったテストユーザー・記録の確認 | |
| 承認者・完了日 | |

## トラブル時の確認点

- **401 が続く**: トークンが失効していないか、SCIM が有効か、URL が `https://atlas.tmcast.net/scim/v2` か、プロキシが `Authorization` を落としていないかを確認します。「最近の同期」の失敗行に `invalid or expired bearer token` などが残ります。認証の失敗はクライアント IP 単位で 15 分間に 60 回に制限されます。
- **TLS で失敗する**: 公的に信頼された証明書か、中途証明書が欠けていないか、`APP_ORIGIN` が `https://atlas.tmcast.net` かを確認します。
- **409 `uniqueness`**: 同じメールアドレス、`userName`、`externalId` が既に使われています。チェッカーの prefix を新しくするか、`filter=userName eq "..."` で既存ユーザーを探して結び付けてください。
- **DELETE 後に GET が 404 になる**: 仕様どおりです。Atlas は SCIM の DELETE で完全削除せず、無効化と `scim_identities.deleted_at` の設定を行います。
- **チェッカーが 2 で終了する**: 引数か設定の誤りです。`--help` で使い方を確認してください。`http://` は `--allow-http` と loopback ホストのときだけ使えます。
- **チェッカーが 1 で終了する**: 失敗したチェックの「expected」と「actual」を記録し、Atlas の「最近の同期」と監査ログを確認します。実装の不具合が疑われる場合は、チェッカーを直さずに再現手順を残してください。
- **同期されない**: IdP でアプリにユーザーを割り当てているか、Provisioning が開始されているか、属性マッピングに必須項目があるかを確認します。
