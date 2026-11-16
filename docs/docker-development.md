# Docker 開発環境のソース同期

Macのホスト上のソースをDockerへ直接bind mountすると、Next.jsへの変更通知が届かず、Fast Refreshや新規ルートの検出が止まることがあります。Next.js 16.4.6でポーリングを強制した構成では、存在しない探索候補ディレクトリに対する`watch error ... ENOENT`も発生しました。

`scripts/dev-source-mirror.cjs`は、読み取り専用のホストソースをコンテナ内の書き込み可能なソースへ同期します。Next.jsはそのコピーに対する標準のLinuxファイル通知を受け取ります。警告の出力は抑制しません。

## 起動構成

既存のローカル専用Compose設定のアプリサービスへ組み込みます。DB・Redis・アップロード・開発キャッシュの既存設定とボリュームを保持してください。

1. 下表の各ソースbind mountを`read_only: true`のまま、`/app/<名前>`から`/atlas-source/<名前>`へ移します。既存の`/app`配下のソースbind mountは移動後のコピーを覆わないようにします。
2. このリポジトリの`scripts/dev-source-mirror.cjs`を、`/atlas-dev/dev-source-mirror.cjs`へ読み取り専用で追加マウントします。
3. アプリの作業ディレクトリを`/app`、`NODE_ENV`を`development`、コマンドを`["node", "/atlas-dev/dev-source-mirror.cjs"]`にします。`ATLAS_DEV_POLLING`は未設定または`0`にします。
4. 起動前にDBと添付領域をバックアップし、アプリサービスだけを再作成します。アプリの起動コマンドはマイグレーションを実行しないため、必要なDB変更は別途適用します。

| リポジトリ内のソース | コンテナ内の読み取り元 |
| --- | --- |
| `app/` | `/atlas-source/app/` |
| `components/` | `/atlas-source/components/` |
| `lib/` | `/atlas-source/lib/` |
| `public/` | `/atlas-source/public/` |
| `scripts/` | `/atlas-source/scripts/` |
| `db/` | `/atlas-source/db/` |
| `next.config.ts` | `/atlas-source/next.config.ts` |
| `proxy.ts` | `/atlas-source/proxy.ts` |
| `tsconfig.json` | `/atlas-source/tsconfig.json` |
| `package.json` | `/atlas-source/package.json` |
| `package-lock.json` | `/atlas-source/package-lock.json` |
| `instrumentation.ts` | `/atlas-source/instrumentation.ts` |
| `server.js` | `/atlas-source/server.js` |

すべての読み取り元が必要です。コンテナ内の`/app`のソース領域は、アプリの実行ユーザーが書き込める構成にします。依存パッケージはイメージ内のものを使い、ホストの`node_modules`はマウントしません。`.next`は専用の開発キャッシュを使用します。

## 同期と再起動

- 起動時に、上表で許可したソース領域のコンテナ内コピーを置き換えてから`server.js`を起動します。ホストへは書き戻しません。
- 500msごとにファイル内容とモードを確認し、2回連続で同じ内容だった変更を反映します。変更したファイルは一時ファイルからのrenameで更新し、削除されたファイルもコピーから削除します。
- リポジトリ直下の認証情報ファイル、`.git`、`node_modules`、`.next`と、別ボリュームのアップロード・DBデータは同期対象外です。上表の領域にはソースだけを置き、運用データやバックアップを混在させないでください。許可したソース領域にあるシンボリックリンクはエラーにします。
- 同期のエラーは記録して子サーバーを停止します。保存途中の`ENOENT`は一時的に再試行し、10回連続した場合は停止します。
- `server.js`や起動時に読み込むサーバーモジュールの変更はアプリを再起動します。依存パッケージやDockerfileの変更はイメージを再ビルドします。

ローカル専用Compose設定には接続先や認証情報を含められるため、公開するソースとは別に保管してください。ランチャーをマウントしたファイルは起動時にも必要です。

## 検証項目

使い捨てのDB・Redis・添付領域を持つ隔離環境で、次を確認してから保持する環境へ適用します。

- 通常保存とatomic saveでFast Refreshが動き、入力中の値を保持する。
- import先ファイルの作成・名前変更・削除と、別拡張子へのフォールバックを検知する。
- APIルートの作成・置換・削除を検知する。
- 開発キャッシュを保持したアプリの再起動後にも変更を検知する。
- 画面・認証・添付・各種出力・WebSocket・RSCキャンセルを確認し、ログに監視警告がない。

適用前後はタスク・ノート・添付の件数だけでなく内容のハッシュも比較します。ログイン履歴や監視ハートビートなど、通常操作で変化するメタデータは区別して確認します。

参考: [Next.jsのローカル開発ガイド](https://nextjs.org/docs/app/guides/local-development)、[Dockerのソース同期ガイド](https://docs.docker.com/compose/how-tos/file-watch/)。
