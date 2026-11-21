# 本番デプロイ（Next.js 単体 / NGINX 前段）

Atlas の本番構成は 2 つを正式にサポートします。

1. **Next.js 単体**: `server.js`（カスタムサーバー）を直接動かし、TLS は別のロードバランサーやリバースプロキシで終端する。
2. **NGINX 前段**: NGINX で TLS と HTTP→HTTPS リダイレクトを終端し、Atlas をその後段に置く。

NGINX は stable **1.30.7** と mainline **1.31.9** の両方で、`deploy/nginx/` の同じ設定が動くことを CI で確認しています。どちらも 2026-11-18 リリースです（nginx.org で 2026-11-21 に確認）。

> **本番サーバーを操作する前に。** この文書のコマンドは Ubuntu を前提にした例です。実行前に `nginx -T`、`systemctl status nginx`、証明書のパスを確認してください。バージョンやパッケージの内部構成は更新されるため、この文書で「要確認」と書いた項目は実機で確認してください。

## 構成の選び方

| 構成 | 向いている場面 | TLS | クライアント IP |
| --- | --- | --- | --- |
| Next.js 単体 | 既に ALB / Cloudflare / 別のリバースプロキシがある。アプリだけをコンテナで動かす。 | 前段で終端する。Atlas 自身は HTTP のみ。 | 前段が付ける `X-Forwarded-For` を使うなら `ATLAS_TRUSTED_PROXIES` を設定する。使わないなら空。 |
| NGINX 前段 | 1 台の Ubuntu で TLS・リダイレクト・アップロード上限まで完結させたい。 | NGINX が終端する。`deploy/nginx/atlas.conf` を使う。 | NGINX のアドレス（同一ホストなら `127.0.0.1/32`）を `ATLAS_TRUSTED_PROXIES` に設定する。 |

どちらの構成でも、Atlas は **HTTP/1.1 の `server.js`** として動きます。TLS 証明書は Atlas では扱いません。

## 必須の環境変数

| 変数 | 例 | 説明 |
| --- | --- | --- |
| `NODE_ENV` | `production` | 本番では必須。 |
| `APP_PORT` | `3000` | `server.js` の待受ポート。NGINX の upstream と一致させる。 |
| `APP_ORIGIN` | `https://atlas.example.com` | ブラウザから見た公開オリジン。SCIM の `meta.location`、SAML、招待 URL がこの値を使う。`https://` ならセッション Cookie に `Secure` が付く。末尾スラッシュなし。 |
| `WS_ALLOWED_ORIGINS` | `https://atlas.example.com` | `/api/ws` が受け付ける `Origin` のカンマ区切り。未設定なら `APP_ORIGIN`、`APP_URL`、最後にループバック HTTP にフォールバックする。 |
| `ATLAS_TRUSTED_PROXIES` | `127.0.0.1/32` または `10.0.5.0/24` | 接続元がこの一覧に含まれるときだけ `X-Forwarded-For` を信頼する。後述。 |
| `ATLAS_KEEPALIVE_TIMEOUT_MS` | `65000` | Node の `keepAliveTimeout`。既定 65000。NGINX の upstream `keepalive_timeout`（60s）より長くする。 |
| `UPLOAD_DIR` | `/app/uploads` | 添付ファイルの保存先。DB ごとに別の永続ボリュームを用意し、全レプリカで同じパス・同じファイル所有者にする。 |
| `DATABASE_URL` | `postgres://...` | PostgreSQL。マイグレーションを先に実行する。 |
| `REDIS_URL` | `redis://...` | ライブ更新の fan-out。 |
| `MFA_ENCRYPTION_KEY_ID` / `MFA_ENCRYPTION_KEYS` | — | TOTP 秘密の暗号化。既存の運用手順に従う。 |
| `AUTOMATION_WORKER_TOKEN` | 64 桁の hex | 自動化ワーカー用。 |
| `SESSION_COOKIE_SECURE` | `1` | `APP_ORIGIN` が `https://` なら自動で有効。明示したい場合だけ設定する。 |

`APP_ORIGIN` と `WS_ALLOWED_ORIGINS` は、NGINX のテストでも NGINX 経由の URL を設定しています。`APP_ORIGIN` を設定しないと、SCIM の URL が `X-Forwarded-Host` / `Host` から組み立てられ、プロキシの設定ミスがそのまま IdP に渡ります。

### `ATLAS_TRUSTED_PROXIES` の意味

値は IP または CIDR のカンマ区切りです。IPv4、IPv6、`::ffff:192.0.2.1` 形式を受け付けます。空白は無視します。

- **未設定・空**: これまでと同じく、TCP 接続元（`socket.remoteAddress`）をクライアント IP にする。`X-Forwarded-For` は一切見ない。
- **接続元が一覧に含まれない**: `X-Forwarded-For` を無視し、接続元を使う。クライアントが勝手に付けたヘッダーでは識別子を変えられない。
- **接続元が一覧に含まれる**: `X-Forwarded-For` を**右から**走査し、信頼するプロキシではない最初のアドレスをクライアント IP にする。右端は NGINX が `$proxy_add_x_forwarded_for` で付けた実際の接続元なので、その左にあるクライアント偽装値は選ばれない。多段プロキシでは信頼するホップを読み飛ばす。
- **全ホップが信頼済み**: 左端をクライアント IP にする（元のクライアント）。
- **解釈できないホップ**: それ以上左を信頼せず、接続元にフォールバックする（安全側）。
- **解釈できない設定値**: そのエントリは信頼しない。起動時に `ATLAS_TRUSTED_PROXIES ignored invalid entry: ...` を `console.error` に出す。有効なエントリが 1 つもなければ「どのプロキシも信頼しない」状態で起動する。

Atlas は選んだ IP を HMAC で署名した内部ヘッダー（`x-atlas-auth-client-ip` / `x-atlas-auth-client-proof`）に載せ、`lib/auth-client-ip.mjs` の検証を通った値だけをログイン・SCIM のレート制限に使います。クライアントがこのヘッダーを直接送っても、HMAC が一致しないため無視されます。

**設定例**

- NGINX と Atlas が同じホスト: `ATLAS_TRUSTED_PROXIES=127.0.0.1/32`。NGINX が `::1` で接続する場合は `::1/128` も追加する。
- Docker / Kubernetes で NGINX だけが別ネットワーク: NGINX が属するサブネット（例 `10.0.5.0/24`）。クライアント用のサブネットや `0.0.0.0/0` は信頼しない。
- 多段プロキシ: 右側（Atlas に近い側）から順に、すべてのプロキシのアドレスを列挙する。例 `10.0.5.0/24,10.0.6.0/24`。

`ATLAS_TRUSTED_PROXIES` を設定し忘れると、NGINX の後ろでは全クライアントが NGINX の IP で数えられ、1 人の攻撃で全員がログイン制限に巻き込まれます。逆に広すぎる値を設定すると、そのネットワーク内の任意のホストが他人の IP を名乗れます。**NGINX のアドレスだけ**を設定してください。

### Keep-alive と 502

NGINX 1.29.7 以降は upstream の keepalive が既定で有効で、`proxy_http_version` の既定も 1.1 です。NGINX の upstream `keepalive_timeout` は 60 秒なので、Node 側が 5 秒（Node の既定）で閉じると、NGINX が閉じかけの接続を再利用して 502 を返すことがあります。

`server.js` は `ATLAS_KEEPALIVE_TIMEOUT_MS`（既定 65000）を `server.keepAliveTimeout` に、その 5 秒上を `server.headersTimeout` に設定します。NGINX 側は `keepalive_timeout 60s;` です。**`ATLAS_KEEPALIVE_TIMEOUT_MS` を 60000 以下にしないでください。** 不正な値（数値でない、0 以下、大きすぎる）は既定の 65000 に戻ります。

## Next.js 単体で動かす

1. `npm ci && npm run build`（または Docker イメージ）を用意する。
2. `NODE_ENV=production APP_PORT=3000 APP_ORIGIN=https://atlas.example.com WS_ALLOWED_ORIGINS=https://atlas.example.com node server.js` で起動する。
3. TLS は前段のロードバランサーで終端する。Atlas は HTTP を話す。
4. HSTS は **Atlas では付きません**。TLS を終端するロードバランサー側で `Strict-Transport-Security: max-age=31536000; includeSubDomains` を付ける。
5. NGINX を置かない単体構成では `ATLAS_TRUSTED_PROXIES` は空にする。別途ロードバランサーが `X-Forwarded-For` を付ける場合だけ、その前段のアドレスを設定する。付けない、またはアドレスを固定できない場合も空のままにする（接続元を使う）。
6. `UPLOAD_DIR` を永続化する。単一プロセスで動かす場合は `server.js` のコメントどおり 1 インスタンスにする。

## NGINX 前段で動かす（Ubuntu）

### 1. nginx.org のパッケージを入れる

Ubuntu の標準パッケージ（例: 1.28.3）ではなく、nginx.org の stable または mainline を使います。stable は `https://nginx.org/packages/ubuntu`、mainline は `https://nginx.org/packages/mainline/ubuntu` です。対応する Ubuntu は 22.04 jammy、24.04 noble、26.04 resolute です（2026-11-21 確認）。それ以外のコードネームは **要確認** です。

```bash
sudo apt-get update
sudo apt-get install -y curl gnupg2 ca-certificates lsb-release

# 鍵を配置する（指紋は 573B FD6B 3D8F BC64 1079 A6AB ABF5 BD82 7BD9 BF62）
curl -fsSL https://nginx.org/keys/nginx_signing.key \
  | sudo gpg --dearmor --yes -o /usr/share/keyrings/nginx-archive-keyring.gpg
sudo chmod 0644 /usr/share/keyrings/nginx-archive-keyring.gpg
gpg --show-keys --with-fingerprint /usr/share/keyrings/nginx-archive-keyring.gpg

# stable の場合。mainline は URL を /packages/mainline/ubuntu にする。
. /etc/os-release
echo "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] https://nginx.org/packages/ubuntu ${VERSION_CODENAME} nginx" \
  | sudo tee /etc/apt/sources.list.d/nginx.list

# Ubuntu 版より nginx.org 版を優先する
sudo tee /etc/apt/preferences.d/99nginx >/dev/null <<'EOF'
Package: *
Pin: origin nginx.org
Pin-Priority: 900
EOF

sudo apt-get update
apt-cache policy nginx
```

`apt-cache policy nginx` で 1.30.7 または 1.31.9 の候補を確認し、表示されたバージョンをそのまま指定して入れます。パッケージ名の接尾辞（`-1~noble` など）はリポジトリの状態で変わるため、ここでは固定文字列を推測しません。

```bash
# 例: apt-cache policy で確認した値を指定する
sudo apt-get install -y nginx=<1.30.7 または 1.31.9 の表示バージョン>
sudo apt-mark hold nginx
nginx -v
```

`apt-mark hold` で意図しない更新を止めます。更新するときは `apt-mark unhold nginx` → バージョン指定 → `hold` の順にします。

### 2. 設定を配置する

リポジトリの `deploy/nginx/` を使います。

```bash
sudo install -D -m 0644 deploy/nginx/atlas.conf /etc/nginx/conf.d/atlas.conf
sudo install -D -m 0644 deploy/nginx/snippets/atlas-proxy-headers.conf \
  /etc/nginx/snippets/atlas-proxy-headers.conf
```

`atlas.conf` の先頭コメントに置換箇所をまとめています。最低限、次の 5 つを自分の環境に置き換えます。

| 置換前 | 置換後 |
| --- | --- |
| `atlas.example.com` | 公開ホスト名 |
| `/etc/letsencrypt/live/atlas.example.com/fullchain.pem` | 証明書チェーン |
| `/etc/letsencrypt/live/atlas.example.com/privkey.pem` | 秘密鍵 |
| `127.0.0.1:3000` | Atlas の `APP_PORT` とアドレス |
| `/var/www/atlas-acme` | certbot の webroot |

Ubuntu 版の `/etc/nginx/sites-enabled/default` が残っていると、80 番の既定サーバーがそちらになることがあります。バックアップしてから無効化し、`nginx -T` で実際に読み込まれる `server` を確認してください。nginx.org 版の `nginx.conf` が `sites-enabled` や `modules-enabled` を読み込むかはパッケージの版で変わるため、**要確認** です。`conf.d` は `atlas.conf` の想定した配置先です。

```bash
sudo cp -a /etc/nginx /root/nginx-backup-$(date +%Y%m%d-%H%M%S)
sudo nginx -T > /root/nginx-T-before.conf 2>&1
sudo rm -f /etc/nginx/sites-enabled/default
```

### 3. 証明書を取得する

初回は 443 サーバーの証明書ファイルがまだ存在しないため、そのままでは `nginx -t` が失敗します。次のどちらかで取得してください。

- **webroot（推奨）**: 最初だけ `atlas.conf` の 443 サーバーをコメントアウトし、80 番の ACME 用設定だけで NGINX を起動する。`/var/www/atlas-acme` を作り、certbot を webroot モードで実行してから 443 を有効にする。
- **standalone**: NGINX を停止した状態で `certbot certonly --standalone -d atlas.example.com` を実行する。更新も standalone になるため、更新時に NGINX を止める運用になる。

webroot の例:

```bash
sudo mkdir -p /var/www/atlas-acme
sudo certbot certonly --webroot -w /var/www/atlas-acme -d atlas.example.com
sudo nginx -t
sudo systemctl reload nginx
```

`certbot` の導入方法（snap / apt）は環境によって異なります。**要確認**。証明書の自動更新は `certbot renew` の timer と、更新後の `systemctl reload nginx` を設定してください。

### 4. 起動と確認

```bash
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl status nginx

# HTTP → HTTPS（301）
curl -sS -o /dev/null -D - http://atlas.example.com/projects/1 | head

# HSTS が 1 つだけか（大文字小文字を無視して数える）
curl -sSI https://atlas.example.com/login | grep -ci '^strict-transport-security:'

# Atlas のセキュリティヘッダーが重複していないか
curl -sSI https://atlas.example.com/login | grep -Ei '^(x-content-type-options|referrer-policy|x-frame-options|permissions-policy|content-security-policy):'
```

ブラウザでログインし、プロジェクトのライブ更新（`/api/ws`）が動くこと、25 MiB 以内の添付がアップロードできること、25 MiB を超える添付が 413 で拒否されることを確認します。

### 5. Atlas 側の環境変数（NGINX 構成）

```bash
APP_PORT=3000
APP_ORIGIN=https://atlas.example.com
WS_ALLOWED_ORIGINS=https://atlas.example.com
ATLAS_TRUSTED_PROXIES=127.0.0.1/32
ATLAS_KEEPALIVE_TIMEOUT_MS=65000
UPLOAD_DIR=/app/uploads
```

`ATLAS_TRUSTED_PROXIES` には、**Atlas から見た接続元のアドレス**を指定します。NGINX の設定上のアドレスとは一致しないことがあるので、構成ごとに確認してください。

| 構成 | Atlas から見た接続元 | `ATLAS_TRUSTED_PROXIES` の例 |
| --- | --- | --- |
| NGINX と Atlas（`node server.js`）が同じホストで直接動く | `127.0.0.1` | `127.0.0.1/32` |
| NGINX はホスト、Atlas は Docker コンテナ（`ports: "127.0.0.1:3000:3000"` で公開） | `127.0.0.1` ではなく、そのコンテナが属する Docker ネットワークのゲートウェイ（例: `172.18.0.1`） | そのゲートウェイのアドレス、または Docker ネットワークのサブネット |
| NGINX も Atlas も同じ Compose のコンテナ | NGINX コンテナのアドレス | NGINX コンテナが属するネットワークのサブネット |

Docker の場合のゲートウェイとサブネットは `docker network inspect <ネットワーク名> --format '{{range .IPAM.Config}}{{.Subnet}} {{.Gateway}}{{end}}'` で確認できます。設定後は、起動ログの `trusted proxies:` を確認し、ログインを 1 回失敗させてから、自分のグローバル IP の行が `auth_rate_limits` にできたかを確かめてください。この表は IP をハッシュで保存するので、次のように同じハッシュを作って探します（`<自分の IP>` を置き換える）。

```bash
hash=$(node -e 'console.log(require("crypto").createHash("sha256").update(JSON.stringify(["peer", process.argv[1]])).digest("hex"))' '<自分の IP>')
docker exec atlas-db psql -U atlas -d atlas -c "SELECT attempts FROM auth_rate_limits WHERE scope = 'peer' AND identity_hash = '$hash';"
```

行が無く、NGINX やゲートウェイのアドレスで同じハッシュを作ると行がある場合は、`ATLAS_TRUSTED_PROXIES` の値が合っていません。値が合っていないと、全員が NGINX（またはゲートウェイ）のアドレスで数えられ、ログインの回数制限を全員で共有します。

NGINX と Atlas が別ホストの場合は、NGINX ホストのアドレスを指定し、`upstream atlas_app` のアドレスも合わせて変更してください。

Atlas の `APP_PORT`（既定 3000）はインターネットに公開しないでください。`127.0.0.1/32` を信頼する構成では、同じホストの任意のプロセスが `X-Forwarded-For` を詐称できます。NGINX からのみ到達できるよう、loopback バインドまたはファイアウォールで制限します。ただし `server.js` は現状すべてのインターフェースで待ち受けるため、ホストの firewall（例: `ufw`）で 3000 番を閉じる運用が必要です。**要確認**: コンテナ構成では `APP_PORT` の公開範囲を Compose / Kubernetes のネットワークポリシーで制限してください。

## Ubuntu 標準パッケージから nginx.org へ移行する

Ubuntu の nginx は 1.28.3 のようなディストリビューション版で、設定のインクルード方法やモジュールの扱いが nginx.org 版と異なることがあります。次の順で移行します。

1. **現状を記録する**

   ```bash
   nginx -v
   nginx -V
   sudo nginx -T > /root/nginx-T-before.conf 2>&1
   sudo cp -a /etc/nginx /root/nginx-backup-$(date +%Y%m%d-%H%M%S)
   dpkg -l | grep -E '^ii\s+nginx' > /root/nginx-packages-before.txt
   ```

2. **設定の違いを確認する**

   Ubuntu 版の `nginx.conf` は `/etc/nginx/modules-enabled/*.conf`、`/etc/nginx/conf.d/*.conf`、`/etc/nginx/sites-enabled/*` を読み込む構成が多いです。nginx.org 版では `sites-enabled` や `modules-enabled` を読み込まない構成になり得ます。`nginx -T` の `include` と `server` を比較し、必要な設定を `conf.d` に移してください。

   - `sites-enabled` のファイルは `conf.d` に移すか、`nginx.conf` の `include` を自分で合わせる。
   - Ubuntu 版の動的モジュール（`load_module`）を使っている場合、nginx.org 版では同じモジュールが別パッケージ・別パスになることがある。**要確認**。
   - 実行ユーザー（`user` ディレクティブ）と、`UPLOAD_DIR`・証明書・ログの所有者を合わせる。nginx.org 版の Ubuntu パッケージの既定ユーザーはこの文書の執筆時点で確認していないため **要確認**（`nginx -T | grep '^user'` と `ps -o user= -C nginx` で確認）。

3. **パッケージを入れ替える**

   ```bash
   sudo systemctl stop nginx
   # 手順 1 の /root/nginx-packages-before.txt に出たパッケージ名を指定する。
   # Ubuntu のリリースによって nginx-core や libnginx-mod-* の有無が異なる。
   sudo apt-get remove -y <インストール済みの nginx 関連パッケージ>
   # リポジトリ・鍵・Pin を設定してから
   sudo apt-get update
   apt-cache policy nginx
   sudo apt-get install -y nginx=<1.30.7 または 1.31.9 の表示バージョン>
   sudo nginx -t
   sudo systemctl start nginx
   ```

   `apt-get remove` は設定ファイルを消さない想定ですが、パッケージの変更で `nginx.conf` が置き換わることがあります。必ずバックアップから戻せるようにしてください。`purge` は設定を消すため使いません。

4. **設定を戻す**

   `atlas.conf` と `snippets/atlas-proxy-headers.conf` を配置し、証明書パス・ホスト名・upstream を実環境に合わせます。`sites-enabled` を使っていた場合は `conf.d` に移します。`sudo nginx -t` と `sudo nginx -T` で、意図した `server` だけが有効か確認します。

5. **ロールバック**

   ```bash
   sudo systemctl stop nginx
   sudo cp -a /etc/nginx /root/nginx-before-rollback-$(date +%Y%m%d-%H%M%S)
   sudo apt-mark unhold nginx
   sudo apt-get install -y nginx=<Ubuntu 版のバージョン>
   # 必要なら /root/nginx-backup-* から /etc/nginx を戻す
   sudo nginx -t
   sudo systemctl start nginx
   ```

   **注意:** `deploy/nginx/atlas.conf` は 1.28.3 に戻しても `nginx -t` が通る書き方です（upstream の `keepalive_timeout` は 1.15.3 以降、`http2 on;` は 1.25.1 以降で使えます）。ただし 1.28.3 では upstream の keepalive が既定で無効なので、`keepalive 16;` を書いていても `proxy_http_version 1.1;` と `Connection ""` が必要です。この設定はどちらも明示しています。また 1.28.3 には、nginx.org が公表している 2026 年の脆弱性の修正が入っていない可能性があります（Ubuntu の独自修正は `apt changelog nginx` で確認）。ロールバックは一時的な措置にしてください。`listen 443 ssl; http2 on;` は新しい書き方で、古い `listen 443 ssl http2;` とは異なります。

## 1.30.7 と 1.31.9 の違いと選び方

| 項目 | stable 1.30.7 | mainline 1.31.9 | Atlas への影響 |
| --- | --- | --- | --- |
| リリース | 2026-11-18 | 2026-11-18 | どちらも同じ `deploy/nginx/atlas.conf` で動作確認済み。 |
| upstream keepalive | 1.29.7 以降、既定で有効 | 同左 | Atlas は `ATLAS_KEEPALIVE_TIMEOUT_MS=65000`、NGINX は 60s。設定で明示している。 |
| `proxy_http_version` | 1.29.7 以降、既定 1.1 | 同左 | 設定で `1.1` を明示。 |
| プロキシの `Connection` | 1.29.7 以降、既定で送らない | 同左 | 通常は `Connection ""`、`/api/ws` だけ `upgrade`。 |
| Host / `:authority` 検証 | 1.29.4 以降 RFC 3986 | 同左 | 不正な Host は NGINX が拒否する。`server_name` を正しく設定する。 |
| chunked の単独 LF | 1.29.4 以降 不正 | 同左 | 壊れた chunked 本文は通らない。 |
| TLSv1.3 証明書圧縮 | 1.29.1 以降 既定で無効 | 同左 | 特別な設定は不要。 |
| HTTP/2・HTTP/3 の `Connection` / `Upgrade` | 制限なし | 1.31.0 以降、そのような要求を拒否 | WebSocket は HTTP/1.1 で接続する。ブラウザの `wss` は通常 HTTP/1.1。HTTP/2 の拡張 CONNECT には依存しない。 |
| バックエンドへの Host | 明示が必要 | 1.31.4 以降、HTTP/1.1 要求に常に Host を付与 | 設定では `proxy_set_header Host $host;` を明示しているため差はない。 |
| `$request_id` | 従来の形式 | 1.31.2 で形式変更 | `atlas.conf` は `$request_id` を使わない。 |
| ヘッダー行・chunked フレーミング | — | 1.31.9 でコロンなしヘッダー行や過剰な chunked フレーミングを拒否 | 正規の HTTP クライアントには影響しない。壊れたプロキシや自作クライアントは 400 になり得る。 |

**選び方**

- まず **stable 1.30.7** を選ぶと、mainline 固有の受理仕様変更（1.31.x の HTTP/2・HTTP/3 ヘッダー拒否など）を避けられます。Atlas のテストも 1.30.7 で通っています。
- 新機能や mainline の修正を早く取り込みたい場合は **mainline 1.31.9**。Atlas の `wss` は HTTP/1.1 なので、1.31.0 の HTTP/2 `Connection` 拒否には該当しません。
- どちらも **バージョンを固定**し、`apt-mark hold` で意図しない更新を止めてください。更新はステージングで `nginx -t`、ログイン、`/api/ws`、25 MiB 添付、SCIM 適合性を確認してから行います。

上記の nginx.org の仕様は 2026-11-21 時点の公式情報に基づきます。将来のパッチで変わる可能性があるため、更新時は changelog を **要確認** としてください。

## テスト

リポジトリには NGINX 前段の使い捨て E2E があります。Docker、Node.js 24、Python 3、curl、OpenSSL が必要です。

```bash
# mainline 1.31.9（既定）
bash tests/run-e2e.sh nginx

# stable 1.30.7
ATLAS_NGINX_VERSION=1.30.7 bash tests/run-e2e.sh nginx
```

このスイートは次を確認します。

- `nginx -v` が指定バージョンであること、`nginx -t` が通ること
- 80 番の ACME チャレンジと HTTP→HTTPS 301
- HSTS が 1 つだけであること、Atlas のセキュリティヘッダーが重複しないこと
- HTTPS 経由のログイン、`Secure` Cookie、`/api/ws` の `wss`（Origin 付き、未認証 401、異なる Origin 403）
- 25 MiB の添付が通り、27 MiB が 413 で拒否されること
- ログイン失敗の IP 単位制限がクライアントごとに独立し、偽の `X-Forwarded-For` で回避・他人のロックができないこと
- SCIM 適合性チェッカー（`--profile all`）が HTTPS で全件通ること
- Node の `keepAliveTimeout` を超える待ち時間を挟んでも 502 が出ないこと
- Playwright のサイドバー 15 テストが NGINX 経由の HTTPS で通ること

フルのブラウザスイートは `bash tests/run-e2e.sh browser` で別途実行します。

## トラブルシューティング

| 症状 | 確認すること |
| --- | --- |
| 全員が同じログイン制限に巻き込まれる | `ATLAS_TRUSTED_PROXIES` が NGINX のアドレスを含むか。起動ログの `trusted proxies:` と invalid entry の警告を見る。 |
| 特定のユーザーだけ制限が共有される | `X-Forwarded-For` の右端が NGINX の付けた実アドレスか。多段プロキシなら全ホップを列挙しているか。 |
| アイドル後に 502 | `ATLAS_KEEPALIVE_TIMEOUT_MS` が 65000 以上か。NGINX の upstream `keepalive_timeout` が 60s か。 |
| 25 MiB の添付が 413 | NGINX の `client_max_body_size`（26m）と Atlas の 25 MiB 上限を確認する。multipart の `task_id` を `file` より前に送っているか。 |
| WebSocket がつながらない | `WS_ALLOWED_ORIGINS` が公開オリジンと一致するか。`/api/ws` で `Upgrade` / `Connection "upgrade"` が設定されているか。HTTP/2 ではなく HTTP/1.1 で接続しているか。 |
| HSTS が二重になる | Atlas は HSTS を付けない。ロードバランサーや NGINX のどちらか一方だけが付ける。 |
| SCIM の URL が http になる | `APP_ORIGIN` を `https://...` に設定する。未設定時は `X-Forwarded-Host` / `X-Forwarded-Proto` に依存する。 |
| 証明書更新後に `nginx -t` が失敗 | 証明書パス、`snippets/atlas-proxy-headers.conf` の配置、`sites-enabled` の残骸を `nginx -T` で確認する。 |

## 付録: `deploy/nginx/` の設計メモ

- `client_max_body_size 26m`: Atlas の添付上限は 25 MiB。multipart の境界・パートヘッダー・`task_id` フィールドに約 1 MiB の余白を確保しつつ、巨大な本文を Node に渡す前に NGINX で止める。
- `proxy_request_buffering off;`（`/api/attachments` のみ）: 25 MiB のアップロードを NGINX の一時ディスクに全部書いてから転送せず、Node へストリーミングする。`client_max_body_size` は有効なままなので、上限超過は NGINX が 413 で拒否する。単一 upstream なので、バッファリング無効による再試行の制約は実運用上問題にならない。
- `gzip`: `text/*`、JSON、JavaScript、XML、SVG のみ。画像・フォント・既圧縮データは圧縮しない。
- `$request_id`: 使用しない。1.31.2 の形式変更に依存しない。
- セキュリティヘッダー: HSTS だけ NGINX。CSP、`X-Content-Type-Options`、`Referrer-Policy`、`X-Frame-Options`、`Permissions-Policy` は Atlas が付ける。
